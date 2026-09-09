const detectedModels = new Map();
const STREAM_HEARTBEAT_MS = 15000;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-extension-ui" });
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

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ask-llama") return;

  const controller = new AbortController();
  let heartbeatId = null;
  let settled = false;

  port.onDisconnect.addListener(() => {
    if (!settled) controller.abort();
  });

  port.onMessage.addListener((message) => {
    if (message?.type !== "ask-llama") return;

    heartbeatId = startPortHeartbeat(port);
    streamLlama(message, port, controller.signal)
      .catch((error) =>
        postPort(port, {
          type: "error",
          error: friendlyError(error),
        }),
      )
      .finally(() => {
        settled = true;
        if (heartbeatId) clearInterval(heartbeatId);
      });
  });
});

async function askLlama({ messages, settings }) {
  const { chatUrl, model, request } = await buildChatRequest({
    messages,
    settings,
    stream: false,
  });
  const response = await fetch(chatUrl, request);

  const text = await response.text();
  const data = parseJsonResponse(text, response.status);

  if (!response.ok) {
    throw new Error(
      data?.error?.message || data?.error || `HTTP ${response.status}`,
    );
  }

  const answer = data?.choices?.[0]?.message?.content;
  if (typeof answer !== "string") {
    throw new Error(
      "The server response did not contain choices[0].message.content.",
    );
  }
  const reasoning =
    data?.choices?.[0]?.message?.reasoning_content ??
    data?.choices?.[0]?.message?.reasoning ??
    "";

  return {
    answer,
    reasoning,
    model,
    ...extractUsage(data),
  };
}

async function streamLlama({ messages, settings }, port, signal) {
  const { chatUrl, model, request } = await buildChatRequest({
    messages,
    settings,
    stream: true,
    signal,
  });
  const response = await fetch(chatUrl, request);

  if (!response.ok) {
    const text = await response.text();
    const data = tryParseJson(text);
    throw new Error(
      data?.error?.message ||
        data?.error ||
        `HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  if (!response.body) {
    throw new Error("The server did not provide a readable response stream.");
  }

  postPort(port, { type: "start", model });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let reasoning = "";
  let cachedTokens = null;
  let promptTokens = null;

  const processParsed = (parsed) => {
    if (!parsed) return false;
    if (parsed.done) {
      postPort(port, {
        type: "done",
        answer,
        reasoning,
        model,
        cachedTokens,
        promptTokens,
      });
      return true;
    }

    cachedTokens = parsed.cachedTokens ?? cachedTokens;
    promptTokens = parsed.promptTokens ?? promptTokens;
    if (parsed.reasoningDelta) {
      reasoning += parsed.reasoningDelta;
      postPort(port, { type: "reasoning-delta", delta: parsed.reasoningDelta });
    }
    if (parsed.delta) {
      answer += parsed.delta;
      postPort(port, { type: "delta", delta: parsed.delta });
    }
    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (processParsed(parseStreamLine(line))) return;
    }
  }

  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    if (processParsed(parseStreamLine(line))) return;
  }

  postPort(port, {
    type: "done",
    answer,
    reasoning,
    model,
    cachedTokens,
    promptTokens,
  });
}

async function buildChatRequest({ messages, settings, stream, signal }) {
  const chatUrl = normalizeChatUrl(settings.endpoint);
  const apiKey = settings.apiKey?.trim() || "no-key";
  const model =
    settings.model?.trim() || (await getLoadedModel(chatUrl, apiKey));
  const request = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream,
      cache_prompt: true,
      temperature: clamp(Number(settings.temperature), 0, 2, 0.2),
      max_tokens: clamp(Math.round(Number(settings.maxTokens)), 64, 8192, 1024),
    }),
  };
  if (signal) request.signal = signal;

  return { chatUrl, model, request };
}

async function getLoadedModel(chatUrl, apiKey) {
  const modelsUrl = modelsUrlFromChat(chatUrl);
  if (detectedModels.has(modelsUrl)) return detectedModels.get(modelsUrl);

  const response = await fetch(modelsUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(
      `Could not discover the loaded model (HTTP ${response.status}).`,
    );
  }

  const data = await response.json();
  const id = data?.data?.[0]?.id;
  if (!id)
    throw new Error("llama-server reports no loaded model at /v1/models.");
  detectedModels.set(modelsUrl, id);
  return id;
}

function normalizeChatUrl(input) {
  const fallback = "http://192.168.1.107:11434/v1/chat/completions";
  const raw = String(input || fallback)
    .trim()
    .replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The endpoint is not a valid URL.");
  }
  if (!/^https?:$/.test(url.protocol))
    throw new Error("The endpoint must use HTTP or HTTPS.");
  if (!/\/chat\/completions\/?$/.test(url.pathname)) {
    url.pathname =
      `${url.pathname.replace(/\/+$/, "")}/v1/chat/completions`.replace(
        /\/v1\/v1\//,
        "/v1/",
      );
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
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function parseJsonResponse(text, status) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned non-JSON (${status}): ${text.slice(0, 300)}`,
    );
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return null;

  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") return { done: true };

  const data = tryParseJson(payload);
  if (!data) {
    throw new Error(
      `Server returned malformed stream data: ${payload.slice(0, 300)}`,
    );
  }

  const usage = extractUsage(data);
  return {
    delta: data?.choices?.[0]?.delta?.content || "",
    reasoningDelta:
      data?.choices?.[0]?.delta?.reasoning_content ||
      data?.choices?.[0]?.delta?.reasoning ||
      "",
    cachedTokens: usage.cachedTokens,
    promptTokens: usage.promptTokens,
  };
}

function extractUsage(data) {
  return {
    cachedTokens:
      data?.timings?.cache_n ??
      data?.usage?.prompt_tokens_details?.cached_tokens ??
      null,
    promptTokens: data?.usage?.prompt_tokens ?? null,
  };
}

function postPort(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // The content script may have navigated away or closed the panel mid-stream.
  }
}

function startPortHeartbeat(port) {
  postPort(port, {
    type: "status",
    status: "Waiting for llama-server to load or respond…",
  });
  return setInterval(() => {
    postPort(port, {
      type: "status",
      status: "Still waiting for llama-server…",
    });
  }, STREAM_HEARTBEAT_MS);
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch/i.test(message)) {
    return "Cannot reach the configured endpoint. Check the URL, that llama-server.exe is listening on the network (for example --host 0.0.0.0), and that the firewall allows its port.";
  }
  return message;
}
