import * as vscode from 'vscode';
import { ModelMapper } from './services/modelMapper';
import { OpenAIClient } from './services/openaiClient';
import { ProviderRegistry } from './services/providerRegistry';
import { ProviderEntry } from './types';

export class OpenAIChatModelProvider implements vscode.LanguageModelChatProvider {
  private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
  public readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

  /** In-memory cache of resolved model informations */
  private cachedModels: vscode.LanguageModelChatInformation[] = [];
  private isRefreshing = false;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    // Whenever providers or keys are modified, notify VS Code and invalidate cache
    this.registry.onDidChangeProviders(() => {
      this.cachedModels = [];
      this._onDidChangeLanguageModelChatInformation.fire();
    });
  }

  /**
   * Returns the currently cached model informations (may be empty until a
   * refresh or model-picker query has populated the cache).
   */
  public getCachedModels(): vscode.LanguageModelChatInformation[] {
    return this.cachedModels;
  }

  /**
   * Manual trigger to refresh models across all providers.
   */
  public async refresh(silent = false): Promise<vscode.LanguageModelChatInformation[]> {
    this.cachedModels = [];
    this._onDidChangeLanguageModelChatInformation.fire();
    return this.provideLanguageModelChatInformation({ silent }, new vscode.CancellationTokenSource().token);
  }

  /**
   * Called by VS Code when the chat model picker opens or checks available models.
   */
  public async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const providers = this.registry.getProviders();

    // If silent and we already have cached models, return them immediately
    if (options.silent && this.cachedModels.length > 0) {
      return this.cachedModels;
    }

    // If no providers are configured at all
    if (providers.length === 0) {
      this.cachedModels = [];
      if (!options.silent) {
        // Prompt user to add a provider
        void vscode.window
          .showInformationMessage(
            'No OpenAI-compatible providers configured yet.',
            'Add Provider'
          )
          .then(action => {
            if (action === 'Add Provider') {
              void vscode.commands.executeCommand('agenticproxy.manageProviders');
            }
          });
      }
      return [];
    }

    if (this.isRefreshing) {
      return this.cachedModels;
    }

    this.isRefreshing = true;
    try {
      const config = vscode.workspace.getConfiguration('agenticproxy');
      const defaultMaxInputTokens = config.get<number>('defaultMaxInputTokens', 128000);
      const defaultMaxOutputTokens = config.get<number>('defaultMaxOutputTokens', 4096);
      const timeoutSeconds = config.get<number>('requestTimeoutSeconds', 20);

      const allModels: vscode.LanguageModelChatInformation[] = [];

      // Query all providers in parallel using allSettled to ensure isolation
      const fetchPromises = providers.map(async provider => {
        return this.fetchProviderModels(
          provider,
          defaultMaxInputTokens,
          defaultMaxOutputTokens,
          timeoutSeconds * 1000,
          token
        );
      });

      const results = await Promise.allSettled(fetchPromises);

      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const provider = providers[i];
        if (res.status === 'fulfilled') {
          allModels.push(...res.value);
        } else {
          this.outputChannel.appendLine(
            `[Error] Failed to fetch models from "${provider.nickname}" (${provider.baseUrl}): ${res.reason}`
          );
        }
      }

      this.cachedModels = allModels;
      return allModels;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Discovers models for a single provider entry (handles both /v1/models and manual custom overrides).
   */
  private async fetchProviderModels(
    provider: ProviderEntry,
    defaultMaxInputTokens: number,
    defaultMaxOutputTokens: number,
    timeoutMs: number,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const apiKey = await this.registry.getApiKey(provider.id);
    const discoveredModelIds: Set<string> = new Set();
    const result: vscode.LanguageModelChatInformation[] = [];

    // 1. Try to fetch /v1/models from endpoint
    try {
      const remoteIds = await OpenAIClient.fetchModels(
        provider.baseUrl,
        apiKey,
        provider.customHeaders,
        token,
        timeoutMs
      );
      for (const id of remoteIds) {
        discoveredModelIds.add(id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(
        `[Warning] Endpoint ${provider.baseUrl} model discovery failed: ${msg}. Checking manual overrides.`
      );
    }

    // 2. Include any manual custom models configured for this provider
    if (provider.customModels && provider.customModels.length > 0) {
      for (const custom of provider.customModels) {
        discoveredModelIds.add(custom.modelId);
      }
    }

    // 3. Persist the discovered model IDs so the sidebar can show them offline
    const discoveredList = Array.from(discoveredModelIds);
    if (
      !provider.discoveredModels ||
      provider.discoveredModels.length !== discoveredList.length ||
      provider.discoveredModels.some(id => !discoveredList.includes(id))
    ) {
      await this.registry.updateProvider(provider.id, {
        discoveredModels: discoveredList
      });
    }

    // 4. Map all discovered IDs to LanguageModelChatInformation
    for (const rawId of discoveredList) {
      result.push(
        ModelMapper.toChatModelInformation(
          provider,
          rawId,
          defaultMaxInputTokens,
          defaultMaxOutputTokens
        )
      );
    }

    return result;
  }

  /**
   * Called by VS Code when a chat request is routed to one of our models.
   */
  public async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const parsed = ModelMapper.parseNamespacedModelId(model.id);
    if (!parsed) {
      throw new Error(`Invalid model ID format: "${model.id}". Expected "{providerId}::{modelId}".`);
    }

    const { providerId, rawModelId } = parsed;
    const provider = this.registry.getProviderById(providerId);
    if (!provider) {
      throw new Error(
        `Provider with ID "${providerId}" was not found in registry. Please reconfigure the provider.`
      );
    }

    const apiKey = await this.registry.getApiKey(providerId);

    // Convert VS Code request to OpenAI format
    const openAiRequest = ModelMapper.toOpenAIChatRequest(rawModelId, messages, options);

    // Track partial tool calls being assembled across streamed SSE chunks
    const pendingToolCalls = new Map<
      number,
      {
        id: string;
        name: string;
        args: string;
      }
    >();

    try {
      await OpenAIClient.streamChatCompletion(
        provider.baseUrl,
        apiKey,
        openAiRequest,
        {
          onTextDelta: delta => {
            progress.report(new vscode.LanguageModelTextPart(delta));
          },
          onToolCallDelta: delta => {
            const index = delta.index;
            let current = pendingToolCalls.get(index);
            if (!current) {
              current = {
                id: delta.id || `call_${Date.now()}_${index}`,
                name: delta.name || '',
                args: ''
              };
              pendingToolCalls.set(index, current);
            } else {
              if (delta.id) current.id = delta.id;
              if (delta.name) current.name += delta.name;
            }

            if (delta.argumentsDelta) {
              current.args += delta.argumentsDelta;
            }
          }
        },
        token,
        provider.customHeaders
      );

      // Report any finalized tool calls accumulated from the stream
      for (const [, call] of pendingToolCalls) {
        let parsedArgs: object = {};
        if (call.args && call.args.trim().length > 0) {
          try {
            parsedArgs = JSON.parse(call.args) as object;
          } catch {
            parsedArgs = { raw: call.args };
          }
        }
        progress.report(
          new vscode.LanguageModelToolCallPart(call.id, call.name, parsedArgs)
        );
      }
    } catch (err: unknown) {
      if (err instanceof vscode.CancellationError || token.isCancellationRequested) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[Error] Request to ${model.name} failed: ${msg}`);
      throw new Error(`[${provider.nickname}] ${msg}`);
    }
  }

  /**
   * Token count estimation heuristic (~4 characters per token baseline).
   */
  public async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') {
      return Math.ceil(text.length / 4);
    }

    // Estimate across parts if text is a message
    let length = 0;
    if (text.content && Array.isArray(text.content)) {
      for (const part of text.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          length += part.value.length;
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          length += (part.name + JSON.stringify(part.input)).length;
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          length += JSON.stringify(part.content).length;
        }
      }
    }
    return Math.max(1, Math.ceil(length / 4));
  }
}
