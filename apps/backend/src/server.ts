import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateReplyRoute } from "./routes/generateReply.js";
import { healthRoute } from "./routes/health.js";
import { sendError } from "./serverUtils.js";

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const allowedOrigin = process.env.EXTENSION_ORIGIN;
  const origin = request.headers.origin;
  if (allowedOrigin && origin === allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
    if (request.method === "POST" && url.pathname === "/v1/generate-reply") {
      await generateReplyRoute(request, response);
      return;
    }
    sendError(response, 404, "NOT_FOUND", "Route not found.");
  });
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT || 3000);
  createAppServer().listen(port, () => {
    console.info(`Ekskomen backend listening on http://localhost:${port}`);
  });
}
