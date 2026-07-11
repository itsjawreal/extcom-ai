// Model IDs change fast on OpenRouter (verified while building this: names
// already shifted mid-session). This starter list is a snapshot as of
// 2026-07-12, cross-checked against the live catalog on every read — an ID
// that's gone stale (renamed/removed) is silently skipped, never shown as a
// broken dropdown entry. Operators can override this entirely via
// AI_ALLOWED_MODELS.
//
// Anthropic models are deliberately excluded here — both
// anthropic/claude-haiku-4.5 and anthropic/claude-sonnet-4.6 failed live
// with an identical generic "Provider returned error" despite their
// catalog entries declaring structured_outputs support, consistently
// across two different tiers (not a one-off flake). The exact cause was
// never confirmed (see docs/API.md), but two-for-two failures across the
// Anthropic family is enough evidence to not feature them by default.
// Still reachable via the popup's custom model field for anyone who wants
// to try anyway, or via AI_ALLOWED_MODELS if a future model/fix changes this.
const STARTER_MODEL_IDS = [
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-4o-mini",
  "openai/gpt-4.1-mini",
  "moonshotai/kimi-k2.6",
  "deepseek/deepseek-v4-flash",
  "qwen/qwen3.6-flash",
];

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — single-instance backend, in-memory is enough.

type OpenRouterCatalogModel = {
  id: string;
  name?: string;
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string };
};

type OpenRouterModelsResponse = { data?: OpenRouterCatalogModel[] };

export type ModelOption = {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
};

let cache: { fetchedAt: number; models: OpenRouterCatalogModel[] } | null = null;

async function fetchLiveCatalog(): Promise<OpenRouterCatalogModel[]> {
  const response = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`OpenRouter models catalog request failed with HTTP ${response.status}.`);
  }
  const body = (await response.json()) as OpenRouterModelsResponse;
  if (!Array.isArray(body.data)) {
    throw new Error("OpenRouter models catalog response is missing data.");
  }
  return body.data;
}

// Serves a cached catalog within the TTL. On a cache miss, tries a live
// fetch; if that fails and a stale cache exists, serves the stale cache
// rather than failing outright (OpenRouter being briefly unreachable
// shouldn't break the model dropdown for models that were already known).
async function getLiveCatalog(): Promise<OpenRouterCatalogModel[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.models;

  try {
    const models = await fetchLiveCatalog();
    cache = { fetchedAt: now, models };
    return models;
  } catch (error) {
    if (cache) return cache.models;
    throw error;
  }
}

function configuredModelIds(): string[] {
  const configured = (process.env.AI_ALLOWED_MODELS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return configured.length ? configured : STARTER_MODEL_IDS;
}

// The dropdown list: configured/starter IDs that (a) still exist in the live
// catalog and (b) declare structured_outputs support, since that's what
// this backend's strict JSON parsing relies on. Metadata alone doesn't
// guarantee an actual generate call will succeed (a real model can still
// fail live even when its catalog entry says "supported") — that's what the
// separate /v1/test-model check is for.
export async function getModelOptions(): Promise<ModelOption[]> {
  const catalog = await getLiveCatalog();
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const options: ModelOption[] = [];
  for (const id of configuredModelIds()) {
    const model = byId.get(id);
    if (!model?.supported_parameters?.includes("structured_outputs")) continue;
    options.push({ id: model.id, name: model.name, pricing: model.pricing });
  }
  return options;
}

// Used to decide whether it's safe to include an optional request
// parameter (e.g. "reasoning") for a given model. This matters because this
// backend sets provider.require_parameters: true on OpenRouter requests —
// that makes OpenRouter exclude any provider that doesn't support every
// parameter actually present in the request, so blindly sending a
// parameter a model doesn't support wouldn't just get ignored, it would
// make the whole request unroutable. Returns false (don't send it) on any
// lookup failure — a skipped optional parameter is a much smaller problem
// than a request that can't be routed at all.
export async function modelSupportsParameter(model: string, parameter: string): Promise<boolean> {
  try {
    const catalog = await getLiveCatalog();
    const entry = catalog.find((candidate) => candidate.id === model);
    return entry?.supported_parameters?.includes(parameter) ?? false;
  } catch {
    return false;
  }
}

// Looks up pricing for any live catalog model (not just the starter/allowed
// list — a custom model the caller typed in can still get a cost estimate).
// Returns null on any missing/non-numeric pricing data or catalog fetch
// failure, never throws — a missing cost estimate is a much smaller problem
// than breaking the response that carries it.
export async function getModelPricing(
  modelId: string,
): Promise<{ prompt: number; completion: number } | null> {
  try {
    const catalog = await getLiveCatalog();
    const entry = catalog.find((candidate) => candidate.id === modelId);
    // Number("") is 0, not NaN — trim first so a blank pricing string reads
    // as "missing" rather than silently pricing the model as free.
    const promptRaw = entry?.pricing?.prompt?.trim();
    const completionRaw = entry?.pricing?.completion?.trim();
    if (!promptRaw || !completionRaw) return null;
    const prompt = Number(promptRaw);
    const completion = Number(completionRaw);
    if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
    return { prompt, completion };
  } catch {
    return null;
  }
}

export function isCustomModelAllowed(): boolean {
  const value = process.env.AI_ALLOW_CUSTOM_MODEL;
  return value !== "false" && value !== "0";
}

// Distinct, catchable message so callers can tell "we couldn't verify the
// allowlist" (an upstream/network problem) apart from "we verified it and
// this model genuinely isn't on it" (a real validation failure) — these
// deserve different HTTP status codes, not both collapsed into a generic
// 400.
export const MODEL_ALLOWLIST_UNAVAILABLE_MESSAGE = "Could not verify the model allowlist right now.";

// Throws when a caller-supplied model isn't permitted. A missing model is
// always fine — it just means "use AI_DEFAULT_MODEL", not a custom pick.
export async function assertModelAllowed(model: string | undefined): Promise<void> {
  if (!model) return;
  if (isCustomModelAllowed()) return;
  let options: ModelOption[];
  try {
    options = await getModelOptions();
  } catch {
    throw new Error(MODEL_ALLOWLIST_UNAVAILABLE_MESSAGE);
  }
  if (!options.some((option) => option.id === model)) {
    throw new Error("This model is not in the backend's allowed list.");
  }
}

export const modelCatalogInternals = { STARTER_MODEL_IDS, CACHE_TTL_MS };

// Test-only: clears the in-memory cache so tests don't leak state into each other.
export function resetModelCatalogCache(): void {
  cache = null;
}

// Test-only: backdates the cache's timestamp past the TTL without clearing
// it, so a test can exercise the "live fetch failed, serve stale cache"
// branch deterministically instead of needing to fake real time.
export function expireModelCatalogCacheForTest(): void {
  if (cache) cache.fetchedAt = 0;
}
