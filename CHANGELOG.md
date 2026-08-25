# Changelog

All notable changes to **AgenticProxy** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-24

### Added
- Initial public release as **AgenticProxy**.
- Register multiple OpenAI-compatible endpoints as chat models in VS Code Chat.
- WebView-based sidebar view with:
  - Prominent **Add Provider** button.
  - Inline **Configure** and **Delete** actions per provider.
  - Expandable **View Models** section per provider.
  - **Refresh All Models** action.
- WebView-based provider form (nickname, base URL, API key) that stays open on focus loss for easy copy/paste.
- Secure API key storage via VS Code SecretStorage (OS keychain).
- Automatic model discovery from `/v1/models` with per-provider error isolation.
- Custom model overrides for endpoints with incomplete model lists.
- Streaming chat completions with tool-calling support.
- Activity bar icon and sidebar view container.