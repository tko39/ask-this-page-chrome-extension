# Ask This Page (llama.cpp)

A complete Chrome Manifest V3 extension that adds:

- a floating **?** button to normal HTTP/HTTPS pages;
- a Chrome toolbar action that opens the same panel;
- a chat UI that asks a local-network `llama-server.exe` about the page's **current live DOM**;
- multi-turn conversation and llama.cpp prompt-cache reuse;
- automatic loaded-model discovery from `/v1/models`;
- configurable endpoint, optional API key, system prompt, DOM limit, output length, temperature, and optional model override.

The default server endpoint is:

`http://192.168.1.107:11434/v1/chat/completions`

It can be changed from the panel's **Settings** screen without modifying the manifest or reloading the extension. A base URL such as `http://localhost:8080` is also accepted; `/v1/chat/completions` is appended automatically.

## Install

1. Extract `page-llama-extension.zip` (or use the `page-llama` folder directly).
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `page-llama` folder.
5. Open or reload a normal web page, then click the floating **?** or the extension's toolbar icon.

Chrome does not allow extensions to inject this panel into Chrome-owned pages such as `chrome://extensions` or the Chrome Web Store.

## Run llama-server.exe

The exact model flags depend on your installation. A representative Windows command for the default endpoint is:

```powershell
.\llama-server.exe --model C:\models\your-instruct-model.gguf --host 0.0.0.0 --port 11434 --ctx-size 32768
```

The model should be an instruction/chat model with a supported chat template. Ensure Windows Firewall permits TCP port `11434` on the appropriate private network. You can test connectivity from the Chrome machine by opening:

`http://192.168.1.107:11434/v1/models`

For a server protected by a bearer token, enter the token under **API key** in Settings. It is stored in Chrome's local extension storage and sent only to the configured endpoint. This is convenient rather than a hardened secrets vault; do not use a highly privileged key.

## How page context and caching work

On the first question in a chat, the content script clones `document.documentElement`, removes scripts/styles/iframes and its own UI, reflects current form controls, redacts password inputs, truncates to the configured character limit, and sends that snapshot with the question.

Follow-ups include prior chat turns so the model retains context. The request sets llama.cpp's `cache_prompt: true`. `llama-server` compares the new prompt with the preceding prompt and can reuse the common-prefix KV cache rather than evaluating the unchanged DOM again. When supplied by the server, the UI shows the reused token count.

Important limitation: the OpenAI-compatible chat endpoint is stateless at the HTTP layer, so the unchanged message prefix is transmitted again even when its token computation is cached. Omitting the DOM from later requests would make a standard `llama-server` request forget it. Click **New** to capture a fresh DOM after the page changes; SPA URL changes reset the conversation automatically.

## Privacy and security

The live DOM can contain private page data, filled form values, account details, hidden content, and tokens embedded by a site. This extension sends the snapshot only to the hardcoded LAN server, but you should still use it only on pages whose contents may be shared with that machine. Password fields are redacted, but this is not a complete data-loss-prevention system.

Page text is explicitly marked as untrusted in the default system message to reduce prompt-injection risk. No prompt can guarantee complete protection, so treat model output as untrusted.

## Files

- `manifest.json` — Manifest V3 configuration and HTTP/HTTPS host permissions, allowing endpoints to be changed without editing the extension.
- `service-worker.js` — calls llama.cpp, discovers the loaded model, and reports errors/cache metrics.
- `content.js` — floating button, Shadow DOM chat UI, live-DOM capture, settings, and conversation state.

## Troubleshooting

- **Cannot reach server:** start `llama-server.exe` with `--host 0.0.0.0`, verify the configured endpoint and port, and check the firewall.
- **No loaded model:** verify `/v1/models` returns one model, or enter an exact model ID in the panel settings.
- **Context-size error:** reduce **Maximum DOM characters**, or start the server with a larger `--ctx-size`.
- **Button missing:** reload pages after installing. Chrome-owned pages cannot host the content script.
- **Model gives poor page answers:** use an instruct model with a correct chat template and consider raising the context size.
