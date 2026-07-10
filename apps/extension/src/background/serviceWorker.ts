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
  useEmoji: true,
  readImages: false,
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

function normalizeMaxLength(value: unknown, fallback: number | "auto"): number | "auto" {
  if (value === "auto") return "auto";
  return clampInt(value, fallback === "auto" ? MAX_REPLY_LENGTH : fallback, MIN_REPLY_LENGTH, MAX_REPLY_LENGTH);
}

type GenerateInput = Omit<GenerateReplyRequest, "tone" | "count" | "maxLength" | "useEmoji"> & {
  tone?: Tone | "auto";
  count?: number;
  maxLength?: number | "auto";
  useEmoji?: boolean;
  readImages?: boolean;
};

type RuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "CHECK_CONNECTION" }
  | { type: "GENERATE_REPLY"; input: GenerateInput }
  | { type: "GET_USAGE_STATS" }
  | { type: "CLEAR_USAGE_STATS" }
  | { type: "RECORD_INSERT"; historyId: string; kind: "reply" | "quote" };

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
    maxReplyLength: normalizeMaxLength(stored.maxReplyLength, DEFAULT_SETTINGS.maxReplyLength),
    draftCount: clampInt(stored.draftCount, DEFAULT_SETTINGS.draftCount, MIN_DRAFT_COUNT, MAX_DRAFT_COUNT),
    useEmoji: typeof stored.useEmoji === "boolean" ? stored.useEmoji : DEFAULT_SETTINGS.useEmoji,
    readImages: typeof stored.readImages === "boolean" ? stored.readImages : DEFAULT_SETTINGS.readImages,
  };
}

function requireBackend(settings: ExtensionSettings): { baseUrl: string; token: string } {
  const baseUrl = settings.backendBaseUrl.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Backend URL is not set. Open the Extcom AI icon in the toolbar to configure it.");
  const token = settings.authToken.trim();
  if (!token) throw new Error("Access token is not set. Open the Extcom AI icon in the toolbar to add it.");
  return { baseUrl, token };
}

// A bare `fetch()` failure (DNS error, connection refused, no host
// permission granted, mixed content, etc.) surfaces as a generic
// "TypeError: Failed to fetch" with zero context. Wrap it so the user sees
// which URL we tried and the likely causes, instead of that dead end.
async function fetchBackend(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(
      `Could not reach ${url}. Check that the Backend URL in Settings is correct, the server is running, and — if you just changed the Backend URL — that you accepted the "allow access" permission prompt after Save.`,
    );
  }
}

async function checkConnection(settings: ExtensionSettings): Promise<ConnectionStatus> {
  const { baseUrl, token } = requireBackend(settings);
  const response = await fetchBackend(`${baseUrl}/v1/me`, {
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
    // data.replies[0].tone is always the backend's *resolved* tone (never
    // "auto" — see GenerateReplyResponse), so it's always safe here. The
    // "smart" fallback only matters if replies were somehow empty, since
    // input.tone/settings.toneDefault could themselves literally be "auto".
    tone: data.replies[0]?.tone ?? "smart",
    drafts: data.replies.map((reply) => reply.text),
    inserted: false,
  };

  const stats = await getUsageStats();
  stats.totalGenerations += 1;
  stats.history = [entry, ...stats.history].slice(0, HISTORY_CAP);
  await saveUsageStats(stats);
  return historyId;
}

async function recordInsert(historyId: string, kind: "reply" | "quote"): Promise<void> {
  const stats = await getUsageStats();
  const entry = stats.history.find((item) => item.id === historyId);
  // Entry may already be gone (cap eviction) or already marked — either way,
  // this is a fire-and-forget signal from the panel, not something worth
  // surfacing an error for.
  if (!entry || entry.inserted) return;
  entry.inserted = true;
  entry.insertKind = kind;
  stats.totalInserted += 1;
  await saveUsageStats(stats);
}

// The backend prompts the AI to respect maxLength, but providers don't always
// comply exactly (especially the OpenAI path, which has no schema-level
// enforcement) — this is a safety net, not the primary length control.
// Slicing an overlong reply at the nearest word boundary produces a dangling
// half-thought ("...faces its own unique challenges and"), which reads as
// broken rather than trimmed. Prefer ending on a complete sentence if one
// fits; otherwise fall back to a word boundary and mark it with an ellipsis
// so it's visibly a cut, not a finished reply.
function lastSentenceEnd(window: string): number | null {
  let lastEnd = -1;
  for (const match of window.matchAll(/[.!?](?=\s|$)/g)) {
    lastEnd = match.index ?? lastEnd;
  }
  return lastEnd >= 0 ? lastEnd : null;
}

function truncateReply(text: string, maxLength: number | "auto"): string {
  // "auto" has no user-picked target — MAX_REPLY_LENGTH is still enforced as
  // an absolute safety ceiling in case a provider returns something absurd.
  const limit = maxLength === "auto" ? MAX_REPLY_LENGTH : maxLength;
  if (text.length <= limit) return text;

  const sentenceEnd = lastSentenceEnd(text.slice(0, limit));
  if (sentenceEnd !== null) return text.slice(0, sentenceEnd + 1).trimEnd();

  // Reserve 1 char for the ellipsis so the marked result still fits limit.
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
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

  // readImages gates whether the already-extracted imageUrl (if any) is ever
  // sent to the backend at all — off by default, since sending an image adds
  // real token cost/latency the user should opt into, not discover later.
  const readImages = rawInput.readImages ?? settings.readImages;

  const input: GenerateReplyRequest = {
    ...rawInput,
    tone: rawInput.tone ?? settings.toneDefault,
    extraInstruction: combinedInstruction || undefined,
    count: rawInput.count ?? settings.draftCount,
    maxLength: rawInput.maxLength ?? settings.maxReplyLength,
    useEmoji: rawInput.useEmoji ?? settings.useEmoji,
    imageUrl: readImages ? rawInput.imageUrl : undefined,
  };

  const response = await fetchBackend(`${baseUrl}/v1/generate-reply`, {
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
        await recordInsert(message.historyId, message.kind);
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
