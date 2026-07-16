import { modelSupportsParameter } from "./modelCatalog.js";
import { getPersonaVoice } from "./persona.js";
import { buildGenerationPrompt, systemPromptForRequest } from "./promptBuilder.js";
import { sanitizeReply } from "./safety.js";
import {
  TONES,
  isGeneratePostRequest,
  type GenerationRequest,
  type Tone,
} from "../types/index.js";

type TokenUsage = { promptTokens: number; completionTokens: number };

type ParsedReplies = { texts: string[]; tone: Tone };
type GenerateResult = ParsedReplies & { model: string; usage: TokenUsage | null };

type ResponsesApiContent = { type?: string; text?: string; refusal?: string };
type ResponsesApiOutput = { type?: string; content?: ResponsesApiContent[] };
type ResponsesApiResult = {
  output?: ResponsesApiOutput[];
  status?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { code?: string; message?: string };
};

type OpenRouterResult = {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: {
    code?: number;
    message?: string;
    metadata?: { error_type?: string };
  };
};

type ProviderErrorOptions = {
  retryable?: boolean;
  retryAfterMs?: number;
  usage?: TokenUsage | null;
};

// A provider or a test mock may not send usage at all — never crash on it,
// just report "no token data" downstream instead of a wrong count.
function extractTokenUsage(promptTokens: unknown, completionTokens: unknown): TokenUsage | null {
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null;
  return { promptTokens: Number(promptTokens), completionTokens: Number(completionTokens) };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
    readonly options: ProviderErrorOptions = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.options.retryable === true;
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }

  get usage(): TokenUsage | null {
    return this.options.usage ?? null;
  }
}

const MAX_GENERATION_ATTEMPTS = 2;
const BASE_RETRY_DELAY_MS = 400;
const MAX_RETRY_DELAY_MS = 5_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_OPENROUTER_ERROR_TYPES = new Set([
  "rate_limit_exceeded",
  "provider_overloaded",
  "provider_unavailable",
  "server",
  "timeout",
  "unmapped",
]);
const RETRYABLE_OPENAI_ERROR_CODES = new Set(["rate_limit_exceeded", "server_error"]);

function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, date - now);
}

function providerHttpError(
  provider: string,
  response: Response,
  message: string,
  usage: TokenUsage | null = null,
): ProviderError {
  return new ProviderError(message || `${provider} failed with HTTP ${response.status}.`, 502, {
    retryable: RETRYABLE_HTTP_STATUSES.has(response.status),
    retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
    usage,
  });
}

async function fetchProvider(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const timedOut = error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ProviderError(
      timedOut ? "AI provider request timed out." : "Could not reach AI provider.",
      502,
      { retryable: true },
    );
  }
}

function withUsage(error: ProviderError, usage: TokenUsage | null): ProviderError {
  return new ProviderError(error.message, error.statusCode, {
    ...error.options,
    usage: combineUsage(error.usage, usage),
  });
}

function retryDelayMs(error: ProviderError | null, completedAttempts: number): number {
  if (error?.retryAfterMs !== undefined) return error.retryAfterMs;
  const exponential = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, completedAttempts - 1);
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(MAX_RETRY_DELAY_MS, exponential + jitter);
}

function canRetry(error: ProviderError, completedAttempts: number): boolean {
  if (!error.retryable || completedAttempts >= MAX_GENERATION_ATTEMPTS) return false;
  return error.retryAfterMs === undefined || error.retryAfterMs <= MAX_RETRY_DELAY_MS;
}

