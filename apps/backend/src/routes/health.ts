import type { ServerResponse } from "node:http";
import { sendJson } from "../serverUtils.js";

export function healthRoute(response: ServerResponse): void {
  sendJson(response, 200, { ok: true });
}
