import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { adminTokensRoute } from "./routes/adminTokens.js";
import { generateReplyRoute } from "./routes/generateReply.js";
import { healthRoute } from "./routes/health.js";
import { meRoute } from "./routes/me.js";
import { sendError } from "./serverUtils.js";

function isAllowedOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  // Browser extensions are the only intended clients. Their origins are
  // per-install, so they are allowed by scheme; real authorization is the
  // bearer token. EXTENSION_ORIGIN optionally allows one extra origin.
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    return true;
  }
  return Boolean(process.env.EXTENSION_ORIGIN && origin === process.env.EXTENSION_ORIGIN);
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  response.setHeader("Vary", "Origin");
  if (isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Max-Age", "600");
  }
}

export function createAppServer() {
  return createServer(async (request, response) => {
    setCorsHeaders(request, response);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      healthRoute(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/me") {
      meRoute(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/generate-reply") {
      await generateReplyRoute(request, response);
      return;
    }
    if (url.pathname === "/v1/admin/tokens") {
      await adminTokensRoute(request, response);
      return;
    }
    sendError(response, 404, "NOT_FOUND", "Route not found.");
  });
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT || 3000);
  createAppServer().listen(port, () => {
    console.info(`Extcom AI backend listening on http://localhost:${port}`);
  });
}
