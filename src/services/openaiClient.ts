import * as vscode from 'vscode';
import { OpenAIChatChunk, OpenAIChatCompletionRequest, OpenAIModelsResponse } from '../types';

export interface StreamCallbacks {
  onTextDelta?: (delta: string) => void;
  onToolCallDelta?: (call: { index: number; id?: string; name?: string; argumentsDelta?: string }) => void;
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
}

export class OpenAIClient {
  /**
   * Builds full endpoint URL handling variations in base paths (with or without /v1).
   */
  private static buildUrl(baseUrl: string, endpoint: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    const cleanEndpoint = endpoint.replace(/^\/+/, '');
    return `${trimmed}/${cleanEndpoint}`;
  }

  /**
   * Builds headers with optional Authorization and Custom Headers.
   */
  private static buildHeaders(apiKey?: string, customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    };

    if (apiKey && apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }

    if (customHeaders) {
      for (const [k, v] of Object.entries(customHeaders)) {
        if (k.toLowerCase() !== 'authorization') {
          headers[k] = v;
        }
      }
    }

    return headers;
  }

  /**
   * Fetches the list of available model IDs from the endpoint (GET /models or GET /v1/models).
   */
  public static async fetchModels(
    baseUrl: string,
    apiKey?: string,
    customHeaders?: Record<string, string>,
    cancellationToken?: vscode.CancellationToken,
    timeoutMs: number = 20000
  ): Promise<string[]> {
    const url = this.buildUrl(baseUrl, 'models');
    const controller = new AbortController();

    if (cancellationToken?.isCancellationRequested) {
      throw new Error('Request cancelled');
    }

    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    let cancelDisposable: vscode.Disposable | undefined;
    if (cancellationToken) {
      cancelDisposable = cancellationToken.onCancellationRequested(() => {
        controller.abort();
      });
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(apiKey, customHeaders),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `HTTP ${response.status} (${response.statusText})${errorText ? `: ${errorText.slice(0, 300)}` : ''}`
        );
      }

      const json = (await response.json()) as OpenAIModelsResponse;
      const modelIds: string[] = [];

      if (Array.isArray(json.data)) {
        for (const item of json.data) {
          if (item && typeof item.id === 'string' && item.id.trim().length > 0) {
            modelIds.push(item.id.trim());
          }
        }
      } else if (Array.isArray((json as unknown as { models?: Array<{ name?: string; id?: string }> }).models)) {
        // Compatibility with Ollama /api/tags or alternative formats
        const altModels = (json as unknown as { models: Array<{ name?: string; id?: string }> }).models;
        for (const item of altModels) {
          const id = item.name || item.id;
          if (id && typeof id === 'string') {
            modelIds.push(id.trim());
          }
        }
      }

      return modelIds;
    } finally {
      clearTimeout(timeoutHandle);
      cancelDisposable?.dispose();
    }
  }

  /**
   * Tests connection to an endpoint by fetching models.
   */
  public static async testConnection(
    baseUrl: string,
    apiKey?: string,
    customHeaders?: Record<string, string>,
    cancellationToken?: vscode.CancellationToken
  ): Promise<{ success: boolean; modelCount: number; error?: string; cancelled?: boolean }> {
    try {
      const models = await this.fetchModels(baseUrl, apiKey, customHeaders, cancellationToken, 10000);
      return { success: true, modelCount: models.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Detect user cancellation via AbortError
      if (
        msg.includes('AbortError') ||
        msg.includes('abort') ||
        cancellationToken?.isCancellationRequested
      ) {
        return { success: false, modelCount: 0, error: msg, cancelled: true };
      }
      return { success: false, modelCount: 0, error: msg };
    }
  }

  /**
   * Streams chat completions from OpenAI-compatible endpoint with SSE support.
   */
  public static async streamChatCompletion(
    baseUrl: string,
    apiKey: string | undefined,
    requestPayload: OpenAIChatCompletionRequest,
    callbacks: StreamCallbacks,
    cancellationToken?: vscode.CancellationToken,
    customHeaders?: Record<string, string>
  ): Promise<void> {
    const url = this.buildUrl(baseUrl, 'chat/completions');
    const controller = new AbortController();

    let cancelDisposable: vscode.Disposable | undefined;
    if (cancellationToken) {
      if (cancellationToken.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      cancelDisposable = cancellationToken.onCancellationRequested(() => {
        controller.abort();
      });
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(apiKey, customHeaders),
        body: JSON.stringify({
          ...requestPayload,
          stream: true,
          stream_options: { include_usage: true }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `OpenAI Endpoint returned HTTP ${response.status} (${response.statusText})${errorText ? `: ${errorText.slice(0, 500)}` : ''}`
        );
      }

      if (!response.body) {
        throw new Error('Response body is empty or streaming is unsupported by provider.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        if (cancellationToken?.isCancellationRequested) {
          controller.abort();
          throw new vscode.CancellationError();
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith(':')) {
            // Keep-alive or comment
            continue;
          }

          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (dataStr === '[DONE]') {
              return;
            }

            try {
              const chunk = JSON.parse(dataStr) as OpenAIChatChunk;

              if (chunk.usage && callbacks.onUsage) {
                callbacks.onUsage({
                  promptTokens: chunk.usage.prompt_tokens ?? 0,
                  completionTokens: chunk.usage.completion_tokens ?? 0,
                  totalTokens: chunk.usage.total_tokens ?? 0
                });
              }

              if (chunk.choices && chunk.choices.length > 0) {
                const choice = chunk.choices[0];
                const delta = choice.delta;
                if (!delta) {
                  continue;
                }

                // Content text chunk
                if (typeof delta.content === 'string' && delta.content.length > 0) {
                  callbacks.onTextDelta?.(delta.content);
                }

                // Tool calls chunk
                if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
                  for (const tc of delta.tool_calls) {
                    callbacks.onToolCallDelta?.({
                      index: tc.index,
                      id: tc.id,
                      name: tc.function?.name,
                      argumentsDelta: tc.function?.arguments
                    });
                  }
                }
              }
            } catch {
              // Ignore malformed SSE line and continue
            }
          }
        }
      }
    } catch (err: unknown) {
      if (cancellationToken?.isCancellationRequested || (err instanceof Error && err.name === 'AbortError')) {
        throw new vscode.CancellationError();
      }
      throw err;
    } finally {
      cancelDisposable?.dispose();
    }
  }
}
