import type { ServerResponse } from "node:http";
import { generateReplies, ProviderError } from "../services/aiProvider.js";
import { assertModelAllowed, MODEL_ALLOWLIST_UNAVAILABLE_MESSAGE } from "../services/modelCatalog.js";
import { authenticateToken, parseAuthToken } from "../services/auth.js";
import { consumeRateLimit, refundRateLimit } from "../services/rateLimit.js";
import { readJsonBody, sendError, sendJson } from "../serverUtils.js";
import type { GenerateReplyRequest, Tone } from "../types/index.js";

type GenerateFn = (input: GenerateReplyRequest) => Promise<{ texts: string[]; tone: Tone }>;

// A minimal, fixed request — this only exists to prove a specific model ID
// actually completes a real generate call. Catalog metadata alone isn't
// enough: a model can declare structured_outputs support and still fail
// live (confirmed with anthropic/claude-haiku-4.5 during development).
function buildTestInput(model: string): GenerateReplyRequest {
  return {
    postText: "Just tried out a new coffee shop downtown, the espresso was incredible.",
    tone: "smart",
    count: 1,
    maxLength: 100,
    useEmoji: false,
    model,
  };
}

export async function testModelRoute(
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

  let model: string;
  try {
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200) {
      throw new Error("model must be a non-empty string of at most 200 characters.");
    }
    model = body.model.trim();
    await assertModelAllowed(model);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";
    if (message === MODEL_ALLOWLIST_UNAVAILABLE_MESSAGE) {
      sendError(response, 502, "PROVIDER_ERROR", message);
      return;
    }
    const code = message === "Invalid JSON body." ? "INVALID_JSON" : "VALIDATION_ERROR";
    sendError(response, 400, code, message);
    return;
  }

  // Consumes rate-limit quota like a real generation — a "test" button that
  // bypassed rate limiting would be a free way around it.
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
    await generate(buildTestInput(model));
    sendJson(response, 200, { ok: true });
  } catch (error) {
    refundRateLimit(user.token, reservedAt);
    if (error instanceof ProviderError) {
      const code = error.statusCode === 503 ? "PROVIDER_NOT_CONFIGURED" : "PROVIDER_ERROR";
      sendError(response, error.statusCode, code, error.message);
      return;
    }
    console.error("Unhandled test-model error", error);
    sendError(response, 500, "INTERNAL_ERROR", "Model test failed.");
  }
}
