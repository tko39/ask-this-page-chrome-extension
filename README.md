# Ask This Page (llama.cpp)

A Chrome Manifest V3 extension that lets you ask a local `llama-server.exe` about the current live DOM of any normal HTTP or HTTPS page.

It provides a floating **?** button, a toolbar toggle, streamed answers, multi-turn chat, safe Markdown rendering, automatic model discovery, and llama.cpp prompt-cache reuse. Settings include the server endpoint, API key, system prompt, DOM and output limits, temperature, model override, snapshot cleanup, and theme.

The initial endpoint is `http://localhost:11434/v1/chat/completions`. Change it in **Settings**; a base URL such as `http://192.168.1.107:11434` is also accepted and is completed with `/v1/chat/completions` automatically.

## Install

1. Extract `page-llama-extension.zip`, or use the `page-llama` folder directly.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `page-llama` folder.
5. Open or reload a normal web page and click the floating **?** button. Use the extension toolbar icon to hide or show the page UI.

The panel cannot be injected into Chrome-owned pages such as `chrome://extensions` or the Chrome Web Store.

## Run llama-server.exe

The exact flags depend on your installation. For a server reachable on port `11434`:

```powershell
.\llama-server.exe --model C:\models\your-instruct-model.gguf --host 0.0.0.0 --port 11434 --ctx-size 32768
```

Use an instruction/chat model with a supported chat template. For a server on another machine, bind it to the network interface and allow the port through Windows Firewall:

Test connectivity from the Chrome machine by opening `http://server-address:11434/v1/models`.

For a bearer-token server, enter the token under **API key** in **Settings**. It is stored in Chrome local extension storage and sent only to the configured endpoint. Do not use a highly privileged key.

## Use the extension

The first question captures a snapshot of the live page DOM and sends it with the question. The default cleanup removes scripts, media, page chrome, and form controls; password values are redacted in every mode. Follow-up questions reuse the same snapshot and conversation. Click **New** to capture the page again after it changes.

**Page snapshot cleanup** offers these modes:

- **Leave all tags** keeps page markup, apart from the extension UI and security redactions.
- **Remove scripts and media shells** removes executable content and common media shells.
- **Remove noisy page chrome and form tags** is the default and also removes navigation, forms, controls, and other page noise.
- **Text Only (dangerous)** sends normalized text without markup or hierarchy and may lose useful context.

The extension requests `cache_prompt: true`, allowing llama-server to reuse unchanged prompt tokens on follow-ups. The UI shows the reused token count when the server reports it. The full message history and snapshot are still sent because the OpenAI-compatible endpoint is stateless.

Answers stream into the panel while the model works. Slow model loads show status updates, and closing or navigating the tab cancels the request. URL changes in a single-page app reset the conversation automatically.

Completed answers render a safe Markdown subset. Raw HTML is displayed as text, and only `http:`, `https:`, and `mailto:` links are clickable.

## Privacy

The live DOM may contain private data, account details, hidden content, or tokens. The snapshot is sent to the configured server, so use the extension only on pages you are willing to share with that server. Cleanup and password redaction reduce exposure but are not complete data-loss prevention.

Page text is marked as untrusted in the default system prompt to reduce prompt-injection risk. Treat model output as untrusted.

## Appearance

The panel follows the browser or operating-system color scheme by default. Set **Theme** to **Light** or **Dark** for a persistent override.

## Files

- `manifest.json` - Manifest V3 configuration and HTTP/HTTPS host permissions.
- `service-worker.js` - llama.cpp requests, streaming, model discovery, and errors.
- `content.js` - page UI, live-DOM capture, cleanup, Markdown rendering, theme, and chat state.

## Troubleshooting

- **Cannot reach server:** verify the endpoint, port, `--host 0.0.0.0`, and Windows Firewall rules.
- **No loaded model:** verify `/v1/models` returns a model, or set an exact model ID in **Settings**.
- **Context-size error:** lower **Maximum DOM characters** or raise the server's `--ctx-size`.
- **Stream closes or has no text:** reload the extension and verify that the endpoint supports OpenAI-compatible streaming with `stream: true`.
- **Button missing:** reload the page after installation. Chrome-owned pages cannot host the content script.
- **Poor answers:** use an instruction/chat model with a correct chat template and increase the context size if needed.
