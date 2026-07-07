import type { ServerResponse } from "node:http";
import { authenticateToken, parseAuthToken } from "../services/auth.js";
import { generateReplies, ProviderError } from "../services/aiProvider.js";
import { consumeRateLimit } from "../services/rateLimit.js";
import { assertSafeRequest } from "../services/safety.js";
import { readJsonBody, sendError, sendJson } from "../serverUtils.js";
import {
  TONES,
  type GenerateReplyRequest,
  type GenerateReplyResponse,
} from "../types/index.js";

type GenerateFn = (input: GenerateReplyRequest) => Promise<string[]>;

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value.trim() || undefined;
}

export function validateGenerateRequest(value: unknown): GenerateReplyRequest {
  if (!value || typeof value !== "object") throw new Error("Request body must be an object.");
  const body = value as Record<string, unknown>;
  const postText = optionalString(body.postText, 10_000);
  if (!postText) throw new Error("postText is required and must be at most 10,000 characters.");
  if (typeof body.tone !== "string" || !TONES.includes(body.tone as never)) {
    throw new Error(`tone must be one of: ${TONES.join(", ")}.`);
  }

  const count = body.count === undefined ? 3 : body.count;
  if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 3) {
    throw new Error("count must be an integer between 1 and 3.");
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

  return {
    postText,
    tone: body.tone as GenerateReplyRequest["tone"],
    count: Number(count),
    authorHandle: optionalString(body.authorHandle, 100),
    authorName: optionalString(body.authorName, 200),
    postUrl: optionalString(body.postUrl, 2_000),
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

  const usage = consumeRateLimit(user.token, user.plan);
  if (!usage.allowed) {
    if (usage.retryAfterSeconds) {
      response.setHeader("Retry-After", String(usage.retryAfterSeconds));
    }
    sendError(response, 429, "RATE_LIMITED", "Daily generation limit reached.");
    return;
  }

  try {
    const texts = await generate(input);
    const payload: GenerateReplyResponse = {
      replies: texts.map((text, index) => ({
        id: `reply_${index + 1}`,
        text,
        tone: input.tone,
      })),
      usage: { remainingToday: usage.remainingToday, plan: user.plan },
    };
    sendJson(response, 200, payload);
  } catch (error) {
    if (error instanceof ProviderError) {
      const code = error.statusCode === 503 ? "PROVIDER_NOT_CONFIGURED" : "PROVIDER_ERROR";
      sendError(response, error.statusCode, code, error.message);
      return;
    }
    console.error("Unhandled generate error", error);
    sendError(response, 500, "INTERNAL_ERROR", "Reply generation failed.");
  }
}
