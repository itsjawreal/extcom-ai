import type { IncomingMessage, ServerResponse } from "node:http";
import { authenticateToken, parseAuthToken } from "../services/auth.js";
import { getModelOptions, isCustomModelAllowed } from "../services/modelCatalog.js";
import { sendError, sendJson } from "../serverUtils.js";

// Lets the popup populate its model dropdown without hardcoding a model
// list client-side — model IDs on OpenRouter change too often for that.
export async function modelsRoute(request: IncomingMessage, response: ServerResponse): Promise<void> {
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

  try {
    const models = await getModelOptions();
    sendJson(response, 200, { models, allowCustom: isCustomModelAllowed() });
  } catch (error) {
    console.error("Could not fetch OpenRouter model catalog", error);
    sendError(response, 502, "PROVIDER_ERROR", "Could not fetch the model catalog from OpenRouter.");
  }
}
