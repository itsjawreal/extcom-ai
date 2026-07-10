import type { ServerResponse } from "node:http";
import { authenticateToken, parseAuthToken } from "../services/auth.js";
import { generateReplies, ProviderError } from "../services/aiProvider.js";
import { consumeRateLimit, refundRateLimit } from "../services/rateLimit.js";
import { assertSafeRequest } from "../services/safety.js";
import { readJsonBody, sendError, sendJson } from "../serverUtils.js";
import {
  TONES,
  type GenerateReplyRequest,
  type GenerateReplyResponse,
  type Tone,
} from "../types/index.js";

type GenerateFn = (input: GenerateReplyRequest) => Promise<{ texts: string[]; tone: Tone }>;

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value.trim() || undefined;
}

function optionalHttpUrl(value: unknown, maxLength: number): string | undefined {
  const candidate = optionalString(value, maxLength);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function validateGenerateRequest(value: unknown): GenerateReplyRequest {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object.");
  const body = value as Record<string, unknown>;
  const postText = optionalString(body.postText, 10_000);
  if (!postText) throw new Error("postText is required and must be at most 10,000 characters.");
  if (
    typeof body.tone !== "string" ||
    (body.tone !== "auto" && !TONES.includes(body.tone as never))
  ) {
    throw new Error(`tone must be "auto" or one of: ${TONES.join(", ")}.`);
  }

  const count = body.count === undefined ? 3 : body.count;
  if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 3) {
    throw new Error("count must be an integer between 1 and 3.");
  }

  const maxLength = body.maxLength === undefined ? 220 : body.maxLength;
  if (
    maxLength !== "auto" &&
    (!Number.isInteger(maxLength) || Number(maxLength) < 50 || Number(maxLength) > 280)
  ) {
    throw new Error('maxLength must be "auto" or an integer between 50 and 280.');
  }

  const useEmoji = body.useEmoji === undefined ? true : body.useEmoji;
  if (typeof useEmoji !== "boolean") {
    throw new Error("useEmoji must be a boolean.");
  }

  let visibleThreadText: string[] | undefined;
  if (body.visibleThreadText !== undefined) {
    if (!Array.isArray(body.visibleThreadText) || body.visibleThreadText.length > 5) {
      throw new Error("visibleThreadText must contain at most 5 items.");
    }
    visibleThreadText = body.visibleThreadText.map((item) => {
      const text = optionalString(item, 2_000);
      if (!text) throw new Error("Each visibleThreadText item must be a non-empty string.");
      return text;
    });
  }

  let imageUrls: string[] | undefined;
  if (body.imageUrls !== undefined) {
    if (!Array.isArray(body.imageUrls) || body.imageUrls.length > 4) {
      throw new Error("imageUrls must contain at most 4 items.");
    }
    imageUrls = body.imageUrls.map((item) => {
      const url = optionalHttpUrl(item, 2_000);
      if (!url) throw new Error("Each imageUrls item must be a valid http(s) URL.");
      return url;
    });
    if (imageUrls.length === 0) imageUrls = undefined;
  }

  return {
    postText,
    tone: body.tone as GenerateReplyRequest["tone"],
    count: Number(count),
    maxLength: maxLength === "auto" ? "auto" : Number(maxLength),
    useEmoji,
    authorHandle: optionalString(body.authorHandle, 100),
    authorName: optionalString(body.authorName, 200),
    postUrl: optionalString(body.postUrl, 2_000),
    imageUrls,
    visibleThreadText,
    extraInstruction: optionalString(body.extraInstruction, 500),
  };
}

export async function generateReplyRoute(
  request: NodeJS.ReadableStream & { headers?: Record<string, string | string[] | undefined> },
  response: ServerResponse,
  generate: GenerateFn = generateReplies,
): Promise<void> {
  const authHeader = request.headers?.authorization;
  const authToken = parseAuthToken(
    Array.isArray(authHeader) ? authHeader[0] : authHeader,
  );
  if (!authToken) {
    sendError(response, 401, "AUTH_REQUIRED", "Bearer token is required.");
    return;
  }

  const user = authenticateToken(authToken);
  if (!user) {
    sendError(response, 403, "INVALID_TOKEN", "Bearer token is invalid.");
    return;
  }

  let input: GenerateReplyRequest;
  try {
    input = validateGenerateRequest(await readJsonBody(request));
    assertSafeRequest(input.extraInstruction);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";
    const code = message === "Invalid JSON body." ? "INVALID_JSON" :
      message === "Request body is too large." ? "VALIDATION_ERROR" :
      message === "Requested instruction is not allowed." ? "UNSAFE_REQUEST" :
      "VALIDATION_ERROR";
    sendError(response, code === "UNSAFE_REQUEST" ? 422 : 400, code, message);
    return;
  }

  const reservedAt = new Date();
  const usage = consumeRateLimit(user.token, user.plan, reservedAt);
  if (!usage.allowed) {
    if (usage.retryAfterSeconds) {
      response.setHeader("Retry-After", String(usage.retryAfterSeconds));
    }
    const message = usage.limitedBy === "minute"
      ? "Per-minute generation limit reached."
      : "Daily generation limit reached.";
    sendError(response, 429, "RATE_LIMITED", message);
    return;
  }

  try {
    const { texts, tone } = await generate(input);
    const payload: GenerateReplyResponse = {
      replies: texts.map((text, index) => ({
        id: `reply_${index + 1}`,
        text,
        tone,
      })),
      usage: { remainingToday: usage.remainingToday, plan: user.plan },
    };
    sendJson(response, 200, payload);
  } catch (error) {
    refundRateLimit(user.token, reservedAt);
    if (error instanceof ProviderError) {
      const code = error.statusCode === 503 ? "PROVIDER_NOT_CONFIGURED" : "PROVIDER_ERROR";
      sendError(response, error.statusCode, code, error.message);
      return;
    }
    console.error("Unhandled generate error", error);
    sendError(response, 500, "INTERNAL_ERROR", "Reply generation failed.");
  }
}
