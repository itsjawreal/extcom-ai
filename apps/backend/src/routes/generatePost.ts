import type { ServerResponse } from "node:http";
import { authenticateToken, parseAuthToken } from "../services/auth.js";
import { generateReplies, ProviderError } from "../services/aiProvider.js";
import {
  assertModelAllowed,
  getModelPricing,
  MODEL_ALLOWLIST_UNAVAILABLE_MESSAGE,
} from "../services/modelCatalog.js";
import { consumeRateLimit, refundRateLimit } from "../services/rateLimit.js";
import { assertSafeRequest } from "../services/safety.js";
import { ImageValidationError, parseAttachedImages } from "../services/attachedImages.js";
import { readJsonBody, sendError, sendJson } from "../serverUtils.js";
import {
  TONES,
  type GeneratePostRequest,
  type GeneratePostResponse,
  type Tone,
} from "../types/index.js";

type GenerateFn = (input: GeneratePostRequest) => Promise<{
  texts: string[];
  tone: Tone;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number } | null;
}>;

const PRICING_LOOKUP_TIMEOUT_MS = 3_000;
// 4 MiB of validated image bytes inflates to ~5.6 MiB of base64 plus JSON
// framing. Only this route gets the larger ceiling; everything else keeps
// DEFAULT_MAX_BODY_BYTES (see serverUtils.ts).
const GENERATE_POST_MAX_BODY_BYTES = 8 * 1024 * 1024;
const AUTO_POST_LENGTH_CEILING = 280;
const MIN_CONTINUE_ADDITION_LENGTH = 50;
const MAX_POST_LENGTH = 25_000;

function optionalString(value: unknown, maxLength: number, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  if (value.length > maxLength) throw new Error(`${field} must contain at most ${maxLength} characters.`);
  return value.trim() || undefined;
}

function parseBlockedTerms(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error("blockedTerms must contain at most 50 items.");
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const item of value) {
    let term: string | undefined;
    try {
      term = optionalString(item, 80, "blockedTerms item");
    } catch {
      throw new Error("Each blockedTerms item must be a non-empty string of at most 80 characters.");
    }
    if (!term) throw new Error("Each blockedTerms item must be a non-empty string of at most 80 characters.");
    const key = term.normalize("NFKC").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.length ? terms : undefined;
}

export function validateGeneratePostRequest(value: unknown): GeneratePostRequest {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object.");
  const body = value as Record<string, unknown>;
  const brief = optionalString(body.brief, 5_000, "brief");
  const existingDraft = optionalString(body.existingDraft, 25_000, "existingDraft");
  const attachedImages = parseAttachedImages(body.attachedImages);

  if (body.mode !== "fresh" && body.mode !== "rewrite" && body.mode !== "continue") {
    throw new Error('mode must be "fresh", "rewrite", or "continue".');
  }
  if ((body.mode === "rewrite" || body.mode === "continue") && !existingDraft) {
    throw new Error(`${body.mode} mode requires existingDraft.`);
  }
  // Image-only fresh is a supported flow (caption an attached image); the
  // text-editing modes always need composer text to edit.
  if (!brief && !existingDraft && !(body.mode === "fresh" && attachedImages)) {
    throw new Error("Either brief or existingDraft must be provided.");
  }
  if (
    typeof body.tone !== "string" ||
    (body.tone !== "auto" && !TONES.includes(body.tone as never))
  ) {
    throw new Error(`tone must be "auto" or one of: ${TONES.join(", ")}.`);
  }

  const language = body.language === undefined ? "brief" : body.language;
  if (language !== "brief" && language !== "en") {
    throw new Error('language must be "brief" or "en".');
  }
  const count = body.count === undefined ? 3 : body.count;
  if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 3) {
    throw new Error("count must be an integer between 1 and 3.");
  }
  const maxLength = body.maxLength === undefined ? 220 : body.maxLength;
  if (
    maxLength !== "auto" &&
    (!Number.isInteger(maxLength) || Number(maxLength) < 50 || Number(maxLength) > MAX_POST_LENGTH)
  ) {
    throw new Error('maxLength must be "auto" or an integer between 50 and 25000.');
  }
  if (body.mode === "continue" && existingDraft) {
    const requiredLength = existingDraft.length + MIN_CONTINUE_ADDITION_LENGTH;
    if (requiredLength > MAX_POST_LENGTH) {
      throw new Error(
        `continue mode cannot extend this ${existingDraft.length}-character draft within the 25000-character maximum.`,
      );
    }
    const effectiveLimit = maxLength === "auto" ? AUTO_POST_LENGTH_CEILING : Number(maxLength);
    if (effectiveLimit < requiredLength) {
      const alternative = requiredLength <= AUTO_POST_LENGTH_CEILING
        ? ` Set maxLength to at least ${requiredLength}, or use "auto".`
        : ` Set maxLength to at least ${requiredLength}.`;
      throw new Error(
        `continue mode needs room after the existing ${existingDraft.length}-character draft.${alternative}`,
      );
    }
  }
  const useEmoji = body.useEmoji === undefined ? true : body.useEmoji;
  if (typeof useEmoji !== "boolean") throw new Error("useEmoji must be a boolean.");

  return {
    brief: brief ?? "",
    existingDraft,
    mode: body.mode,
    language,
    tone: body.tone as GeneratePostRequest["tone"],
    count: Number(count),
    maxLength: maxLength === "auto" ? "auto" : Number(maxLength),
    useEmoji,
    extraInstruction: optionalString(body.extraInstruction, 500, "extraInstruction"),
    blockedTerms: parseBlockedTerms(body.blockedTerms),
    model: optionalString(body.model, 200, "model"),
    attachedImages,
  };
}