async function waitBeforeRetry(
  error: ProviderError | null,
  completedAttempts: number,
): Promise<void> {
  const delay = retryDelayMs(error, completedAttempts);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

function normalizeForBlockedTerm(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsBlockedTerm(text: string, term: string): boolean {
  const normalizedText = normalizeForBlockedTerm(text);
  const normalizedTerm = normalizeForBlockedTerm(term.trim());
  if (!normalizedTerm) return false;

  // A single word should not ban an unrelated larger word (e.g. "sol"
  // must not reject "solution"). Phrases and punctuation-heavy rules use
  // exact substring matching so user-entered wording stays predictable.
  if (/^[\p{L}\p{N}_]+$/u.test(normalizedTerm)) {
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])${escapeRegExp(normalizedTerm)}(?=$|[^\\p{L}\\p{N}_])`,
      "u",
    ).test(normalizedText);
  }
  return normalizedText.includes(normalizedTerm);
}

function findBlockedTerm(texts: string[], blockedTerms: string[] | undefined): string | undefined {
  return blockedTerms?.find((term) => texts.some((text) => containsBlockedTerm(text, term)));
}

function combineUsage(first: TokenUsage | null, next: TokenUsage | null): TokenUsage | null {
  if (!first) return next;
  if (!next) return first;
  return {
    promptTokens: first.promptTokens + next.promptTokens,
    completionTokens: first.completionTokens + next.completionTokens,
  };
}

// max_tokens/max_output_tokens has to scale with the requested reply length
// or long-form (X Premium) requests get cut off mid-reply — or mid-JSON,
// which breaks parsing entirely. 2.2 chars/token is a conservative floor
// (real English averages ~4) that leaves headroom for JSON structure
// overhead and less token-dense text. Capped well below what most providers
// support so a single request can't run away in cost; how far a very long
// maxLength × count combination actually gets still depends on the
// configured AI_DEFAULT_MODEL's own output-token limit.
const MAX_TOKENS_CEILING = 20_000;
const MIN_TOKENS_FLOOR = 800;

// OpenRouter's strict JSON schema maxLength is a real generation-time
// constraint for providers that grammar-constrain output to the schema —
// hitting it stops the string exactly there, mid-word, with no ellipsis.
// Requesting the schema's maxLength a bit above the real target gives the
// model room to finish its current sentence; sanitizeReply() still trims
// the result down to the true target afterward, using sentence/word-
// boundary-aware truncation instead of a raw schema cutoff.
const SCHEMA_LENGTH_BUFFER = 150;

function computeMaxTokens(input: GenerationRequest): number {
  const perReplyChars = input.maxLength === "auto" ? 280 : input.maxLength;
  const estimated = Math.ceil((perReplyChars * input.count) / 2.2) + 300;
  return Math.min(MAX_TOKENS_CEILING, Math.max(MIN_TOKENS_FLOOR, estimated));
}

function buildReplySchema(input: GenerationRequest, enforceProviderLimits: boolean) {
  const schemaTextMaxLength =
    (input.maxLength === "auto" ? 280 : input.maxLength) + SCHEMA_LENGTH_BUFFER;
  return {
    type: "object",
    properties: {
      ...(input.tone === "auto" ? { tone: { type: "string", enum: TONES } } : {}),
      replies: {
        type: "array",
        ...(enforceProviderLimits ? { minItems: input.count, maxItems: input.count } : {}),
        items: {
          type: "object",
          properties: {
            text: {
              type: "string",
              ...(enforceProviderLimits ? { maxLength: schemaTextMaxLength } : {}),
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },
    required: input.tone === "auto" ? ["tone", "replies"] : ["replies"],
    additionalProperties: false,
  };
}

function extractOutputText(result: ResponsesApiResult): string {
  for (const item of result.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.type === "refusal") {
        throw new ProviderError(content.refusal || "AI provider refused the request.");
      }
    }
  }
  throw new ProviderError("AI provider returned no text output.", 502, { retryable: true });
}

// Matches promptBuilder.ts's own auto-mode ceiling and the extension's
// AUTO_REPLY_LENGTH_CEILING — "auto" has no user-picked numeric target, so
// this is the safety-net limit applied when sanitizing the response.
const AUTO_MAX_LENGTH_CEILING = 280;

function parseReplies(
  raw: string,
  expectedCount: number,
  requestedTone: GenerationRequest["tone"],
  maxLength: GenerationRequest["maxLength"],
): ParsedReplies {
  const lengthLimit = maxLength === "auto" ? AUTO_MAX_LENGTH_CEILING : maxLength;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError("AI provider returned invalid JSON.", 502, { retryable: true });
  }

  if (!parsed || typeof parsed !== "object" || !("replies" in parsed)) {
    throw new ProviderError("AI provider response is missing replies.", 502, { retryable: true });
  }

  const replies = (parsed as { replies?: unknown }).replies;
  if (!Array.isArray(replies)) {
    throw new ProviderError("AI provider replies must be an array.", 502, { retryable: true });
  }

  const texts = replies
    .map((reply) =>
      reply && typeof reply === "object" && "text" in reply
        ? sanitizeReply(String((reply as { text: unknown }).text), lengthLimit)
        : "",
    )
    .filter(Boolean)
    .slice(0, expectedCount);

  if (texts.length !== expectedCount || new Set(texts).size !== texts.length) {
    throw new ProviderError("AI provider returned incomplete or duplicate replies.", 502, {
      retryable: true,
    });
  }

  // Manual tone: trust the request, no need for the model to echo it back.
  // Auto: the model was asked to pick and report one — fall back to a safe
  // default if it omitted the field or hallucinated something off-list.
  let tone: Tone;
  if (requestedTone === "auto") {
    const rawTone = (parsed as { tone?: unknown }).tone;
    tone = typeof rawTone === "string" && TONES.includes(rawTone as Tone) ? (rawTone as Tone) : "smart";
  } else {
    tone = requestedTone;
  }

  return { texts, tone };
}

export async function generateWithOpenAI(
  input: GenerationRequest,
): Promise<GenerateResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("OPENAI_API_KEY is not configured.", 503);
  }

  const model = input.model || process.env.AI_DEFAULT_MODEL || "gpt-5.4-nano";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const personaVoice = await getPersonaVoice();
  // Reply requests carry X-hosted HTTPS imageUrls; post requests carry
  // validated composer-attachment data URLs (services/attachedImages.ts)
  // plus, for quote composers, the quoted tweet's own https CDN URLs (plan
  // §20). Both providers accept every form in the same content block.
  // Each list is capped at 4 individually, but the union must respect the
  // same 4-image ceiling (plan §20.6 decision): the user's own attachments
  // are what gets published, so they win and quoted media is trimmed.
  const imageUrls = isGeneratePostRequest(input)
    ? [
        ...(input.attachedImages?.map((image) => image.dataUrl) ?? []),
        ...(input.quotedPost?.imageUrls ?? []),
      ].slice(0, 4)
    : input.imageUrls;
  // Low detail keeps image cost/latency small (~85 flat tokens per image vs.
  // several hundred at high detail) — enough for a reply to reference what
  // an image shows without needing pixel-level precision. Cost scales
  // linearly with image count (up to 4, X's own per-post max). Requires a
  // vision-capable AI_DEFAULT_MODEL; if the configured model can't see
  // images, providers typically just ignore the block rather than erroring.
  const requestInput = imageUrls?.length
    ? [
        {
          role: "user" as const,
          content: [
            { type: "input_text" as const, text: buildGenerationPrompt(input, personaVoice) },
            ...imageUrls.map((url) => ({
              type: "input_image" as const,
              image_url: url,
              detail: "low" as const,
            })),
          ],
        },
      ]
    : buildGenerationPrompt(input, personaVoice);

  const response = await fetchProvider(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: systemPromptForRequest(input),
      input: requestInput,
      max_output_tokens: computeMaxTokens(input),
      reasoning: { effort: "none" },
      text: {
        format: {
          type: "json_schema",
          name: "reply_options",
          strict: true,
          // The direct OpenAI schema deliberately uses the portable strict
          // subset. Exact count and text length remain enforced by
          // parseReplies()/sanitizeReply() after generation.
          schema: buildReplySchema(input, false),
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const result = (await response.json().catch(() => ({}))) as ResponsesApiResult;
  const usage = extractTokenUsage(result.usage?.input_tokens, result.usage?.output_tokens);
  if (!response.ok) {
    throw providerHttpError(
      "AI provider",
      response,
      result.error?.message || `AI provider failed with HTTP ${response.status}.`,
      usage,
    );
  }

  if (result.status === "failed") {
    throw new ProviderError(result.error?.message || "AI provider generation failed.", 502, {
      retryable:
        typeof result.error?.code === "string" &&
        RETRYABLE_OPENAI_ERROR_CODES.has(result.error.code),
      usage,
    });
  }
  if (result.status === "incomplete") {
    throw new ProviderError("AI provider returned incomplete output.", 502, {
      retryable: true,
      usage,
    });
  }

  try {
    const parsed = parseReplies(extractOutputText(result), input.count, input.tone, input.maxLength);
    return { ...parsed, model, usage };
  } catch (error) {
    if (error instanceof ProviderError) throw withUsage(error, usage);
    throw error;
  }
}

export async function generateWithOpenRouter(
  input: GenerationRequest,
): Promise<GenerateResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new ProviderError("OPENROUTER_API_KEY is not configured.", 503);
  }

  const baseUrl = (
    process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
  ).replace(/\/$/, "");
  let useResponseHealing = false;
  try {
    useResponseHealing = new URL(baseUrl).hostname === "openrouter.ai";
  } catch {
    // A malformed/custom base URL will fail normally at fetch time. Do not
    // add an OpenRouter-only plugin parameter to unknown compatible APIs.
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "Extcom AI",
  };
  if (process.env.APP_URL) headers["HTTP-Referer"] = process.env.APP_URL;

  const personaVoice = await getPersonaVoice();
  // See generateWithOpenAI: post requests contribute validated composer
  // attachments as data URLs plus the quoted tweet's https media (plan §20),
  // reply requests keep X-hosted HTTPS URLs. The union is capped at the
  // same 4-image ceiling, own attachments first, quoted media trimmed.
  const imageUrls = isGeneratePostRequest(input)
    ? [
        ...(input.attachedImages?.map((image) => image.dataUrl) ?? []),
        ...(input.quotedPost?.imageUrls ?? []),
      ].slice(0, 4)
    : input.imageUrls;
  const model = input.model || process.env.AI_DEFAULT_MODEL || "openrouter/auto";
  // Without this, a reasoning-capable model (e.g. google/gemini-2.5-pro) can
  // spend most of max_tokens on invisible internal reasoning before ever
  // writing the actual JSON reply, leaving too little budget to finish it —
  // confirmed live: this produced "AI provider returned invalid JSON" for
  // gemini-2.5-pro specifically, while non-reasoning and lighter
  // (flash-tier) models were unaffected. This task is a direct
  // reply-generation job, not multi-step reasoning, so there's nothing to
  // gain from letting a model "think" here. Only sent when the model
  // actually declares support for it — provider.require_parameters: true
  // below means sending an unsupported parameter makes the whole request
  // unroutable, not just ignored, so this has to be conditional.
  const supportsReasoningControl = await modelSupportsParameter(model, "reasoning");
  // Low detail keeps image cost/latency small (~85 flat tokens per image vs.
  // several hundred at high detail) — enough for a reply to reference what
  // an image shows without needing pixel-level precision. Cost scales
  // linearly with image count (up to 4, X's own per-post max). Requires a
  // vision-capable AI_DEFAULT_MODEL; if the configured model can't see
  // images, providers typically just ignore the block rather than erroring.
  const userContent = imageUrls?.length
    ? [
        { type: "text" as const, text: buildGenerationPrompt(input, personaVoice) },
        ...imageUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url, detail: "low" as const },
        })),
      ]
    : buildGenerationPrompt(input, personaVoice);

  const response = await fetchProvider(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPromptForRequest(input) },
        { role: "user", content: userContent },
      ],
      max_tokens: computeMaxTokens(input),
      temperature: 0.8,
      ...(supportsReasoningControl ? { reasoning: { effort: "none" } } : {}),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "reply_options",
          strict: true,
          // OpenRouter supports the count and padded-length constraints used
          // here. sanitizeReply() still enforces the real requested limit.
          schema: buildReplySchema(input, true),
        },
      },
      ...(useResponseHealing ? { plugins: [{ id: "response-healing" }] } : {}),
      provider: { require_parameters: true },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const result = (await response.json().catch(() => ({}))) as OpenRouterResult;
  const usage = extractTokenUsage(result.usage?.prompt_tokens, result.usage?.completion_tokens);
  if (!response.ok) {
    throw providerHttpError(
      "OpenRouter",
      response,
      result.error?.message || `OpenRouter failed with HTTP ${response.status}.`,
      usage,
    );
  }

  if (result.error) {
    const errorType = result.error.metadata?.error_type;
    throw new ProviderError(result.error.message || "OpenRouter generation failed.", 502, {
      retryable:
        (typeof result.error.code === "number" && RETRYABLE_HTTP_STATUSES.has(result.error.code)) ||
        (typeof errorType === "string" && RETRYABLE_OPENROUTER_ERROR_TYPES.has(errorType)),
      retryAfterMs: parseRetryAfterMs(response.headers.get("Retry-After")),
      usage,
    });
  }

  const finishReason = result.choices?.[0]?.finish_reason;
  if (finishReason === "content_filter") {
    throw new ProviderError("AI provider blocked the output under its content policy.", 502, {
      usage,
    });
  }
  if (finishReason === "length" || finishReason === "error") {
    throw new ProviderError(
      finishReason === "length"
        ? "AI provider stopped before finishing the output."
        : "AI provider stopped with a generation error.",
      502,
      { retryable: true, usage },
    );
  }

  const content = result.choices?.[0]?.message?.content;
  if (!content) {
    throw new ProviderError("OpenRouter returned no text output.", 502, {
      retryable: true,
      usage,
    });
  }
  try {
    const parsed = parseReplies(content, input.count, input.tone, input.maxLength);
    return { ...parsed, model, usage };
  } catch (error) {
    if (error instanceof ProviderError) throw withUsage(error, usage);
    throw error;
  }
}

async function generateOnce(input: GenerationRequest): Promise<GenerateResult> {
  const provider = process.env.AI_DEFAULT_PROVIDER || "openrouter";
  if (provider === "openrouter") return generateWithOpenRouter(input);
  if (provider === "openai") return generateWithOpenAI(input);
  throw new ProviderError(`Unsupported AI provider: ${provider}.`, 503);
}

export async function generateReplies(input: GenerationRequest): Promise<GenerateResult> {
  let accumulatedUsage: TokenUsage | null = null;
  let violation: string | undefined;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    let result: GenerateResult;
    try {
      result = await generateOnce(input);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      accumulatedUsage = combineUsage(accumulatedUsage, error.usage);
      if (canRetry(error, attempt)) {
        await waitBeforeRetry(error, attempt);
        continue;
      }

      const baseMessage = error.message.replace(/[.\s]+$/, "");
      const message = error.retryable && attempt > 1
        ? `${baseMessage} after ${attempt} attempts.`
        : error.retryable && error.retryAfterMs !== undefined && error.retryAfterMs > MAX_RETRY_DELAY_MS
          ? `${baseMessage}. Retry after about ${Math.ceil(error.retryAfterMs / 1_000)} seconds.`
          : error.message;
      throw new ProviderError(message, error.statusCode, {
        ...error.options,
        usage: accumulatedUsage,
      });
    }

    accumulatedUsage = combineUsage(accumulatedUsage, result.usage);
    violation = findBlockedTerm(result.texts, input.blockedTerms);
    if (!violation) return { ...result, usage: accumulatedUsage };
    if (attempt < MAX_GENERATION_ATTEMPTS) await waitBeforeRetry(null, attempt);
  }

  throw new ProviderError(
    `AI provider repeatedly included a Never mention rule: ${JSON.stringify(violation)}.`,
    502,
    { usage: accumulatedUsage },
  );
}

export const providerInternals = {
  extractOutputText,
  parseReplies,
  computeMaxTokens,
  containsBlockedTerm,
  findBlockedTerm,
  combineUsage,
  parseRetryAfterMs,
  canRetry,
};
