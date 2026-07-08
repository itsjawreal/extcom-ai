import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { adminTokensRoute } from "./adminTokens.js";
import { generateReplyRoute } from "./generateReply.js";
import { meRoute } from "./me.js";
import { authInternals } from "../services/auth.js";
import { peekRateLimit, rateLimitInternals, resetRateLimits } from "../services/rateLimit.js";

type CapturedResponse = {
  statusCode: number;
  headers: Map<string, string>;
  body: string;
  response: ServerResponse;
};

function captureResponse(): CapturedResponse {
  const captured: CapturedResponse = {
    statusCode: 200,
    headers: new Map(),
    body: "",
    response: undefined as unknown as ServerResponse,
  };
  captured.response = {
    get statusCode() {
      return captured.statusCode;
    },
    set statusCode(value: number) {
      captured.statusCode = value;
    },
    setHeader(name: string, value: number | string | readonly string[]) {
      captured.headers.set(name.toLowerCase(), String(value));
      return this;
    },
    end(chunk?: unknown) {
      captured.body = chunk === undefined ? "" : String(chunk);
      return this;
    },
  } as ServerResponse;
  return captured;
}

function request(
  body = "",
  headers: Record<string, string> = {},
  method = "POST",
): IncomingMessage {
  const stream = Readable.from(body ? [body] : []) as IncomingMessage;
  Object.assign(stream, { headers, method });
  return stream;
}

function jsonBody(captured: CapturedResponse): unknown {
  return JSON.parse(captured.body);
}

test("GET /v1/me validates auth and does not consume quota", () => {
  resetRateLimits();

  const missing = captureResponse();
  meRoute(request("", {}, "GET"), missing.response);
  assert.equal(missing.statusCode, 401);

  const valid = captureResponse();
  meRoute(
    request("", { authorization: `Bearer ${authInternals.DEFAULT_DEV_TOKEN}` }, "GET"),
    valid.response,
  );
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(jsonBody(valid), {
    plan: "pro",
    remainingToday: rateLimitInternals.PLAN_LIMITS.pro.perDay,
  });
});

test("admin token route stays disabled without ADMIN_SECRET", async () => {
  const previous = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;
  try {
    const captured = captureResponse();
    await adminTokensRoute(request('{"plan":"free"}'), captured.response);
    assert.equal(captured.statusCode, 503);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
  }
});

test("admin token route authenticates and issues a persistent token", async () => {
  const previous = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = "test-admin-secret";
  try {
    const unauthorized = captureResponse();
    await adminTokensRoute(request('{"plan":"free"}'), unauthorized.response);
    assert.equal(unauthorized.statusCode, 403);

    const created = captureResponse();
    await adminTokensRoute(
      request(
        '{"plan":"power","label":"route test"}',
        { "x-admin-secret": "test-admin-secret" },
      ),
      created.response,
    );
    assert.equal(created.statusCode, 201);
    assert.match(
      (jsonBody(created) as { user: { token: string } }).user.token,
      /^eks_/,
    );
  } finally {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
  }
});

test("provider failure refunds reserved quota", async () => {
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const captured = captureResponse();
  const input = JSON.stringify({ postText: "Post", tone: "smart", count: 3 });

  await generateReplyRoute(
    request(input, { authorization: `Bearer ${token}` }),
    captured.response,
    async () => {
      throw new Error("provider failed");
    },
  );

  assert.equal(captured.statusCode, 500);
  assert.equal(
    peekRateLimit(token, "pro").remainingToday,
    rateLimitInternals.PLAN_LIMITS.pro.perDay,
  );
});
