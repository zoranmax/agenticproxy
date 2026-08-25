import * as vscode from 'vscode';

/**
 * Result returned by the WebView provider form.
 * `cancelled` is true when the user dismissed the form without saving.
 */
export interface ProviderFormResult {
  cancelled: boolean;
  nickname?: string;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Renders a WebView-based form for adding or editing a provider.
 *
 * Unlike `showInputBox` / `showQuickPick`, a WebView panel does NOT close when
 * it loses focus, so the user can freely copy/paste values from other windows
 * or the editor while the form stays open.
 */
export async function showProviderForm(
  title: string,
  initial?: { nickname?: string; baseUrl?: string; apiKey?: string }
): Promise<ProviderFormResult> {
  const panel = vscode.window.createWebviewPanel(
    'agenticproxy.providerForm',
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      localResourceRoots: []
    }
  );

  const nickname = initial?.nickname ?? '';
  const baseUrl = initial?.baseUrl ?? '';
  const apiKey = initial?.apiKey ?? '';

  panel.webview.html = getHtml({ title, nickname, baseUrl, apiKey });

  const result = await new Promise<ProviderFormResult>(resolve => {
    const disposable = panel.webview.onDidReceiveMessage(msg => {
      const data = msg as { type?: string; nickname?: string; baseUrl?: string; apiKey?: string };
      if (data.type === 'submit') {
        disposable.dispose();
        resolve({
          cancelled: false,
          nickname: data.nickname,
          baseUrl: data.baseUrl,
          apiKey: data.apiKey
        });
      } else if (data.type === 'cancel') {
        disposable.dispose();
        resolve({ cancelled: true });
      }
    });

    // If the panel is closed via the X button, treat it as a cancel.
    panel.onDidDispose(() => {
      disposable.dispose();
      resolve({ cancelled: true });
    });
  });

  return result;
}

/**
 * Builds the HTML document for the provider form.
 */
function getHtml(input: {
  title: string;
  nickname: string;
  baseUrl: string;
  apiKey: string;
}): string {
  const { title, nickname, baseUrl, apiKey } = input;
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
    --error: #f14c4c;
  }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    padding: 20px 24px;
    box-sizing: border-box;
  }
  h1 { font-size: 15px; margin: 0 0 16px; }
  label { display: block; margin-bottom: 4px; font-weight: 600; }
  input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    background: #252526;
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 2px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
  }
  input:focus { outline: none; border-color: var(--accent); }
  .field { margin-bottom: 14px; }
  .error { color: var(--error); font-size: 12px; margin-top: 4px; display: none; }
  .actions { margin-top: 18px; display: flex; gap: 8px; }
  button {
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: #0e639c;
    color: #ffffff;
    cursor: pointer;
    font-size: var(--vscode-font-size, 13px);
  }
  button.secondary {
    background: #3a3d41;
    color: var(--fg);
  }
  button:hover { opacity: 0.9; }
  .hint { color: #8a8a8a; font-size: 12px; margin-top: 4px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>

  <div class="field">
    <label for="nickname">Nickname</label>
    <input id="nickname" type="text" value="${escapeAttr(nickname)}" placeholder="e.g. Local vLLM" autocomplete="off" />
    <div class="error" id="nicknameError">Nickname cannot be empty.</div>
  </div>

  <div class="field">
    <label for="baseUrl">Base URL</label>
    <input id="baseUrl" type="text" value="${escapeAttr(baseUrl)}" placeholder="http://localhost:11434/v1" autocomplete="off" />
    <div class="error" id="baseUrlError">Please enter a valid URL starting with http:// or https://</div>
    <div class="hint">You can paste a URL here from any window — this form stays open.</div>
  </div>

  <div class="field">
    <label for="apiKey">API Key (optional)</label>
    <input id="apiKey" type="password" value="${escapeAttr(apiKey)}" placeholder="sk-..." autocomplete="off" />
    <div class="hint">Stored securely in the OS keychain. Leave blank if not required.</div>
  </div>

  <div class="actions">
    <button id="saveBtn">Save</button>
    <button id="cancelBtn" class="secondary">Cancel</button>
  </div>

<script>
  const nicknameInput = document.getElementById('nickname');
  const baseUrlInput = document.getElementById('baseUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const nicknameError = document.getElementById('nicknameError');
  const baseUrlError = document.getElementById('baseUrlError');

  function validate() {
    let ok = true;
    const nickname = nicknameInput.value.trim();
    const baseUrl = baseUrlInput.value.trim();

    if (!nickname) {
      nicknameError.style.display = 'block';
      ok = false;
    } else {
      nicknameError.style.display = 'none';
    }

    let urlValid = false;
    try {
      const u = new URL(baseUrl);
      urlValid = u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      urlValid = false;
    }
    if (!baseUrl || !urlValid) {
      baseUrlError.style.display = 'block';
      ok = false;
    } else {
      baseUrlError.style.display = 'none';
    }

    return ok;
  }

  function submit() {
    if (!validate()) return;
    const payload = {
      type: 'submit',
      nickname: nicknameInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value
    };
    const vscode = acquireVsCodeApi();
    vscode.postMessage(payload);
  }

  function cancel() {
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'cancel' });
  }

  document.getElementById('saveBtn').addEventListener('click', submit);
  document.getElementById('cancelBtn').addEventListener('click', cancel);

  // Allow Enter in any field to submit.
  [nicknameInput, baseUrlInput, apiKeyInput].forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
  });

  // Focus the first empty field on load.
  if (!nicknameInput.value) {
    nicknameInput.focus();
  } else if (!baseUrlInput.value) {
    baseUrlInput.focus();
  } else {
    apiKeyInput.focus();
  }

  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}