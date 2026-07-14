import type { ServerResponse } from "node:http";
import type { ApiErrorCode } from "./types/index.js";

// Default ceiling for every JSON route. Routes that legitimately need a
// larger body (generate-post with composer attachments) must opt in with an
// explicit maxBytes; never raise this global default.
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024;

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function sendError(
  response: ServerResponse,
  status: number,
  code: ApiErrorCode,
  message: string,
): void {
  sendJson(response, status, { error: { code, message } });
}

export async function readJsonBody(
  request: NodeJS.ReadableStream,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid JSON body.");
  }
}
