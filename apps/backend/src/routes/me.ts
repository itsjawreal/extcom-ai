import type { IncomingMessage, ServerResponse } from "node:http";
import { authenticateToken, parseAuthToken } from "../services/auth.js";
import { peekRateLimit } from "../services/rateLimit.js";
import { sendError, sendJson } from "../serverUtils.js";

// Lets the extension popup verify a token and show remaining quota without
// consuming a generation.
export function meRoute(request: IncomingMessage, response: ServerResponse): void {
  const authHeader = request.headers.authorization;
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

  const usage = peekRateLimit(user.token, user.plan);
  sendJson(response, 200, {
    plan: user.plan,
    remainingToday: usage.remainingToday,
  });
}
