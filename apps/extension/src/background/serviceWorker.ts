import type {
  ConnectionStatus,
  ExtensionSettings,
  GenerateReplyRequest,
  GenerateReplyResponse,
  Tone,
} from "../shared/types";

const DEFAULT_SETTINGS: ExtensionSettings = {
  backendBaseUrl: "http://localhost:3000",
  authToken: "dev-local-token",
  toneDefault: "degen",
  defaultInstruction: "",
};

type GenerateInput = Omit<GenerateReplyRequest, "tone"> & { tone?: Tone };

type RuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "CHECK_CONNECTION" }
  | { type: "GENERATE_REPLY"; input: GenerateInput };

type RuntimeResponse =
  | {
      ok: true;
      settings?: ExtensionSettings;
      data?: GenerateReplyResponse;
      connection?: ConnectionStatus;
    }
  | { ok: false; error: string };

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    backendBaseUrl: String(stored.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl),
    authToken: String(stored.authToken || DEFAULT_SETTINGS.authToken),
    toneDefault: stored.toneDefault || DEFAULT_SETTINGS.toneDefault,
    defaultInstruction: String(stored.defaultInstruction ?? ""),
  };
}

function requireBackend(settings: ExtensionSettings): { baseUrl: string; token: string } {
  const baseUrl = settings.backendBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Backend URL is not set. Open the Extcom AI icon in the toolbar to configure it.");
  const token = settings.authToken.trim();
  if (!token) throw new Error("Access token is not set. Open the Extcom AI icon in the toolbar to add it.");
  return { baseUrl, token };
}

async function checkConnection(settings: ExtensionSettings): Promise<ConnectionStatus> {
  const { baseUrl, token } = requireBackend(settings);
  const response = await fetch(`${baseUrl}/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({})) as
    Partial<ConnectionStatus> & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message || `Backend request failed with HTTP ${response.status}.`);
  }
  if (!body.plan || typeof body.remainingToday !== "number") {
    throw new Error("Backend response is incomplete.");
  }
  return { plan: body.plan, remainingToday: body.remainingToday };
}

async function saveSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...settings };
  await chrome.storage.local.set(next);
  return next;
}

async function generateReply(
  rawInput: GenerateInput,
  settings: ExtensionSettings,
): Promise<GenerateReplyResponse> {
  const { baseUrl, token } = requireBackend(settings);

  // Tone and standing instruction are popup-level settings; the on-post panel
  // only triggers generation.
  const input: GenerateReplyRequest = {
    ...rawInput,
    tone: rawInput.tone ?? settings.toneDefault,
    extraInstruction: rawInput.extraInstruction ?? (settings.defaultInstruction.trim() || undefined),
  };

  const response = await fetch(`${baseUrl}/v1/generate-reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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
  console.info("Extcom AI Reply installed");
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
      if (message?.type === "CHECK_CONNECTION") {
        sendResponse({
          ok: true,
          connection: await checkConnection(await getSettings()),
        } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "GENERATE_REPLY") {
        // Settings are always read from the service worker's own storage so a
        // compromised page cannot redirect the token to an arbitrary backend.
        sendResponse({
          ok: true,
          data: await generateReply(message.input, await getSettings()),
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
