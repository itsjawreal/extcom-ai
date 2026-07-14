import {
  autoIncludeImages,
  clampReplyLength,
  MAX_REPLY_LENGTH,
  MIN_REPLY_LENGTH,
  normalizeBlockedTerms,
  TONE_LABELS,
} from "../shared/constants";
import type {
  ContentKind,
  ConnectionStatus,
  EngagementObjective,
  ExtensionSettings,
  GeneratePostRequest,
  GeneratePostResponse,
  GenerateReplyRequest,
  GenerateReplyResponse,
  HistoryEntry,
  ModelsResponse,
  ReadImagesMode,
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
  readImages: "auto",
  objectiveDefault: "none",
  favoriteTones: [],
  blockedTerms: [],
  aiModel: "",
};

// "auto" mode has its own, lower safety ceiling below, since the backend
// always caps auto-picked length at the classic 280 regardless of
// MAX_REPLY_LENGTH (the ceiling for a manually picked length).
const AUTO_REPLY_LENGTH_CEILING = 280;
const MIN_DRAFT_COUNT = 1;
const MAX_DRAFT_COUNT = 3;
const MAX_FAVORITE_TONES = 5;
const VALID_TONES = new Set(Object.keys(TONE_LABELS));

const HISTORY_CAP = 50;
const HISTORY_TEXT_TRUNCATE = 200;
const MAX_INSTRUCTION_LENGTH = 500;

const DEFAULT_USAGE_STATS: UsageStats = {
  totalGenerations: 0,
  totalInserted: 0,
  history: [],
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalEstimatedCostUsd: 0,
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

function normalizeFavoriteTones(value: unknown): Tone[] {
  if (!Array.isArray(value)) return [];
  const deduped = [...new Set(value.filter((item): item is Tone => typeof item === "string" && VALID_TONES.has(item)))];
  return deduped.slice(0, MAX_FAVORITE_TONES);
}

function normalizeReadImagesMode(value: unknown, fallback: ReadImagesMode): ReadImagesMode {
  if (value === true) return "on";
  if (value === false) return "off";
  return value === "auto" || value === "off" || value === "on" ? value : fallback;
}

const VALID_OBJECTIVES = new Set<EngagementObjective>(["viral", "replies", "debate", "value"]);

function normalizeObjectiveDefault(value: unknown): EngagementObjective | "none" {
  return typeof value === "string" && VALID_OBJECTIVES.has(value as EngagementObjective)
    ? (value as EngagementObjective)
    : "none";
}

// The panel always sends an explicit goal ("none" included) so a deliberate
// Default choice is never overridden by a saved non-"none" setting; only a
// missing value (stale content script) falls back to the saved default.
function resolveObjective(
  value: unknown,
  fallback: EngagementObjective | "none",
): EngagementObjective | undefined {
  if (typeof value === "string" && VALID_OBJECTIVES.has(value as EngagementObjective)) {
    return value as EngagementObjective;
  }
  if (value === undefined && fallback !== "none") return fallback;
  return undefined;
}

// "model" is deliberately excluded — it's a popup-level (Advanced tab)
// setting only, not something the on-page panel can override per-generation.
type GenerateInput = Omit<GenerateReplyRequest, "tone" | "count" | "maxLength" | "useEmoji" | "model" | "blockedTerms" | "objective"> & {
  tone?: Tone | "auto";
  count?: number;
  maxLength?: number | "auto";
  useEmoji?: boolean;
  // boolean keeps stale content scripts from the previous extension build
  // compatible until the X tab is refreshed.
  readImages?: ReadImagesMode | boolean;
  // "none" is a deliberate Default choice in the panel; absent falls back to
  // the saved objectiveDefault (see resolveObjective).
  objective?: EngagementObjective | "none";
};

// The same popup-level defaults used for replies also apply to standalone
// posts. The composer may override them for one generation, but never the
// model or local blocklist.
type GeneratePostInput = Omit<GeneratePostRequest, "tone" | "count" | "maxLength" | "useEmoji" | "model" | "blockedTerms" | "objective"> & {
  tone?: Tone | "auto";
  count?: number;
  maxLength?: number | "auto";
  useEmoji?: boolean;
  objective?: EngagementObjective | "none";
};

type RuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "CHECK_CONNECTION" }
  | { type: "GENERATE_REPLY"; input: GenerateInput }
  | { type: "GENERATE_POST"; input: GeneratePostInput }
  | { type: "GET_USAGE_STATS" }
  | { type: "CLEAR_USAGE_STATS" }
  | { type: "RECORD_INSERT"; historyId: string; kind: ContentKind }
  | { type: "GET_MODELS" }
  | { type: "TEST_MODEL"; model: string };

