import * as vscode from 'vscode';
import { OpenAIChatModelProvider } from '../provider';
import { OpenAIClient } from '../services/openaiClient';
import { ProviderRegistry } from '../services/providerRegistry';
import { CustomModelOverride, ProviderEntry } from '../types';
import { showProviderForm } from './providerForm';

interface ProviderQuickPickItem extends vscode.QuickPickItem {
  providerId?: string;
  action?: 'add' | 'refresh' | 'edit';
}

export class ProviderManagementUI {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly provider: OpenAIChatModelProvider
  ) {}

  /**
   * Primary entry point for the management command (`agenticproxy.manageProviders`).
   */
  public async showMainMenu(): Promise<void> {
    while (true) {
      const providers = this.registry.getProviders();
      const items: ProviderQuickPickItem[] = [];

      items.push({
        label: '$(add) Add New Provider',
        description: 'Configure a new OpenAI-compatible endpoint',
        action: 'add'
      });

      items.push({
        label: '$(refresh) Refresh All Models',
        description: 'Re-query /models from all configured providers',
        action: 'refresh'
      });

      if (providers.length > 0) {
        items.push({
          label: 'Configured Providers',
          kind: vscode.QuickPickItemKind.Separator
        });

        for (const p of providers) {
          const hasKey = await this.registry.hasApiKey(p.id);
          const keyStatus = hasKey ? '$(key) Key Configured' : '$(lock-small) No Key';
          const modelCount = p.customModels?.length ? ` • ${p.customModels.length} custom model(s)` : '';

          items.push({
            label: `$(server) ${p.nickname}`,
            description: p.baseUrl,
            detail: `${keyStatus}${modelCount}`,
            providerId: p.id,
            action: 'edit'
          });
        }
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select an action or a provider to manage',
        title: 'AgenticProxy Providers'
      });

      if (!selected) {
        return;
      }

      if (selected.action === 'add') {
        await this.showAddProviderFlow();
      } else if (selected.action === 'refresh') {
        await this.refreshModelsFlow();
      } else if (selected.action === 'edit' && selected.providerId) {
        const keepGoing = await this.showProviderDetailsMenu(selected.providerId);
        if (!keepGoing) {
          return;
        }
      }
    }
  }

  /**
   * Flow for adding a new provider.
   */
  public async showAddProviderFlow(): Promise<void> {
    const result = await showProviderForm('Add Provider');

    if (result.cancelled || !result.nickname || !result.baseUrl) {
      return;
    }

    const nickname = result.nickname;
    const baseUrl = result.baseUrl;
    const apiKey = result.apiKey;

    // Test connection before saving
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Testing connection to ${nickname}...`,
        cancellable: false
      },
      async () => {
        const testResult = await OpenAIClient.testConnection(baseUrl, apiKey);
        if (testResult.success) {
          await this.registry.addProvider(
            {
              nickname,
              baseUrl
            },
            apiKey
          );
          void vscode.window.showInformationMessage(
            `Provider "${nickname}" added successfully! Discovered ${testResult.modelCount} model(s).`
          );
        } else {
          const saveAnyway = 'Save Anyway';
          const choice = await vscode.window.showWarningMessage(
            `Connection test failed: ${testResult.error}. Would you like to save this provider anyway?`,
            saveAnyway,
            'Cancel'
          );
          if (choice === saveAnyway) {
            await this.registry.addProvider(
              {
                nickname,
                baseUrl
              },
              apiKey
            );
            void vscode.window.showInformationMessage(`Provider "${nickname}" saved.`);
          }
        }
      }
    );
  }

  /**
   * Details menu for an existing provider (Edit / Test / Custom Models / Delete).
   */
  public async showProviderDetailsMenu(providerId: string): Promise<boolean> {
    const provider = this.registry.getProviderById(providerId);
    if (!provider) {
      return true;
    }

    const hasKey = await this.registry.hasApiKey(providerId);

    const items: vscode.QuickPickItem[] = [
      {
        label: '$(edit) Edit Nickname / URL',
        description: `${provider.nickname} (${provider.baseUrl})`
      },
      {
        label: '$(key) Update / Rotate API Key',
        description: hasKey ? 'Currently configured' : 'Not set'
      },
      {
        label: '$(list-unordered) Manage Custom Models / Overrides',
        description: `${provider.customModels?.length || 0} override(s) configured`
      },
      {
        label: '$(check) Test Connection',
        description: 'Verify endpoint reachability and list models'
      },
      {
        label: '$(trash) Remove Provider',
        description: 'Delete this provider and its stored API key'
      }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: `Manage: ${provider.nickname}`,
      placeHolder: 'Select an option'
    });

    if (!selected) {
      return true;
    }

    if (selected.label.includes('Edit Nickname / URL')) {
      await this.editProviderDetails(provider);
    } else if (selected.label.includes('Update / Rotate API Key')) {
      await this.rotateApiKey(provider);
    } else if (selected.label.includes('Manage Custom Models')) {
      await this.manageCustomModels(provider);
    } else if (selected.label.includes('Test Connection')) {
      await this.testProviderConnection(provider);
    } else if (selected.label.includes('Remove Provider')) {
      await this.deleteProviderFlow(provider);
    }

    return true;
  }

  public async editProviderDetails(provider: ProviderEntry): Promise<void> {
    const apiKey = await this.registry.getApiKey(provider.id);

    const result = await showProviderForm('Edit Provider', {
      nickname: provider.nickname,
      baseUrl: provider.baseUrl,
      apiKey: apiKey ?? ''
    });

    if (result.cancelled || !result.nickname || !result.baseUrl) {
      return;
    }

    await this.registry.updateProvider(
      provider.id,
      {
        nickname: result.nickname,
        baseUrl: result.baseUrl
      },
      result.apiKey
    );

    void vscode.window.showInformationMessage(`Updated provider "${result.nickname}".`);
  }

  public async rotateApiKey(provider: ProviderEntry): Promise<void> {
    const newKey = await vscode.window.showInputBox({
      title: `Update API Key for "${provider.nickname}"`,
      prompt: 'Enter new API Key (leave completely blank to clear)',
      password: true,
      placeHolder: 'sk-...'
    });

    if (newKey === undefined) return;

    await this.registry.updateProvider(provider.id, {}, newKey);
    void vscode.window.showInformationMessage(
      newKey.trim().length > 0
        ? `API Key for "${provider.nickname}" updated successfully.`
        : `API Key for "${provider.nickname}" cleared.`
    );
  }

  private async manageCustomModels(provider: ProviderEntry): Promise<void> {
    const customModels = provider.customModels || [];
    const items: vscode.QuickPickItem[] = [
      {
        label: '$(add) Add Custom Model Override',
        description: 'Manually add a model ID if /v1/models is incomplete'
      }
    ];

    if (customModels.length > 0) {
      items.push({
        label: 'Current Custom Models',
        kind: vscode.QuickPickItemKind.Separator
      });

      for (const m of customModels) {
        items.push({
          label: `$(symbol-interface) ${m.modelId}`,
          description: m.displayName || m.modelId,
          detail: `Max In: ${m.capabilities?.maxInputTokens ?? 'Default'}, Tools: ${m.capabilities?.toolCalling ?? 'Default'}`
        });
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: `Custom Models: ${provider.nickname}`
    });

    if (!selected) return;

    if (selected.label.includes('Add Custom Model Override')) {
      const modelId = await vscode.window.showInputBox({
        title: 'Custom Model ID',
        prompt: 'Enter exact model ID used in chat completions (e.g. "qwen2.5-coder:32b")',
        placeHolder: 'e.g. qwen2.5:72b'
      });

      if (!modelId || modelId.trim().length === 0) return;

      const displayName = await vscode.window.showInputBox({
        title: 'Custom Display Name (Optional)',
        prompt: 'Display name to show in model picker (leave blank to use default)',
        value: `${provider.nickname}: ${modelId.trim()}`
      });

      const updatedModels: CustomModelOverride[] = [
        ...customModels.filter(m => m.modelId !== modelId.trim()),
        {
          modelId: modelId.trim(),
          displayName: displayName?.trim() || undefined
        }
      ];

      await this.registry.updateProvider(provider.id, {
        customModels: updatedModels
      });

      void vscode.window.showInformationMessage(`Added model override "${modelId.trim()}".`);
    } else {
      // Remove selected model override
      const rawModelId = selected.label.replace('$(symbol-interface) ', '').trim();
      const confirm = await vscode.window.showWarningMessage(
        `Remove custom model override "${rawModelId}"?`,
        'Remove',
        'Cancel'
      );
      if (confirm === 'Remove') {
        const updatedModels = customModels.filter(m => m.modelId !== rawModelId);
        await this.registry.updateProvider(provider.id, {
          customModels: updatedModels
        });
        void vscode.window.showInformationMessage(`Removed custom model "${rawModelId}".`);
      }
    }
  }

  public async testProviderConnection(provider: ProviderEntry): Promise<void> {
    const apiKey = await this.registry.getApiKey(provider.id);
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Testing connection to ${provider.nickname}...`,
        cancellable: false
      },
      async () => {
        const result = await OpenAIClient.testConnection(
          provider.baseUrl,
          apiKey,
          provider.customHeaders
        );
        if (result.success) {
          void vscode.window.showInformationMessage(
            `Connection successful! Found ${result.modelCount} model(s) on "${provider.nickname}".`
          );
        } else {
          void vscode.window.showErrorMessage(
            `Connection to "${provider.nickname}" failed: ${result.error}`
          );
        }
      }
    );
  }

  public async deleteProviderFlow(provider: ProviderEntry): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      `Are you sure you want to remove "${provider.nickname}"? Any stored API key will be deleted.`,
      { modal: true },
      'Delete'
    );

    if (choice === 'Delete') {
      await this.registry.deleteProvider(provider.id);
      void vscode.window.showInformationMessage(`Provider "${provider.nickname}" was removed.`);
    }
  }

  public async refreshModelsFlow(): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Refreshing models from all providers...',
        cancellable: false
      },
      async () => {
        const models = await this.provider.refresh(true);
        void vscode.window.showInformationMessage(
          `Refreshed models: ${models.length} model(s) available across configured providers.`
        );
      }
    );
  }
}
