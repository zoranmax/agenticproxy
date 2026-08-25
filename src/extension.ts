import * as vscode from 'vscode';
import { OpenAIChatModelProvider } from './provider';
import { ProviderRegistry } from './services/providerRegistry';
import { ProviderManagementUI } from './ui/providerManagement';
import { ProviderSidebarProvider } from './ui/providerSidebar';

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('AgenticProxy');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine('AgenticProxy extension activating...');

  // 1. Initialize secure Provider Registry (Memento + SecretStorage)
  const registry = new ProviderRegistry(context.globalState, context.secrets);

  // 2. Initialize LanguageModelChatProvider
  const chatModelProvider = new OpenAIChatModelProvider(registry, outputChannel);

  // 3. Register LanguageModelChatProvider under contributed vendor "agenticproxy"
  const providerRegistration = vscode.lm.registerLanguageModelChatProvider(
    'agenticproxy',
    chatModelProvider
  );
  context.subscriptions.push(providerRegistration);

  // 4. Initialize Interactive UI Management
  const managementUI = new ProviderManagementUI(registry, chatModelProvider);

  // 5. Register Management Command (invoked by VS Code model picker or Command Palette)
  const manageCmd = vscode.commands.registerCommand('agenticproxy.manageProviders', async () => {
    try {
      await managementUI.showMainMenu();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Error opening provider manager: ${msg}`);
    }
  });
  context.subscriptions.push(manageCmd);

  // 6. Register Refresh Models Command
  const refreshCmd = vscode.commands.registerCommand('agenticproxy.refreshModels', async () => {
    try {
      await managementUI.refreshModelsFlow();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Error refreshing models: ${msg}`);
    }
  });
  context.subscriptions.push(refreshCmd);

  // 7. Register the sidebar WebView view provider
  const sidebarProvider = new ProviderSidebarProvider(registry);
  const sidebarRegistration = vscode.window.registerWebviewViewProvider(
    'agenticproxy.providers',
    sidebarProvider
  );
  context.subscriptions.push(sidebarRegistration);

  // 8. Command to add a provider (opens the same WebView form as Configure)
  const addCmd = vscode.commands.registerCommand('agenticproxy.addProvider', async () => {
    try {
      await managementUI.showAddProviderFlow();
      sidebarProvider.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`Error adding provider: ${msg}`);
    }
  });
  context.subscriptions.push(addCmd);

  // 9. Command to configure a provider (opens the same form used for adding, pre-filled)
  const configureCmd = vscode.commands.registerCommand(
    'agenticproxy.configureProvider',
    async (providerId: string) => {
      const provider = registry.getProviderById(providerId);
      if (!provider) {
        void vscode.window.showErrorMessage('Provider not found.');
        return;
      }
      await managementUI.editProviderDetails(provider);
      sidebarProvider.refresh();
    }
  );
  context.subscriptions.push(configureCmd);

  // 10. Command to delete a provider
  const deleteCmd = vscode.commands.registerCommand(
    'agenticproxy.deleteProvider',
    async (providerId: string) => {
      const provider = registry.getProviderById(providerId);
      if (!provider) {
        void vscode.window.showErrorMessage('Provider not found.');
        return;
      }
      await managementUI.deleteProviderFlow(provider);
      sidebarProvider.refresh();
    }
  );
  context.subscriptions.push(deleteCmd);

  outputChannel.appendLine('AgenticProxy extension activated successfully.');
}

export function deactivate() {
  // Clean up if needed
}
