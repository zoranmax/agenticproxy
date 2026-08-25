# AgenticProxy for VS Code

**AgenticProxy** lets you use any number of **OpenAI-compatible** model endpoints as first-class chat models inside VS Code Chat — mixing local models (Ollama, vLLM, LM Studio, llama.cpp, LocalAI) and hosted APIs (DeepSeek, Groq, OpenRouter, Together, SiliconFlow) all in the **same model picker** you use for Copilot.

Works with streaming, tool/function calling, and keeps your API keys secure in the OS keychain. Built on VS Code's official **Language Model Chat Provider API** (VS Code 1.104+).

---

## ✨ Why AgenticProxy?

VS Code Chat natively supports only a handful of model vendors. AgenticProxy fills the gap:

- **One vendor, many endpoints** — unlimited OpenAI-compatible providers under a single "AgenticProxy" vendor in the model picker.
- **Mix local & cloud** — Ollama on one machine, DeepSeek on another, Groq on a third — all in the same workflow.
- **No code, no config files** — manage everything through friendly menus and a sidebar view; no JSON editing.
- **Secure by design** — API keys live only in VS Code's encrypted `SecretStorage` (macOS Keychain / Windows Credential Manager / Linux Secret Service). Keys are never written to disk or logged.

---

## ✨ Features

- **Automatic Model Discovery** — queries `GET {baseUrl}/models` for every configured endpoint, with **per-provider error isolation** (one offline server never breaks the others).
- **Custom Model Overrides** — add explicit model IDs and display names when an endpoint's `/models` route is missing or incomplete.
- **Streaming & Tool Calling** — token-by-token streaming, with tool/function calling deltas reconstructed for agentic workflows.
- **Rich Sidebar View** — dedicated activity-bar view: add providers, expand per-provider model lists, configure, or delete with one click.
- **Connection Testing** — every provider is validated against the endpoint before saving, so bad URLs/keys are caught instantly.
- **Secret Rotation** — update or clear API keys without re-creating a provider.

---

## 🚀 Getting Started

### Installation

| Method | Steps |
| --- | --- |
| **Marketplace** | Extensions view (`Cmd+Shift+X`) → search **AgenticProxy** → **Install**. |
| **VSIX** | `npm run vsce:package` → `code --install-extension agenticproxy-*.vsix` |
| **Development** | Clone repo → `npm install` → press `F5` (Run Extension). |

### Add your first provider

1. Open VS Code Chat (`Cmd+Alt+I` / `Ctrl+Alt+I`).
2. Click the **model picker** → select **Manage Language Models** — or run **`AgenticProxy: Manage Providers`** from the Command Palette.
3. Select **Add New Provider** and fill in:
   - **Nickname** — a human label, e.g. `Local Ollama`, `DeepSeek`.
   - **Base URL** — the OpenAI-compatible root, e.g. `http://localhost:11434/v1` or `https://api.deepseek.com/v1`.
   - **API Key** *(optional)* — leave blank for local servers without authentication.
4. AgenticProxy **tests the connection automatically** and registers every discovered model in the Chat model picker.

> The provider form is a dedicated, persistent view that stays open when focus moves — so you can copy/paste URLs and keys across windows without losing your place.

### Pick an AgenticProxy model in Chat

- Open Chat, click the model dropdown → under **AgenticProxy** you'll see every provider/model pair (e.g. `Local Ollama: llama3.3:70b`, `DeepSeek: deepseek-chat`).
- Switching models is instant — the prompt is routed to that endpoint at request time.

---

## 🧭 The Sidebar

AgenticProxy adds a dedicated activity-bar icon (plug ⚡). The **Providers** view shows:

- **+ Add Provider** — shortcut to add a new endpoint.
- **Refresh All Models** — re-queries `/models` across every provider.
- **Provider cards** — nickname, base URL, model count; **View Models** expands the list; **Configure** opens per-provider management (edit / key / overrides / test / delete); **Delete** removes the provider and its secret key.

---

## 🛠 Commands & Settings

### Commands

| Command | Description |
| --- | --- |
| `AgenticProxy: Manage Providers` | Open the full management flow (add/edit/test/rotate/delete, custom models). |
| `AgenticProxy: Refresh Models` | Manually re-query `/models` across all providers. |

### Settings (`settings.json`)

| Setting | Default | Description |
| --- | --- | --- |
| `agenticproxy.defaultMaxInputTokens` | `128000` | Context-window fallback for discovered models when the endpoint doesn't report one. |
| `agenticproxy.defaultMaxOutputTokens` | `4096` | Max output tokens fallback for discovered models. |
| `agenticproxy.requestTimeoutSeconds` | `60` | Timeout (seconds) for model-discovery requests. |

---

## 🔒 Security & Privacy

- **Keys never touch disk.** API keys are stored via VS Code's `SecretStorage` (macOS Keychain, Windows Credential Manager, Linux Secret Service) and re-hydrated only when a request is actually made.
- **Deletion wipes keys.** Removing a provider also deletes its key from the secret store.
- **Header tampering blocked.** Your `Authorization` header is always set from the stored key; custom headers can't override it.
- **No telemetry.** The extension never sends logs, key material, or prompts anywhere except the endpoints you explicitly configured.

---

## 📡 Supported Endpoints

Compatible with any OpenAI-protocol server:

- **Local / self-hosted:** Ollama (`/v1`), vLLM, LM Studio, llama.cpp server, LocalAI, text-gen webui, TabbyAPI, and more.
- **Hosted:** DeepSeek, Groq, OpenRouter, Together AI, Mistral, Moonshot, SiliconFlow, and any other `api.*/v1` endpoint.

> Some servers don't expose a complete `/models` list or support streaming. If yours is quirky, use **Custom Model Overrides** (under the provider's details menu) to explicitly register model IDs, display names, and token/tool capabilities.

---

## ⚠️ Limitations

- Requires VS Code **1.104+**.
- Model lists are updated on edit/save/refresh — not auto-polled (use `AgenticProxy: Refresh Models`).
- **Per-model capabilities** (image input, tool calls) are best-effort heuristics — endpoints that don't advertise use defaults (`tool calling: true`, `image input: false`).
- `max_input_tokens` / `max_output_tokens` are heuristic; tune the settings if a model gets truncated.
- Token counting is an estimate (≈4 chars/token), not an exact tokenizer — fine for context management, not for billing.

---

## 🤝 Contributing

Issues, feature requests, and PRs are welcome — see [DEVELOPMENT.md](DEVELOPMENT.md) for architecture, dev commands, and publishing.

---

## 📄 License

[MIT](LICENSE)