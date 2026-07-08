import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createUser, listUsers } from "../services/store.js";
import { readJsonBody, sendError, sendJson } from "../serverUtils.js";
import type { UserPlan } from "../services/auth.js";

const PLANS: UserPlan[] = ["free", "pro", "power"];

function isAdminAuthorized(request: IncomingMessage): boolean {
  const secret = process.env.ADMIN_SECRET;
  const header = request.headers["x-admin-secret"];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!secret || !provided) return false;

  const expected = createHash("sha256").update(secret).digest();
  const received = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expected, received);
}

export async function adminTokensRoute(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (!process.env.ADMIN_SECRET) {
    sendError(response, 503, "ADMIN_DISABLED", "ADMIN_SECRET is not configured.");
    return;
  }
  if (!isAdminAuthorized(request)) {
    sendError(response, 403, "INVALID_TOKEN", "Admin secret is invalid.");
    return;
  }

  if (request.method === "GET") {
    sendJson(response, 200, { users: listUsers() });
    return;
  }

  if (request.method === "POST") {
    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonBody(request);
      body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch (error) {
      sendError(
        response,
        400,
        "INVALID_JSON",
        error instanceof Error ? error.message : "Invalid JSON body.",
      );
      return;
    }

    const plan = body.plan;
    if (typeof plan !== "string" || !PLANS.includes(plan as UserPlan)) {
      sendError(response, 400, "VALIDATION_ERROR", `plan must be one of: ${PLANS.join(", ")}.`);
      return;
    }

    const label = body.label;
    if (label !== undefined && (typeof label !== "string" || label.length > 200)) {
      sendError(response, 400, "VALIDATION_ERROR", "label must be a string of at most 200 characters.");
      return;
    }

    const user = createUser(plan as UserPlan, label as string | undefined);
    sendJson(response, 201, { user });
    return;
  }

  sendError(response, 404, "NOT_FOUND", "Route not found.");
}
