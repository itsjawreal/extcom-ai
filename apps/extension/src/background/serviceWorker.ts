import type {
  ExtensionSettings,
  GenerateReplyRequest,
  GenerateReplyResponse,
} from "../shared/types";

const DEFAULT_SETTINGS: ExtensionSettings = {
  backendBaseUrl: "http://localhost:3000",
  authToken: "dev-local-token",
  toneDefault: "degen",
};

type RuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "GENERATE_REPLY"; input: GenerateReplyRequest; settings: ExtensionSettings };

type RuntimeResponse =
  | { ok: true; settings?: ExtensionSettings; data?: GenerateReplyResponse }
  | { ok: false; error: string };

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    backendBaseUrl: String(stored.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl),
    authToken: String(stored.authToken || DEFAULT_SETTINGS.authToken),
    toneDefault: stored.toneDefault || DEFAULT_SETTINGS.toneDefault,
  };
}

async function saveSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...settings };
  await chrome.storage.local.set(next);
  return next;
}

async function generateReply(
  input: GenerateReplyRequest,
  settings: ExtensionSettings,
): Promise<GenerateReplyResponse> {
  const baseUrl = settings.backendBaseUrl.trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("Backend URL is required.");
  if (!settings.authToken.trim()) throw new Error("Auth token is required.");

  const response = await fetch(`${baseUrl}/v1/generate-reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.authToken.trim()}`,
    },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    replies?: GenerateReplyResponse["replies"];
    usage?: GenerateReplyResponse["usage"];
  };

  if (!response.ok) {
    throw new Error(body.error?.message || `Backend request failed with HTTP ${response.status}.`);
  }

  if (!Array.isArray(body.replies) || !body.usage) {
    throw new Error("Backend response is incomplete.");
  }

  return {
    replies: body.replies,
    usage: body.usage,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  console.info("Ekskomen AI Reply installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      if (message?.type === "PING") {
        sendResponse({ ok: true } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "GET_SETTINGS") {
        sendResponse({ ok: true, settings: await getSettings() } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "SAVE_SETTINGS") {
        sendResponse({
          ok: true,
          settings: await saveSettings(message.settings),
        } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "GENERATE_REPLY") {
        sendResponse({
          ok: true,
          data: await generateReply(message.input, message.settings),
        } satisfies RuntimeResponse);
        return;
      }

      sendResponse({ ok: false, error: "Unsupported message." } satisfies RuntimeResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown extension error.",
      } satisfies RuntimeResponse);
    }
  })();

  return true;
});