async function resolveTokenUsage(
  model: string,
  usage: { promptTokens: number; completionTokens: number } | null | undefined,
): Promise<GeneratePostResponse["tokenUsage"]> {
  if (!usage) return undefined;
  const pricing = await Promise.race([
    getModelPricing(model),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PRICING_LOOKUP_TIMEOUT_MS)),
  ]);
  const estimatedCostUsd = pricing
    ? usage.promptTokens * pricing.prompt + usage.completionTokens * pricing.completion
    : undefined;
  return { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, estimatedCostUsd };
}

export async function generatePostRoute(
  request: NodeJS.ReadableStream & { headers?: Record<string, string | string[] | undefined> },
  response: ServerResponse,
  generate: GenerateFn = generateReplies,
): Promise<void> {
  const authHeader = request.headers?.authorization;
  const authToken = parseAuthToken(Array.isArray(authHeader) ? authHeader[0] : authHeader);
  if (!authToken) {
    sendError(response, 401, "AUTH_REQUIRED", "Bearer token is required.");
    return;
  }
  const user = authenticateToken(authToken);
  if (!user) {
    sendError(response, 403, "INVALID_TOKEN", "Bearer token is invalid.");
    return;
  }

  let input: GeneratePostRequest;
  try {
    input = validateGeneratePostRequest(await readJsonBody(request, GENERATE_POST_MAX_BODY_BYTES));
    assertSafeRequest(input.extraInstruction);
    await assertModelAllowed(input.model);
  } catch (error) {
    if (error instanceof ImageValidationError) {
      sendError(response, error.status, error.code, error.message);
      return;
    }
    const message = error instanceof Error ? error.message : "Invalid request.";
    if (message === MODEL_ALLOWLIST_UNAVAILABLE_MESSAGE) {
      sendError(response, 502, "PROVIDER_ERROR", message);
      return;
    }
    const code = message === "Invalid JSON body." ? "INVALID_JSON" :
      message === "Requested instruction is not allowed." ? "UNSAFE_REQUEST" : "VALIDATION_ERROR";
    sendError(response, code === "UNSAFE_REQUEST" ? 422 : 400, code, message);
    return;
  }

  const reservedAt = new Date();
  const quota = consumeRateLimit(user.token, user.plan, reservedAt);
  if (!quota.allowed) {
    if (quota.retryAfterSeconds) response.setHeader("Retry-After", String(quota.retryAfterSeconds));
    sendError(
      response,
      429,
      "RATE_LIMITED",
      quota.limitedBy === "minute" ? "Per-minute generation limit reached." : "Daily generation limit reached.",
    );
    return;
  }

  try {
    const result = await generate(input);
    const model = result.model ?? input.model ?? process.env.AI_DEFAULT_MODEL ?? "unknown";
    const payload: GeneratePostResponse = {
      posts: result.texts.map((text, index) => ({ id: `post_${index + 1}`, text, tone: result.tone })),
      usage: { remainingToday: quota.remainingToday, plan: user.plan },
      model,
      tokenUsage: await resolveTokenUsage(model, result.usage),
      attachedImageCount: input.attachedImages?.length,
    };
    sendJson(response, 200, payload);
  } catch (error) {
    refundRateLimit(user.token, reservedAt);
    if (error instanceof ProviderError) {
      sendError(
        response,
        error.statusCode,
        error.statusCode === 503 ? "PROVIDER_NOT_CONFIGURED" : "PROVIDER_ERROR",
        error.message,
      );
      return;
    }
    console.error("Unhandled generate post error", error);
    sendError(response, 500, "INTERNAL_ERROR", "Post generation failed.");
  }
}
