const detectedModels = new Map();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-panel" });
  } catch {
    // Chrome's own pages and the Web Store do not allow content scripts.
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ask-llama") return false;

  askLlama(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));

  return true;
});

async function askLlama({ messages, settings }) {
  const chatUrl = normalizeChatUrl(settings.endpoint);
  const apiKey = settings.apiKey?.trim() || "no-key";
  const model = settings.model?.trim() || await getLoadedModel(chatUrl, apiKey);
  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      cache_prompt: true,
      temperature: clamp(Number(settings.temperature), 0, 2, 0.2),
      max_tokens: clamp(Math.round(Number(settings.maxTokens)), 64, 8192, 1024)
    })
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `HTTP ${response.status}`);
  }

  const answer = data?.choices?.[0]?.message?.content;
  if (typeof answer !== "string") {
    throw new Error("The server response did not contain choices[0].message.content.");
  }

  return {
    answer,
    model,
    cachedTokens: data?.timings?.cache_n ?? data?.usage?.prompt_tokens_details?.cached_tokens ?? null,
    promptTokens: data?.usage?.prompt_tokens ?? null
  };
}

async function getLoadedModel(chatUrl, apiKey) {
  const modelsUrl = modelsUrlFromChat(chatUrl);
  if (detectedModels.has(modelsUrl)) return detectedModels.get(modelsUrl);

  const response = await fetch(modelsUrl, {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    throw new Error(`Could not discover the loaded model (HTTP ${response.status}).`);
  }

  const data = await response.json();
  const id = data?.data?.[0]?.id;
  if (!id) throw new Error("llama-server reports no loaded model at /v1/models.");
  detectedModels.set(modelsUrl, id);
  return id;
}

function normalizeChatUrl(input) {
  const fallback = "http://192.168.1.107:11434/v1/chat/completions";
  const raw = String(input || fallback).trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The endpoint is not a valid URL.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("The endpoint must use HTTP or HTTPS.");
  if (!/\/chat\/completions\/?$/.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/chat/completions`.replace(/\/v1\/v1\//, "/v1/");
  }
  return url.toString();
}

function modelsUrlFromChat(chatUrl) {
  const url = new URL(chatUrl);
  url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "/models");
  url.search = "";
  url.hash = "";
  return url.toString();
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch/i.test(message)) {
    return "Cannot reach the configured endpoint. Check the URL, that llama-server.exe is listening on the network (for example --host 0.0.0.0), and that the firewall allows its port.";
  }
  return message;
}
