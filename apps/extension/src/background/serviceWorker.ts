import type {
  ConnectionStatus,
  ExtensionSettings,
  GenerateReplyRequest,
  GenerateReplyResponse,
  HistoryEntry,
  Tone,
  UsageStats,
} from "../shared/types";

const DEFAULT_SETTINGS: ExtensionSettings = {
  backendBaseUrl: "http://localhost:3000",
  authToken: "dev-local-token",
  toneDefault: "degen",
  defaultInstruction: "",
  maxReplyLength: 220,
  draftCount: 3,
};

const MIN_REPLY_LENGTH = 50;
const MAX_REPLY_LENGTH = 280;
const MIN_DRAFT_COUNT = 1;
const MAX_DRAFT_COUNT = 3;

const HISTORY_CAP = 50;
const HISTORY_TEXT_TRUNCATE = 200;
const MAX_INSTRUCTION_LENGTH = 500;

const DEFAULT_USAGE_STATS: UsageStats = {
  totalGenerations: 0,
  totalInserted: 0,
  history: [],
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

type GenerateInput = Omit<GenerateReplyRequest, "tone" | "count" | "maxLength"> & {
  tone?: Tone;
  count?: number;
  maxLength?: number;
};

type RuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "CHECK_CONNECTION" }
  | { type: "GENERATE_REPLY"; input: GenerateInput }
  | { type: "GET_USAGE_STATS" }
  | { type: "CLEAR_USAGE_STATS" }
  | { type: "RECORD_INSERT"; historyId: string };

type RuntimeResponse =
  | {
      ok: true;
      settings?: ExtensionSettings;
      data?: GenerateReplyResponse;
      connection?: ConnectionStatus;
      usageStats?: UsageStats;
      historyId?: string;
    }
  | { ok: false; error: string };

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    backendBaseUrl: String(stored.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl),
    authToken: String(stored.authToken || DEFAULT_SETTINGS.authToken),
    toneDefault: stored.toneDefault || DEFAULT_SETTINGS.toneDefault,
    defaultInstruction: String(stored.defaultInstruction ?? ""),
    maxReplyLength: clampInt(
      stored.maxReplyLength,
      DEFAULT_SETTINGS.maxReplyLength,
      MIN_REPLY_LENGTH,
      MAX_REPLY_LENGTH,
    ),
    draftCount: clampInt(stored.draftCount, DEFAULT_SETTINGS.draftCount, MIN_DRAFT_COUNT, MAX_DRAFT_COUNT),
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

function truncateForHistory(text: string): string {
  return text.length > HISTORY_TEXT_TRUNCATE ? `${text.slice(0, HISTORY_TEXT_TRUNCATE)}…` : text;
}

// Stored under its own "usageStats" key so it never collides with the
// settings object shape read/written by getSettings()/saveSettings() above.
async function getUsageStats(): Promise<UsageStats> {
  const stored = await chrome.storage.local.get({ usageStats: DEFAULT_USAGE_STATS });
  const stats = stored.usageStats as Partial<UsageStats> | undefined;
  return {
    totalGenerations: Number.isFinite(stats?.totalGenerations) ? Number(stats?.totalGenerations) : 0,
    totalInserted: Number.isFinite(stats?.totalInserted) ? Number(stats?.totalInserted) : 0,
    history: Array.isArray(stats?.history) ? (stats?.history as HistoryEntry[]) : [],
  };
}

async function saveUsageStats(stats: UsageStats): Promise<void> {
  await chrome.storage.local.set({ usageStats: stats });
}

async function recordGeneration(
  input: GenerateInput,
  data: GenerateReplyResponse,
  settings: ExtensionSettings,
): Promise<string> {
  const historyId = crypto.randomUUID();
  const entry: HistoryEntry = {
    id: historyId,
    createdAt: new Date().toISOString(),
    postText: truncateForHistory(input.postText),
    postUrl: input.postUrl,
    tone: data.replies[0]?.tone ?? input.tone ?? settings.toneDefault,
    drafts: data.replies.map((reply) => reply.text),
    inserted: false,
  };

  const stats = await getUsageStats();
  stats.totalGenerations += 1;
  stats.history = [entry, ...stats.history].slice(0, HISTORY_CAP);
  await saveUsageStats(stats);
  return historyId;
}

async function recordInsert(historyId: string): Promise<void> {
  const stats = await getUsageStats();
  const entry = stats.history.find((item) => item.id === historyId);
  // Entry may already be gone (cap eviction) or already marked — either way,
  // this is a fire-and-forget signal from the panel, not something worth
  // surfacing an error for.
  if (!entry || entry.inserted) return;
  entry.inserted = true;
  stats.totalInserted += 1;
  await saveUsageStats(stats);
}

// The backend prompts the AI to respect maxLength, but providers don't always
// comply exactly (especially the OpenAI path, which has no schema-level
// enforcement). Truncate here so drafts shown in the panel never exceed what
// the user configured.
function truncateReply(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  // Prefer breaking on a word boundary so a mid-word cut doesn't look broken,
  // but only if that doesn't throw away a large chunk of the allowed length.
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return trimmed.trimEnd();
}

async function generateReply(
  rawInput: GenerateInput,
  settings: ExtensionSettings,
): Promise<GenerateReplyResponse> {
  const { baseUrl, token } = requireBackend(settings);

  // Tone, draft count, and max length are popup-level settings the panel can
  // override per-generation. The panel's one-off instruction (if any) is
  // appended to the standing instruction rather than replacing it, so a
  // saved standing instruction still always applies. Clamped to the
  // backend's 500-char limit — otherwise a too-long combined string gets
  // silently dropped there (including the standing instruction) with no
  // error surfaced anywhere.
  const combinedInstruction = [settings.defaultInstruction.trim(), rawInput.extraInstruction?.trim()]
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_INSTRUCTION_LENGTH);

  const input: GenerateReplyRequest = {
    ...rawInput,
    tone: rawInput.tone ?? settings.toneDefault,
    extraInstruction: combinedInstruction || undefined,
    count: rawInput.count ?? settings.draftCount,
    maxLength: rawInput.maxLength ?? settings.maxReplyLength,
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
    replies: body.replies.map((reply) => ({
      ...reply,
      text: truncateReply(reply.text, input.maxLength),
    })),
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
        const settings = await getSettings();
        const data = await generateReply(message.input, settings);
        const historyId = await recordGeneration(message.input, data, settings);
        sendResponse({ ok: true, data, historyId } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "GET_USAGE_STATS") {
        sendResponse({ ok: true, usageStats: await getUsageStats() } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "CLEAR_USAGE_STATS") {
        await saveUsageStats(DEFAULT_USAGE_STATS);
        sendResponse({ ok: true, usageStats: DEFAULT_USAGE_STATS } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "RECORD_INSERT") {
        await recordInsert(message.historyId);
        sendResponse({ ok: true } satisfies RuntimeResponse);
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
