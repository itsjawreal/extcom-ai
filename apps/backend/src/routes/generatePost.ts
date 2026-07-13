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

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
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
    const term = optionalString(item, 80);
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
  const brief = optionalString(body.brief, 5_000);
  const existingDraft = optionalString(body.existingDraft, 25_000);

  if (body.mode !== "fresh" && body.mode !== "rewrite" && body.mode !== "continue") {
    throw new Error('mode must be "fresh", "rewrite", or "continue".');
  }
  if (!brief && !existingDraft) {
    throw new Error("Either brief or existingDraft must be provided.");
  }
  if ((body.mode === "rewrite" || body.mode === "continue") && !existingDraft) {
    throw new Error(`${body.mode} mode requires existingDraft.`);
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
    (!Number.isInteger(maxLength) || Number(maxLength) < 50 || Number(maxLength) > 25_000)
  ) {
    throw new Error('maxLength must be "auto" or an integer between 50 and 25000.');
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
    extraInstruction: optionalString(body.extraInstruction, 500),
    blockedTerms: parseBlockedTerms(body.blockedTerms),
    model: optionalString(body.model, 200),
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
    input = validateGeneratePostRequest(await readJsonBody(request));
    assertSafeRequest(input.extraInstruction);
    await assertModelAllowed(input.model);
  } catch (error) {
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
