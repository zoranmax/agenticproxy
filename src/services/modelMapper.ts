import * as vscode from 'vscode';
import {
  OpenAIChatCompletionRequest,
  OpenAIContentPart,
  OpenAIMessage,
  OpenAITool,
  OpenAIToolCall,
  ProviderEntry
} from '../types';

export interface ParsedModelId {
  providerId: string;
  rawModelId: string;
}

export class ModelMapper {
  private static readonly NAMESPACE_SEPARATOR = '::';

  /**
   * Formats a namespaced model ID combining provider ID and raw model ID.
   * e.g. "550e8400-e29b-41d4-a716-446655440000::llama3.3:70b"
   */
  public static toNamespacedModelId(providerId: string, rawModelId: string): string {
    return `${providerId}${this.NAMESPACE_SEPARATOR}${rawModelId}`;
  }

  /**
   * Parses a namespaced model ID back into provider ID and raw model ID.
   */
  public static parseNamespacedModelId(namespacedId: string): ParsedModelId | undefined {
    const sepIndex = namespacedId.indexOf(this.NAMESPACE_SEPARATOR);
    if (sepIndex === -1) {
      return undefined;
    }
    const providerId = namespacedId.slice(0, sepIndex);
    const rawModelId = namespacedId.slice(sepIndex + this.NAMESPACE_SEPARATOR.length);
    if (!providerId || !rawModelId) {
      return undefined;
    }
    return { providerId, rawModelId };
  }

  /**
   * Converts VS Code messages and request options into OpenAI chat completions payload.
   */
  public static toOpenAIChatRequest(
    rawModelId: string,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions
  ): OpenAIChatCompletionRequest {
    const openAiMessages: OpenAIMessage[] = [];

    for (const msg of messages) {
      const converted = this.convertMessage(msg);
      if (Array.isArray(converted)) {
        openAiMessages.push(...converted);
      } else if (converted) {
        openAiMessages.push(converted);
      }
    }

    const payload: OpenAIChatCompletionRequest = {
      model: rawModelId,
      messages: openAiMessages
    };

    // Map tools if present
    if (options.tools && options.tools.length > 0) {
      payload.tools = options.tools.map(tool => this.convertTool(tool));

      if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
        payload.tool_choice = 'required';
      } else {
        payload.tool_choice = 'auto';
      }
    }

    // Map model options if specified
    if (options.modelOptions) {
      if (typeof options.modelOptions.temperature === 'number') {
        payload.temperature = options.modelOptions.temperature;
      }
      if (typeof options.modelOptions.top_p === 'number') {
        payload.top_p = options.modelOptions.top_p;
      }
      if (typeof options.modelOptions.max_tokens === 'number') {
        payload.max_tokens = options.modelOptions.max_tokens;
      }
    }

