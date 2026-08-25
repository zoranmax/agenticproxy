import * as vscode from 'vscode';
import { ProviderRegistry } from '../services/providerRegistry';
import { ProviderEntry } from '../types';

/**
   * WebView-based sidebar view for the "AgenticProxy" providers.
 *
 * Unlike a plain tree view, this renders a rich UI with a prominent
 * "Add Provider" button and inline Configure / Delete actions on each
 * provider card.
 */
export class ProviderSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly registry: ProviderRegistry) {
    // Refresh the view whenever providers change (add/edit/delete).
    this.registry.onDidChangeProviders(() => {
      this.refresh();
    });
  }

  private currentView?: vscode.WebviewView;

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Thenable<void> {
    this.currentView = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };

    webviewView.webview.onDidReceiveMessage(msg => {
      const data = msg as { type?: string; providerId?: string };
      if (data.type === 'add') {
        void vscode.commands.executeCommand('agenticproxy.addProvider');
      } else if (data.type === 'configure' && data.providerId) {
        void vscode.commands.executeCommand('agenticproxy.configureProvider', data.providerId);
      } else if (data.type === 'delete' && data.providerId) {
        void vscode.commands.executeCommand('agenticproxy.deleteProvider', data.providerId);
      } else if (data.type === 'refresh') {
        void vscode.commands.executeCommand('agenticproxy.refreshModels');
      }
    });

    this.render();
    return Promise.resolve();
  }

  /**
   * Re-renders the view HTML with the latest provider data.
   */
  public refresh(): void {
    if (this.currentView) {
      this.render();
    }
  }

  private render(): void {
    if (!this.currentView) {
      return;
    }
    const providers = this.registry.getProviders();
    this.currentView.webview.html = this.buildHtml(providers);
  }

  private buildHtml(providers: ProviderEntry[]): string {
    const cards = providers
      .map(p => {
        const models = this.collectModelIds(p);
        const modelRows = models
          .map(
            m => `
            <div class="model-row">
              <svg class="model-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                <rect x="4" y="2" width="8" height="12" rx="1"/>
                <rect x="6" y="5" width="4" height="1.5"/>
                <rect x="6" y="8" width="4" height="1.5"/>
                <rect x="6" y="11" width="4" height="1.5"/>
              </svg>
              <span>${this.escapeHtml(m)}</span>
            </div>
          `
          )
          .join('\n');

        return `
        <div class="card">
          <div class="card-header">
            <svg class="server-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <rect x="3" y="1" width="10" height="14" rx="1"/>
              <circle cx="8" cy="4" r="1.5"/>
              <rect x="5" y="8" width="6" height="1.5"/>
              <rect x="5" y="11" width="6" height="1.5"/>
            </svg>
            <span class="nickname">${this.escapeHtml(p.nickname)}</span>
            <span class="model-count">${models.length}</span>
          </div>
          <div class="url">${this.escapeHtml(p.baseUrl)}</div>
          <div class="actions">
            <button class="btn" data-action="toggle-models" data-id="${p.id}">View Models</button>
            <button class="btn" data-action="configure" data-id="${p.id}">Configure</button>
            <button class="btn danger" data-action="delete" data-id="${p.id}">Delete</button>
          </div>
          <div class="models" data-id="${p.id}" style="display:none">
            ${modelRows || '<div class="empty-models">No models discovered yet. Click Refresh All Models.</div>'}
          </div>
        </div>
      `;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --bg: #1e1e1e;
    --fg: #cccccc;
    --border: #3c3c3c;
    --accent: #0e639c;
    --danger: #f14c4c;
  }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    padding: 12px;
    box-sizing: border-box;
  }
  .add-btn {
    display: block;
    width: 100%;
    padding: 12px;
    background: var(--accent);
    color: #ffffff;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 16px;
  }
  .add-btn:hover { opacity: 0.9; }
  .refresh-btn {
    display: block;
    width: 100%;
    padding: 8px;
    background: #3a3d41;
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    margin-bottom: 16px;
  }
  .card {
    background: #252526;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .server-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--fg);
  }
  .url {
    color: #8a8a8a;
    font-size: 12px;
    margin-top: 4px;
    word-break: break-all;
  }
  .model-count {
    background: #3a3d41;
    color: var(--fg);
    border-radius: 8px;
    padding: 0 6px;
    font-size: 11px;
    margin-left: auto;
  }
  .models {
    margin-top: 8px;
    border-top: 1px solid var(--border);
    padding: 6px 0;
  }
  .model-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 12px;
    color: var(--fg);
    word-break: break-all;
  }
  .model-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--fg);
  }
  .empty-models {
    color: #8a8a8a;
    font-size: 12px;
    padding: 4px 0;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .btn {
    padding: 5px 12px;
    background: #3a3d41;
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn:hover { opacity: 0.9; }
  .btn.danger {
    background: transparent;
    color: var(--danger);
    border-color: var(--danger);
  }
  .empty {
    color: #8a8a8a;
    text-align: center;
    margin-top: 24px;
  }
</style>
</head>
<body>
  <button class="add-btn" data-action="add">+ Add Provider</button>
  <button class="refresh-btn" data-action="refresh">Refresh All Models</button>
  ${cards || '<div class="empty">No providers configured yet.</div>'}
<script>
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'toggle-models') {
        const models = document.querySelector('.models[data-id="' + btn.dataset.id + '"]');
        if (models) {
          const hidden = models.style.display === 'none';
          models.style.display = hidden ? 'block' : 'none';
          btn.textContent = hidden ? 'Hide Models' : 'View Models';
        }
        return;
      }
      vscode.postMessage({
        type: btn.dataset.action,
        providerId: btn.dataset.id
      });
    });
  });
</script>
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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