type RuntimeResponse =
  | {
      ok: true;
      settings?: ExtensionSettings;
      data?: GenerateReplyResponse | GeneratePostResponse;
      connection?: ConnectionStatus;
      usageStats?: UsageStats;
      historyId?: string;
      models?: ModelsResponse;
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
    // Migrate the old boolean setting in place: true = On, false = Off.
    readImages: normalizeReadImagesMode(stored.readImages, DEFAULT_SETTINGS.readImages),
    objectiveDefault: normalizeObjectiveDefault(stored.objectiveDefault),
    favoriteTones: normalizeFavoriteTones(stored.favoriteTones),
    blockedTerms: normalizeBlockedTerms(stored.blockedTerms),
    aiModel: String(stored.aiModel ?? DEFAULT_SETTINGS.aiModel),
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

async function getModels(settings: ExtensionSettings): Promise<ModelsResponse> {
  const { baseUrl, token } = requireBackend(settings);
  const response = await fetchBackend(`${baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({})) as
    Partial<ModelsResponse> & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message || `Backend request failed with HTTP ${response.status}.`);
  }
  if (!Array.isArray(body.models)) {
    throw new Error("Backend response is incomplete.");
  }
  return { models: body.models, allowCustom: Boolean(body.allowCustom) };
}

// Runs a real (small, rate-limit-consuming) generate call against the given
// model on the backend — catalog metadata alone isn't proof a model actually
// works (confirmed during development: a model can declare support for
// structured output and still fail live).
async function testModel(model: string, settings: ExtensionSettings): Promise<void> {
  const { baseUrl, token } = requireBackend(settings);
  const response = await fetchBackend(`${baseUrl}/v1/test-model`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ model }),
  });
  const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: { message?: string } };
  if (!response.ok || !body.ok) {
    throw new Error(body.error?.message || `Backend request failed with HTTP ${response.status}.`);
  }
}

async function saveSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...settings };
  next.readImages = normalizeReadImagesMode(next.readImages, DEFAULT_SETTINGS.readImages);
  next.objectiveDefault = normalizeObjectiveDefault(next.objectiveDefault);
  next.blockedTerms = normalizeBlockedTerms(next.blockedTerms);
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
    insertedIds: stats?.insertedIds && typeof stats.insertedIds === "object" ? stats.insertedIds : {},
    totalPromptTokens: Number.isFinite(stats?.totalPromptTokens) ? Number(stats?.totalPromptTokens) : 0,
    totalCompletionTokens: Number.isFinite(stats?.totalCompletionTokens) ? Number(stats?.totalCompletionTokens) : 0,
    totalEstimatedCostUsd: Number.isFinite(stats?.totalEstimatedCostUsd) ? Number(stats?.totalEstimatedCostUsd) : 0,
  };
}

async function saveUsageStats(stats: UsageStats): Promise<void> {
  await chrome.storage.local.set({ usageStats: stats });
}

async function recordGeneration(
  input: GenerateInput,
  data: GenerateReplyResponse,
): Promise<string> {
  const historyId = crypto.randomUUID();
  const entry: HistoryEntry = {
    id: historyId,
    createdAt: new Date().toISOString(),
    contentKind: "reply",
    sourceText: truncateForHistory(input.postText),
    postText: truncateForHistory(input.postText),
    postUrl: input.postUrl,
    // data.replies[0].tone is always the backend's *resolved* tone (never
    // "auto" — see GenerateReplyResponse), so it's always safe here. The
    // "smart" fallback only matters if replies were somehow empty, since
    // input.tone/settings.toneDefault could themselves literally be "auto".
    tone: data.replies[0]?.tone ?? "smart",
    objective: input.objective && input.objective !== "none" ? input.objective : undefined,
    drafts: data.replies.map((reply) => reply.text),
    inserted: false,
    model: data.model,
    promptTokens: data.tokenUsage?.promptTokens,
    completionTokens: data.tokenUsage?.completionTokens,
    estimatedCostUsd: data.tokenUsage?.estimatedCostUsd,
  };

  const stats = await getUsageStats();
  stats.totalGenerations += 1;
  stats.history = [entry, ...stats.history].slice(0, HISTORY_CAP);
  if (data.tokenUsage) {
    stats.totalPromptTokens = (stats.totalPromptTokens ?? 0) + data.tokenUsage.promptTokens;
    stats.totalCompletionTokens = (stats.totalCompletionTokens ?? 0) + data.tokenUsage.completionTokens;
    if (data.tokenUsage.estimatedCostUsd !== undefined) {
      stats.totalEstimatedCostUsd = (stats.totalEstimatedCostUsd ?? 0) + data.tokenUsage.estimatedCostUsd;
    }
  }
  await saveUsageStats(stats);
  return historyId;
}

async function recordPostGeneration(
  input: GeneratePostInput,
  data: GeneratePostResponse,
): Promise<string> {
  const historyId = crypto.randomUUID();
  const sourceText = truncateForHistory(input.brief.trim() || input.existingDraft?.trim() || "");
  const entry: HistoryEntry = {
    id: historyId,
    createdAt: new Date().toISOString(),
    contentKind: "post",
    sourceText,
    // Keep the legacy field populated until every history consumer has moved
    // to sourceText. This also makes rollback to an older popup harmless.
    postText: sourceText,
    tone: data.posts[0]?.tone ?? "smart",
    objective: input.objective && input.objective !== "none" ? input.objective : undefined,
    drafts: data.posts.map((post) => post.text),
    inserted: false,
    model: data.model,
    promptTokens: data.tokenUsage?.promptTokens,
    completionTokens: data.tokenUsage?.completionTokens,
    estimatedCostUsd: data.tokenUsage?.estimatedCostUsd,
  };

  const stats = await getUsageStats();
  stats.totalGenerations += 1;
  stats.history = [entry, ...stats.history].slice(0, HISTORY_CAP);
  if (data.tokenUsage) {
    stats.totalPromptTokens = (stats.totalPromptTokens ?? 0) + data.tokenUsage.promptTokens;
    stats.totalCompletionTokens = (stats.totalCompletionTokens ?? 0) + data.tokenUsage.completionTokens;
    if (data.tokenUsage.estimatedCostUsd !== undefined) {
      stats.totalEstimatedCostUsd = (stats.totalEstimatedCostUsd ?? 0) + data.tokenUsage.estimatedCostUsd;
    }
  }
  await saveUsageStats(stats);
  return historyId;
}

async function recordInsert(historyId: string, kind: ContentKind): Promise<void> {
  const stats = await getUsageStats();
  const entry = stats.history.find((item) => item.id === historyId);

  if (entry) {
    // Entry is still in history — mark it and increment counter if not
    // already marked.
    if (!entry.inserted) {
      entry.inserted = true;
      entry.insertKind = kind;
      entry.contentKind = kind;
      stats.totalInserted += 1;
    }
  } else {
    // Entry was evicted from history (cap reached). Still track it in
    // insertedIds so totalInserted stays accurate.
    if (!stats.insertedIds) stats.insertedIds = {};
    if (!stats.insertedIds[historyId]) {
      stats.insertedIds[historyId] = kind;
      stats.totalInserted += 1;
    }
  }

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
  // "auto" has no user-picked target — AUTO_REPLY_LENGTH_CEILING mirrors the
  // backend's own auto-mode cap, enforced client-side as a safety net in
  // case a provider ignores it and returns something absurd.
  const limit = maxLength === "auto" ? AUTO_REPLY_LENGTH_CEILING : maxLength;
  if (text.length <= limit) return text;

  const sentenceEnd = lastSentenceEnd(text.slice(0, limit));
  if (sentenceEnd !== null) return text.slice(0, sentenceEnd + 1).trimEnd();

  // Reserve 1 char for the ellipsis so the marked result still fits limit.
  const cut = text.slice(0, limit - 1);
  const lastBoundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  const trimmed = lastBoundary > limit * 0.5 ? cut.slice(0, lastBoundary) : cut;
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

  const imageMode = normalizeReadImagesMode(rawInput.readImages, settings.readImages);
  const postText = rawInput.postText?.trim() ?? "";
  const hasImages = Boolean(rawInput.imageUrls?.length);
  if (hasImages && !postText && imageMode === "off") {
    throw new Error("This post has no caption. Set Read images to Auto or On to generate a relevant reply.");
  }
  // Auto stays local and free — the shared heuristic in shared/constants.ts
  // is also what the AI Post panel uses for composer attachments.
  const readImages =
    imageMode === "on" || (imageMode === "auto" && autoIncludeImages(postText, hasImages));

  // The panel's max-length field is a free-typed number input (no native
  // min/max enforcement like a range slider), so a manually picked value
  // reaching here could be outside the backend's valid 50-25000 range —
  // clamp it here, the single choke point every generation request passes
  // through, rather than trusting the panel/popup UI to have already done
  // it. "auto" passes through untouched, it isn't a number to clamp.
  const requestedMaxLength = rawInput.maxLength ?? settings.maxReplyLength;
  const maxLength = requestedMaxLength === "auto" ? "auto" : clampReplyLength(requestedMaxLength);

  const input: GenerateReplyRequest = {
    ...rawInput,
    objective: resolveObjective(rawInput.objective, settings.objectiveDefault),
    tone: rawInput.tone ?? settings.toneDefault,
    extraInstruction: combinedInstruction || undefined,
    count: rawInput.count ?? settings.draftCount,
    maxLength,
    useEmoji: rawInput.useEmoji ?? settings.useEmoji,
    blockedTerms: settings.blockedTerms.length ? settings.blockedTerms : undefined,
    imageUrls: readImages ? rawInput.imageUrls : undefined,
    // Model choice lives only in the popup's Advanced tab, not per-generation
    // in the panel — see the GenerateInput type comment above.
    model: settings.aiModel || undefined,
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
    model?: GenerateReplyResponse["model"];
    tokenUsage?: GenerateReplyResponse["tokenUsage"];
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
    // Older backend deployments (pre-token/cost feature) won't send `model`
    // yet — fall back to whatever model the request asked for rather than
    // leaving the response type's required field empty.
    model: body.model ?? input.model ?? "unknown",
    tokenUsage: body.tokenUsage,
  };
}

async function generatePost(
  rawInput: GeneratePostInput,
  settings: ExtensionSettings,
): Promise<GeneratePostResponse> {
  const { baseUrl, token } = requireBackend(settings);
  const combinedInstruction = [settings.defaultInstruction.trim(), rawInput.extraInstruction?.trim()]
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_INSTRUCTION_LENGTH);
  const requestedMaxLength = rawInput.maxLength ?? settings.maxReplyLength;
  const maxLength = requestedMaxLength === "auto" ? "auto" : clampReplyLength(requestedMaxLength);

  const input: GeneratePostRequest = {
    ...rawInput,
    brief: rawInput.brief?.trim() ?? "",
    existingDraft: rawInput.existingDraft?.trim() || undefined,
    objective: resolveObjective(rawInput.objective, settings.objectiveDefault),
    tone: rawInput.tone ?? settings.toneDefault,
    extraInstruction: combinedInstruction || undefined,
    count: rawInput.count ?? settings.draftCount,
    maxLength,
    useEmoji: rawInput.useEmoji ?? settings.useEmoji,
    blockedTerms: settings.blockedTerms.length ? settings.blockedTerms : undefined,
    model: settings.aiModel || undefined,
  };

  const response = await fetchBackend(`${baseUrl}/v1/generate-post`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    posts?: GeneratePostResponse["posts"];
    usage?: GeneratePostResponse["usage"];
    model?: GeneratePostResponse["model"];
    tokenUsage?: GeneratePostResponse["tokenUsage"];
    attachedImageCount?: number;
  };

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("This backend does not support AI Post yet. Deploy the current backend build, then try again.");
    }
    throw new Error(body.error?.message || `Backend request failed with HTTP ${response.status}.`);
  }
  if (!Array.isArray(body.posts) || !body.usage) {
    throw new Error("Backend response is incomplete.");
  }
  // A pre-attachment backend ignores unknown request fields, so it would
  // silently generate text-only. Refuse instead of pretending the model saw
  // the images (plan section 18.6).
  if (input.attachedImages?.length && body.attachedImageCount === undefined) {
    throw new Error(
      "This backend build does not read attached images yet. Update the backend, or set Read attached images to Off.",
    );
  }

  return {
    posts: body.posts.map((post) => ({
      ...post,
      text: truncateReply(post.text, input.maxLength),
    })),
    usage: body.usage,
    model: body.model ?? input.model ?? "unknown",
    tokenUsage: body.tokenUsage,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  console.info("Extcom AI installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
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
        const historyId = await recordGeneration(message.input, data);
        sendResponse({ ok: true, data, historyId } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "GENERATE_POST") {
        const settings = await getSettings();
        const data = await generatePost(message.input, settings);
        const historyId = await recordPostGeneration(message.input, data);
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
      if (message?.type === "GET_MODELS") {
        sendResponse({ ok: true, models: await getModels(await getSettings()) } satisfies RuntimeResponse);
        return;
      }
      if (message?.type === "TEST_MODEL") {
        await testModel(message.model, await getSettings());
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
  })().catch((error) => {
    console.error("Unhandled error in message handler:", error);
    sendResponse({
      ok: false,
      error: "Message handler failed.",
    } satisfies RuntimeResponse);
  });

  return true;
});