    return payload;
  }

  /**
   * Converts a single VS Code chat request message into OpenAI message(s).
   * Note: Tool results in VS Code are represented as ToolResultParts in User messages,
   * which may need to be expanded into distinct role: 'tool' messages in OpenAI format.
   */
  private static convertMessage(
    msg: vscode.LanguageModelChatRequestMessage
  ): OpenAIMessage | OpenAIMessage[] | null {
    const role = msg.role === vscode.LanguageModelChatMessageRole.User ? 'user' : 'assistant';
    const textParts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];
    const toolResults: Array<{ callId: string; content: string }> = [];
    const imageParts: OpenAIContentPart[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input || {})
          }
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        let resultString = '';
        for (const sub of part.content) {
          if (sub instanceof vscode.LanguageModelTextPart) {
            resultString += sub.value;
          } else if (typeof sub === 'string') {
            resultString += sub;
          } else if (sub && typeof sub === 'object' && 'value' in (sub as Record<string, unknown>)) {
            const val = (sub as Record<string, unknown>).value;
            resultString += typeof val === 'string' ? val : JSON.stringify(val);
          } else {
            try {
              resultString += JSON.stringify(sub);
            } catch {
              resultString += String(sub);
            }
          }
        }
        toolResults.push({ callId: part.callId, content: resultString });
      } else if (part instanceof vscode.LanguageModelDataPart) {
        // Handle images or text in LanguageModelDataPart
        const mime = (part as unknown as { mimeType?: string; mime?: string }).mimeType ||
          (part as unknown as { mime?: string }).mime || '';
        const data = (part as unknown as { data?: Uint8Array; value?: unknown }).data;

        if (mime.startsWith('image/') && data) {
          const base64 = Buffer.from(data).toString('base64');
          imageParts.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${base64}` }
          });
        } else if (data) {
          textParts.push(Buffer.from(data).toString('utf-8'));
        }
      }
    }

    // If there are tool results, they become role: 'tool' messages
    if (toolResults.length > 0) {
      const messages: OpenAIMessage[] = [];
      if (textParts.length > 0 || imageParts.length > 0) {
        messages.push({
          role: 'user',
          content: this.buildContent(textParts, imageParts),
          name: msg.name
        });
      }
      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: tr.callId,
          content: tr.content
        });
      }
      return messages;
    }

    if (role === 'assistant') {
      const content = textParts.join('');
      return {
        role: 'assistant',
        content: content.length > 0 ? content : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        name: msg.name
      };
    }

    // role === 'user'
    const content = this.buildContent(textParts, imageParts);
    return {
      role: 'user',
      content,
      name: msg.name
    };
  }

  private static buildContent(textParts: string[], imageParts: OpenAIContentPart[]): string | OpenAIContentPart[] {
    const combinedText = textParts.join('');
    if (imageParts.length === 0) {
      return combinedText;
    }

    const parts: OpenAIContentPart[] = [];
    if (combinedText.length > 0) {
      parts.push({ type: 'text', text: combinedText });
    }
    parts.push(...imageParts);
    return parts;
  }

  /**
   * Converts VS Code tool declaration to OpenAI tool format.
   */
  private static convertTool(tool: vscode.LanguageModelChatTool): OpenAITool {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} }
      }
    };
  }

  /**
   * Maps a raw discovered model ID to LanguageModelChatInformation.
   */
  public static toChatModelInformation(
    provider: ProviderEntry,
    rawModelId: string,
    defaultMaxInputTokens: number = 128000,
    defaultMaxOutputTokens: number = 4096
  ): vscode.LanguageModelChatInformation {
    const customOverride = provider.customModels?.find(
      m => m.modelId.toLowerCase() === rawModelId.toLowerCase()
    );

    const displayName = customOverride?.displayName || `${provider.nickname}: ${rawModelId}`;
    const maxInputTokens =
      customOverride?.capabilities?.maxInputTokens ??
      provider.defaultCapabilities?.maxInputTokens ??
      defaultMaxInputTokens;
    const maxOutputTokens =
      customOverride?.capabilities?.maxOutputTokens ??
      provider.defaultCapabilities?.maxOutputTokens ??
      defaultMaxOutputTokens;
    const toolCalling =
      customOverride?.capabilities?.toolCalling ??
      provider.defaultCapabilities?.toolCalling ??
      true;
    const imageInput =
      customOverride?.capabilities?.imageInput ??
      provider.defaultCapabilities?.imageInput ??
      false;

    const family = this.inferModelFamily(rawModelId);

    return {
      id: this.toNamespacedModelId(provider.id, rawModelId),
      name: displayName,
      family,
      version: '1.0.0',
      tooltip: `Provider: ${provider.nickname} (${provider.baseUrl})\nModel: ${rawModelId}`,
      detail: provider.nickname,
      maxInputTokens,
      maxOutputTokens,
      capabilities: {
        toolCalling,
        imageInput
      }
    };
  }

  /**
   * Infers model family string from model ID.
   */
  private static inferModelFamily(modelId: string): string {
    const lower = modelId.toLowerCase();
    if (lower.includes('gpt-4o')) return 'gpt-4o';
    if (lower.includes('gpt-4')) return 'gpt-4';
    if (lower.includes('gpt-3.5')) return 'gpt-3.5-turbo';
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('deepseek')) return 'deepseek';
    if (lower.includes('llama')) return 'llama';
    if (lower.includes('mistral') || lower.includes('mixtral')) return 'mistral';
    if (lower.includes('qwen')) return 'qwen';
    if (lower.includes('phi')) return 'phi';
    if (lower.includes('gemma')) return 'gemma';
    if (lower.includes('command')) return 'cohere';
    return 'openai-compatible';
  }
}
