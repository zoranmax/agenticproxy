import * as vscode from 'vscode';
import { ProviderRegistry } from '../services/providerRegistry';
import { ProviderEntry } from '../types';

/**
 * Tree item kinds used to distinguish providers, models, and action rows.
 */
enum NodeKind {
  Provider = 'provider',
  Model = 'model',
  Action = 'action'
}

/**
 * Element type stored in the AgenticProxy sidebar tree.
 */
export interface ProviderTreeNode {
  kind: NodeKind;
  providerId?: string;
  modelId?: string;
  label: string;
  description?: string;
  detail?: string;
  icon?: string;
  action?: 'add' | 'refresh' | 'edit' | 'test';
}

/**
 * Tree data provider for the "AgenticProxy" sidebar view.
 *
 * Shows every configured provider as a top-level node, with its discovered
 * models (and custom overrides) as children, plus quick-action rows.
 */
export class ProviderTreeProvider implements vscode.TreeDataProvider<ProviderTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    ProviderTreeNode | undefined | null | void
  >();
  public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly registry: ProviderRegistry) {
    // Refresh the tree whenever providers change (add/edit/delete).
    this.registry.onDidChangeProviders(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: ProviderTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label);

    switch (element.kind) {
      case NodeKind.Provider:
        item.iconPath = new vscode.ThemeIcon('server');
        item.description = element.description;
        item.contextValue = 'agenticproxyProvider';
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        break;
      case NodeKind.Model:
        item.iconPath = new vscode.ThemeIcon('symbol-interface');
        item.description = element.description;
        item.contextValue = 'agenticproxyModel';
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        break;
      case NodeKind.Action:
        item.iconPath = new vscode.ThemeIcon(element.icon ?? 'add');
        item.description = element.description;
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        break;
    }

    return item;
  }

  public async getChildren(element?: ProviderTreeNode): Promise<ProviderTreeNode[]> {
    // Root level: providers + global actions
    if (!element) {
      const providers = this.registry.getProviders();
      const nodes: ProviderTreeNode[] = [];

      nodes.push({
        kind: NodeKind.Action,
        label: 'Add Provider',
        description: 'Configure a new endpoint',
        icon: 'add',
        action: 'add'
      });

      nodes.push({
        kind: NodeKind.Action,
        label: 'Refresh All Models',
        description: 'Re-query /models from all providers',
        icon: 'refresh',
        action: 'refresh'
      });

      for (const p of providers) {
        nodes.push({
          kind: NodeKind.Provider,
          providerId: p.id,
          label: p.nickname,
          description: p.baseUrl
        });
      }

      return nodes;
    }

    // Provider node: show its models + actions
    if (element.kind === NodeKind.Provider && element.providerId) {
      const provider = this.registry.getProviderById(element.providerId);
      if (!provider) {
        return [];
      }

      const nodes: ProviderTreeNode[] = [];

      // Full list of models for this provider: discovered (cached) + custom overrides
      const modelIds = this.collectModelIds(provider);
      for (const modelId of modelIds) {
        nodes.push({
          kind: NodeKind.Model,
          providerId: provider.id,
          modelId,
          label: modelId,
          description: 'Model'
        });
      }

      if (modelIds.length === 0) {
        nodes.push({
          kind: NodeKind.Action,
          label: 'No models discovered',
          description: 'Click to test connection',
          icon: 'info',
          action: 'test'
        });
      }

      nodes.push({
        kind: NodeKind.Action,
        label: 'Edit Provider',
        description: 'Change nickname, URL, or API key',
        icon: 'edit',
        action: 'edit'
      });

      nodes.push({
        kind: NodeKind.Action,
        label: 'Test Connection',
        description: 'Verify endpoint reachability',
        icon: 'check',
        action: 'test'
      });

      return nodes;
    }

    return [];
  }

  /**
   * Returns the full set of model IDs for a provider: persisted discovered
   * models plus any manual custom overrides.
   */
  private collectModelIds(provider: ProviderEntry): string[] {
    const ids = new Set<string>();

    // Discovered models persisted by the provider after a refresh.
    for (const modelId of provider.discoveredModels ?? []) {
      ids.add(modelId);
    }

    // Manual custom overrides
    for (const custom of provider.customModels ?? []) {
      ids.add(custom.modelId);
    }

    return Array.from(ids);
  }
}