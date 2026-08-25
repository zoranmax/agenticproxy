import * as vscode from 'vscode';
import { OpenAIClient } from '../services/openaiClient';

/**
 * Result returned by the WebView provider form.
 * `cancelled` is true when the user dismissed the form without saving.
 */
export interface ProviderFormResult {
  cancelled: boolean;
  saved?: boolean;
  nickname?: string;
  baseUrl?: string;
  apiKey?: string;
  deleted?: boolean;
}

export interface SaveResult {
  success: boolean;
  error?: string;
}

/**
 * Renders a WebView-based form for adding or editing a provider.
 *
 * Unlike `showInputBox` / `showQuickPick`, a WebView panel does NOT close when
 * it loses focus, so the user can freely copy/paste values from other windows
 * or the editor while the form stays open.
 *
 * When `onSubmit` is provided, saving the form calls the callback and keeps
 * the panel open — showing a success or error message inline. The promise
 * resolves only on Cancel, Delete, or X close.
 */
export async function showProviderForm(
  title: string,
  initial?: { nickname?: string; baseUrl?: string; apiKey?: string },
  onSubmit?: (data: { nickname: string; baseUrl: string; apiKey?: string }) => Promise<SaveResult>
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

  panel.webview.html = getHtml({ title, nickname, baseUrl, apiKey, isEditing: !!initial });

  const result = await new Promise<ProviderFormResult>(resolve => {
    let resolved = false;
    let testCts: vscode.CancellationTokenSource | undefined;

    const disposable = panel.webview.onDidReceiveMessage(async msg => {
      const data = msg as {
        type?: string;
        nickname?: string;
        baseUrl?: string;
        apiKey?: string;
      };

      if (data.type === 'confirm-delete') {
        const choice = await vscode.window.showWarningMessage(
          'Are you sure you want to permanently delete this provider? This action cannot be undone.',
          { modal: true },
          'Delete'
        );
        if (choice === 'Delete') {
          if (testCts) {
            testCts.cancel();
            testCts.dispose();
            testCts = undefined;
          }
          resolved = true;
          disposable.dispose();
          resolve({ cancelled: false, deleted: true });
          panel.dispose();
        }
        return;
      }

      if (data.type === 'cancel-test') {
        if (testCts) {
          testCts.cancel();
          testCts.dispose();
          testCts = undefined;
        }
        panel.webview.postMessage({
          type: 'test-result',
          success: false,
          cancelled: true,
          error: 'Test cancelled by user'
        });
        return;
      }

      if (data.type === 'test') {
        if (testCts) {
          testCts.cancel();
          testCts.dispose();
        }
        testCts = new vscode.CancellationTokenSource();
        const currentCts = testCts;

        const baseUrl = (data.baseUrl ?? '').trim();
        const apiKey = data.apiKey ?? '';
        try {
          const models = await OpenAIClient.fetchModels(
            baseUrl,
            apiKey,
            undefined,
            currentCts.token,
            8000
          );
          if (currentCts.token.isCancellationRequested) {
            return;
          }
          panel.webview.postMessage({
            type: 'test-result',
            success: true,
            models
          });
        } catch (err: unknown) {
          if (currentCts.token.isCancellationRequested) {
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          panel.webview.postMessage({
            type: 'test-result',
            success: false,
            error: msg
          });
        } finally {
          if (testCts === currentCts) {
            currentCts.dispose();
            testCts = undefined;
          }
        }
        return;
      }

      if (data.type === 'submit') {
        if (testCts) {
          testCts.cancel();
          testCts.dispose();
          testCts = undefined;
        }
        const nickname = (data.nickname ?? '').trim();
        const baseUrl = (data.baseUrl ?? '').trim();
        const apiKey = data.apiKey ?? '';

        if (onSubmit) {
          const saveResult = await onSubmit({ nickname, baseUrl, apiKey });
          if (saveResult.success) {
            resolved = true;
            disposable.dispose();
            resolve({ cancelled: false, saved: true, nickname, baseUrl, apiKey });
            panel.dispose();
          } else {
            panel.webview.postMessage({
              type: 'save-error',
              error: saveResult.error
            });
          }
        } else {
          resolved = true;
          disposable.dispose();
          resolve({
            cancelled: false,
            saved: true,
            nickname,
            baseUrl,
            apiKey
          });
          panel.dispose();
        }
        return;
      }

      if (data.type === 'cancel') {
        if (testCts) {
          testCts.cancel();
          testCts.dispose();
          testCts = undefined;
        }
        resolved = true;
        disposable.dispose();
        resolve({ cancelled: true });
        panel.dispose();
        return;
      }
    });

    // If the panel is closed via the X button, treat it as a cancel.
    panel.onDidDispose(() => {
      if (testCts) {
        testCts.cancel();
        testCts.dispose();
        testCts = undefined;
      }
      if (!resolved) {
        disposable.dispose();
        resolve({ cancelled: true });
      }
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
  isEditing: boolean;
}): string {
  const { title, nickname, baseUrl, apiKey, isEditing } = input;
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
    --accent-hover: #1177bb;
    --error: #f14c4c;
    --success: #89d185;
    --badge-bg: #2d2d2d;
  }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    padding: 20px 24px;
    box-sizing: border-box;
  }
  h1 { font-size: 15px; margin: 0 0 16px; font-weight: 600; }
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
  .hint { color: #8a8a8a; font-size: 12px; margin-top: 4px; }
  .actions {
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .actions-left {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .actions-right {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  button {
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: #0e639c;
    color: #ffffff;
    cursor: pointer;
    font-size: var(--vscode-font-size, 13px);
    font-family: inherit;
  }
  button:hover:not(:disabled) { background: var(--accent-hover); }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  button.secondary {
    background: #3a3d41;
    color: var(--fg);
  }
  button.secondary:hover:not(:disabled) {
    background: #45494e;
  }
  button.danger {
    background: transparent;
    color: var(--error);
    border-color: var(--error);
  }
  button.danger:hover:not(:disabled) {
    background: rgba(241, 76, 76, 0.15);
  }
  .test-status {
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: 4px;
    font-size: 12px;
    display: none;
  }
  .test-status.loading {
    display: block;
    background: #252526;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .test-status.success {
    display: block;
    background: #1e3323;
    color: var(--success);
    border: 1px solid #2e5936;
  }
  .test-status.error {
    display: block;
    background: #3a1c1c;
    color: #f48771;
    border: 1px solid #5a2d2d;
  }
  .model-list-header {
    font-weight: 600;
    margin-bottom: 6px;
  }
  .models-container {
    max-height: 180px;
    overflow-y: auto;
    margin-top: 6px;
    padding: 6px 8px;
    background: #181818;
    border: 1px solid var(--border);
    border-radius: 3px;
  }
  .model-tag {
    display: inline-block;
    background: var(--badge-bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 2px 6px;
    border-radius: 3px;
    margin: 2px 4px 2px 0;
    font-family: monospace;
    font-size: 11px;
  }
  .save-instruction {
    color: #8a8a8a;
    font-size: 12px;
    margin-top: 8px;
  }
  .status { margin-top: 12px; padding: 8px 12px; border-radius: 2px; font-size: 12px; display: none; }
  .status.error { display: block; background: #3a1c1c; color: #f48771; border: 1px solid #5a2d2d; }
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
    <div class="actions-left">
      <button id="testBtn">Test</button>
      <button id="saveBtn" style="display:none;">Save</button>
      <button id="cancelBtn" class="secondary">Cancel</button>
    </div>
    ${isEditing ? `
    <div class="actions-right">
      <button id="deleteBtn" class="danger">Delete</button>
    </div>
    ` : ''}
  </div>

  <div class="save-instruction" id="saveInstruction">Please click <strong>Test</strong> to verify connection and retrieve models before saving.</div>

  <div id="testStatus" class="test-status"></div>
  <div id="status" class="status"></div>

<script>
  const vscode = acquireVsCodeApi();

  const nicknameInput = document.getElementById('nickname');
  const baseUrlInput = document.getElementById('baseUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const nicknameError = document.getElementById('nicknameError');
  const baseUrlError = document.getElementById('baseUrlError');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const testBtn = document.getElementById('testBtn');
  const testStatus = document.getElementById('testStatus');
  const saveInstruction = document.getElementById('saveInstruction');

  let testPassed = false;
  let isTesting = false;

  function invalidateTest() {
    testPassed = false;
    saveBtn.style.display = 'none';
    testBtn.style.display = 'inline-block';
    testBtn.textContent = 'Test';
    testBtn.className = '';
    saveInstruction.style.display = 'block';
    saveInstruction.innerHTML = 'Provider configuration changed. Click <strong>Test</strong> to verify connection and enable Save.';
  }

  baseUrlInput.addEventListener('input', invalidateTest);
  apiKeyInput.addEventListener('input', invalidateTest);

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

  function runTest() {
    if (isTesting) {
      // Cancel existing in-flight test
      vscode.postMessage({ type: 'cancel-test' });
      isTesting = false;
      testBtn.textContent = 'Test';
      testBtn.className = '';
      testStatus.className = 'test-status';
      testStatus.textContent = '';
      return;
    }

    if (!validate()) return;
    isTesting = true;
    testBtn.textContent = 'Cancel Test';
    testBtn.className = 'danger';
    testStatus.className = 'test-status loading';
    testStatus.textContent = 'Testing connection and retrieving models... (click "Cancel Test" to abort)';

    vscode.postMessage({
      type: 'test',
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value
    });
  }

  function submit() {
    if (!testPassed) return;
    if (!validate()) return;
    const payload = {
      type: 'submit',
      nickname: nicknameInput.value.trim(),
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value
    };
    vscode.postMessage(payload);
  }

  function cancel() {
    if (isTesting) {
      vscode.postMessage({ type: 'cancel-test' });
    }
    vscode.postMessage({ type: 'cancel' });
  }

  saveBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', cancel);
  testBtn.addEventListener('click', runTest);

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'confirm-delete' });
    });
  }

  // Allow Enter in nickname to submit only if test passed
  nicknameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (testPassed) {
        submit();
      } else {
        runTest();
      }
    }
  });

  // Focus the first empty field on load.
  if (!nicknameInput.value) {
    nicknameInput.focus();
  } else if (!baseUrlInput.value) {
    baseUrlInput.focus();
  } else {
    apiKeyInput.focus();
  }

  // Listen for messages from the extension host.
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'save-error') {
      const statusEl = document.getElementById('status');
      statusEl.className = 'status error';
      statusEl.textContent = 'Save failed: ' + (msg.error || 'Unknown error');
    } else if (msg.type === 'test-result') {
      isTesting = false;
      if (msg.cancelled) {
        testPassed = false;
        testBtn.style.display = 'inline-block';
        testBtn.textContent = 'Test';
        testBtn.className = '';
        saveBtn.style.display = 'none';
        saveInstruction.style.display = 'block';
        saveInstruction.innerHTML = 'Test was cancelled. Click <strong>Test</strong> to verify connection and enable Save.';
        testStatus.className = 'test-status';
        testStatus.textContent = '';
      } else if (msg.success) {
        const models = Array.isArray(msg.models) ? msg.models : [];
        testPassed = true;
        testBtn.style.display = 'none';
        saveBtn.style.display = 'inline-block';
        saveInstruction.style.display = 'none';

        testStatus.className = 'test-status success';
        let html = '<div class="model-list-header">✓ Connection successful! Retrieved ' + models.length + ' model(s):</div>';
        if (models.length > 0) {
          html += '<div class="models-container">';
          for (let i = 0; i < models.length; i++) {
            const escaped = models[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += '<span class="model-tag">' + escaped + '</span>';
          }
          html += '</div>';
        } else {
          html += '<div style="margin-top: 4px; font-style: italic;">No models returned from endpoint.</div>';
        }
        testStatus.innerHTML = html;
      } else {
        testPassed = false;
        testBtn.style.display = 'inline-block';
        testBtn.textContent = 'Test';
        testBtn.className = '';
        saveBtn.style.display = 'none';
        saveInstruction.style.display = 'block';
        saveInstruction.innerHTML = 'Test failed. Please check the URL and API key and click <strong>Test</strong> again.';
        testStatus.className = 'test-status error';
        testStatus.textContent = '✗ Connection failed: ' + (msg.error || 'Unknown error');
      }
    }
  });

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