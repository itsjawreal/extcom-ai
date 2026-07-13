import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { adminTokensRoute } from "./adminTokens.js";
import { generateReplyRoute } from "./generateReply.js";
import { generatePostRoute } from "./generatePost.js";
import { meRoute } from "./me.js";
import { modelsRoute } from "./models.js";
import { testModelRoute } from "./testModel.js";
import { authInternals } from "../services/auth.js";
import { resetModelCatalogCache } from "../services/modelCatalog.js";
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

test("GET /v1/models requires auth and returns the catalog + allowCustom flag", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  const previousAllowed = process.env.AI_ALLOWED_MODELS;
  const previousCustom = process.env.AI_ALLOW_CUSTOM_MODEL;
  process.env.AI_ALLOWED_MODELS = "google/gemini-2.5-flash";
  process.env.AI_ALLOW_CUSTOM_MODEL = "false";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [{ id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const unauthorized = captureResponse();
    await modelsRoute(request("", {}, "GET"), unauthorized.response);
    assert.equal(unauthorized.statusCode, 401);

    const authorized = captureResponse();
    await modelsRoute(
      request("", { authorization: `Bearer ${authInternals.DEFAULT_DEV_TOKEN}` }, "GET"),
      authorized.response,
    );
    assert.equal(authorized.statusCode, 200);
    const body = jsonBody(authorized) as { models: Array<{ id: string }>; allowCustom: boolean };
    assert.deepEqual(body.models.map((m) => m.id), ["google/gemini-2.5-flash"]);
    assert.equal(body.allowCustom, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousAllowed === undefined) delete process.env.AI_ALLOWED_MODELS;
    else process.env.AI_ALLOWED_MODELS = previousAllowed;
    if (previousCustom === undefined) delete process.env.AI_ALLOW_CUSTOM_MODEL;
    else process.env.AI_ALLOW_CUSTOM_MODEL = previousCustom;
  }
});

test("POST /v1/test-model runs a real minimal generate call against the given model", async () => {
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;

  const missingModel = captureResponse();
  await testModelRoute(
    request("{}", { authorization: `Bearer ${token}` }),
    missingModel.response,
    async () => ({ texts: ["ok"], tone: "smart" }),
  );
  assert.equal(missingModel.statusCode, 400);

  const success = captureResponse();
  let receivedModel: string | undefined;
  await testModelRoute(
    request(JSON.stringify({ model: "google/gemini-2.5-flash" }), { authorization: `Bearer ${token}` }),
    success.response,
    async (input) => {
      receivedModel = input.model;
      return { texts: ["a test reply"], tone: "smart" };
    },
  );
  assert.equal(success.statusCode, 200);
  assert.deepEqual(jsonBody(success), { ok: true });
  assert.equal(receivedModel, "google/gemini-2.5-flash");
});

test("POST /v1/test-model refunds quota and surfaces the provider error on failure", async () => {
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const captured = captureResponse();

  await testModelRoute(
    request(JSON.stringify({ model: "some/broken-model" }), { authorization: `Bearer ${token}` }),
    captured.response,
    async () => {
      throw new Error("model test failed");
    },
  );

  assert.equal(captured.statusCode, 500);
  assert.equal(
    peekRateLimit(token, "pro").remainingToday,
    rateLimitInternals.PLAN_LIMITS.pro.perDay,
  );
});

test("POST /v1/test-model rejects a model outside the allowlist when custom models are disabled", async () => {
  resetModelCatalogCache();
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const previousFetch = globalThis.fetch;
  const previousAllowed = process.env.AI_ALLOWED_MODELS;
  const previousCustom = process.env.AI_ALLOW_CUSTOM_MODEL;
  process.env.AI_ALLOWED_MODELS = "google/gemini-2.5-flash";
  process.env.AI_ALLOW_CUSTOM_MODEL = "false";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [{ id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const captured = captureResponse();
    await testModelRoute(
      request(JSON.stringify({ model: "some/not-allowed" }), { authorization: `Bearer ${token}` }),
      captured.response,
      async () => ({ texts: ["ok"], tone: "smart" }),
    );
    assert.equal(captured.statusCode, 400);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousAllowed === undefined) delete process.env.AI_ALLOWED_MODELS;
    else process.env.AI_ALLOWED_MODELS = previousAllowed;
    if (previousCustom === undefined) delete process.env.AI_ALLOW_CUSTOM_MODEL;
    else process.env.AI_ALLOW_CUSTOM_MODEL = previousCustom;
  }
});

test("POST /v1/generate-reply rejects a model outside the allowlist when custom models are disabled", async () => {
  resetModelCatalogCache();
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const previousFetch = globalThis.fetch;
  const previousAllowed = process.env.AI_ALLOWED_MODELS;
  const previousCustom = process.env.AI_ALLOW_CUSTOM_MODEL;
  process.env.AI_ALLOWED_MODELS = "google/gemini-2.5-flash";
  process.env.AI_ALLOW_CUSTOM_MODEL = "false";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [{ id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const input = JSON.stringify({ postText: "Post", tone: "smart", count: 1, model: "some/not-allowed" });
    const captured = captureResponse();
    await generateReplyRoute(
      request(input, { authorization: `Bearer ${token}` }),
      captured.response,
      async () => ({ texts: ["ok"], tone: "smart" }),
    );
    assert.equal(captured.statusCode, 400);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousAllowed === undefined) delete process.env.AI_ALLOWED_MODELS;
    else process.env.AI_ALLOWED_MODELS = previousAllowed;
    if (previousCustom === undefined) delete process.env.AI_ALLOW_CUSTOM_MODEL;
    else process.env.AI_ALLOW_CUSTOM_MODEL = previousCustom;
  }
});

test("POST /v1/test-model returns 502 (not 400) when the allowlist can't be verified", async () => {
  resetModelCatalogCache();
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const previousFetch = globalThis.fetch;
  const previousCustom = process.env.AI_ALLOW_CUSTOM_MODEL;
  process.env.AI_ALLOW_CUSTOM_MODEL = "false";
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  try {
    const captured = captureResponse();
    await testModelRoute(
      request(JSON.stringify({ model: "some/model" }), { authorization: `Bearer ${token}` }),
      captured.response,
      async () => ({ texts: ["ok"], tone: "smart" }),
    );
    assert.equal(captured.statusCode, 502);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCustom === undefined) delete process.env.AI_ALLOW_CUSTOM_MODEL;
    else process.env.AI_ALLOW_CUSTOM_MODEL = previousCustom;
  }
});

test("POST /v1/generate-reply returns 502 (not 400) when the allowlist can't be verified", async () => {
  resetModelCatalogCache();
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const previousFetch = globalThis.fetch;
  const previousCustom = process.env.AI_ALLOW_CUSTOM_MODEL;
  process.env.AI_ALLOW_CUSTOM_MODEL = "false";
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  try {
    const input = JSON.stringify({ postText: "Post", tone: "smart", count: 1, model: "some/model" });
    const captured = captureResponse();
    await generateReplyRoute(
      request(input, { authorization: `Bearer ${token}` }),
      captured.response,
      async () => ({ texts: ["ok"], tone: "smart" }),
    );
    assert.equal(captured.statusCode, 502);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCustom === undefined) delete process.env.AI_ALLOW_CUSTOM_MODEL;
    else process.env.AI_ALLOW_CUSTOM_MODEL = previousCustom;
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

test("POST /v1/generate-reply includes the resolved model even when the provider reports no usage", async () => {
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const captured = captureResponse();
  const input = JSON.stringify({ postText: "Post", tone: "smart", count: 1, model: "google/gemini-2.5-flash" });

  await generateReplyRoute(
    request(input, { authorization: `Bearer ${token}` }),
    captured.response,
    async () => ({ texts: ["ok"], tone: "smart", model: "google/gemini-2.5-flash", usage: null }),
  );

  assert.equal(captured.statusCode, 200);
  const body = jsonBody(captured) as { model?: string; tokenUsage?: unknown };
  assert.equal(body.model, "google/gemini-2.5-flash");
  assert.equal(body.tokenUsage, undefined);
});

test("POST /v1/generate-reply includes tokenUsage with an estimated cost when the provider reports usage and pricing is known", async () => {
  resetModelCatalogCache();
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [{ id: "google/gemini-2.5-flash", pricing: { prompt: "0.0000003", completion: "0.0000025" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const captured = captureResponse();
    const input = JSON.stringify({ postText: "Post", tone: "smart", count: 1, model: "google/gemini-2.5-flash" });

    await generateReplyRoute(
      request(input, { authorization: `Bearer ${token}` }),
      captured.response,
      async () => ({
        texts: ["ok"],
        tone: "smart",
        model: "google/gemini-2.5-flash",
        usage: { promptTokens: 1000, completionTokens: 200 },
      }),
    );

    assert.equal(captured.statusCode, 200);
    const body = jsonBody(captured) as {
      model?: string;
      tokenUsage?: { promptTokens: number; completionTokens: number; estimatedCostUsd?: number };
    };
    assert.equal(body.model, "google/gemini-2.5-flash");
    assert.deepEqual(body.tokenUsage, {
      promptTokens: 1000,
      completionTokens: 200,
      estimatedCostUsd: 1000 * 0.0000003 + 200 * 0.0000025,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("POST /v1/generate-reply reports tokenUsage without estimatedCostUsd when pricing is unknown", async () => {
  resetModelCatalogCache();
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const captured = captureResponse();
    const input = JSON.stringify({ postText: "Post", tone: "smart", count: 1 });

    await generateReplyRoute(
      request(input, { authorization: `Bearer ${token}` }),
      captured.response,
      async () => ({
        texts: ["ok"],
        tone: "smart",
        model: "some/unpriced-model",
        usage: { promptTokens: 50, completionTokens: 10 },
      }),
    );

    assert.equal(captured.statusCode, 200);
    const body = jsonBody(captured) as {
      tokenUsage?: { promptTokens: number; completionTokens: number; estimatedCostUsd?: number };
    };
    // JSON.stringify drops an undefined estimatedCostUsd entirely, so the
    // wire response has no such key at all — not a literal `undefined` value.
    assert.deepEqual(body.tokenUsage, { promptTokens: 50, completionTokens: 10 });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("POST /v1/generate-reply does not let a hung pricing lookup delay the response", async () => {
  // Regression: the pricing lookup used to be awaited with no bound, so an
  // unreachable/slow OpenRouter catalog fetch (up to modelCatalog's own 10s
  // timeout) would delay returning already-generated replies for something
  // as non-critical as a cost estimate.
  resetModelCatalogCache();
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise<Response>(() => {}); // never resolves

  try {
    const captured = captureResponse();
    const input = JSON.stringify({ postText: "Post", tone: "smart", count: 1, model: "some/model" });

    const startedAt = Date.now();
    await generateReplyRoute(
      request(input, { authorization: `Bearer ${token}` }),
      captured.response,
      async () => ({
        texts: ["ok"],
        tone: "smart",
        model: "some/model",
        usage: { promptTokens: 50, completionTokens: 10 },
      }),
    );
    const elapsedMs = Date.now() - startedAt;

    assert.equal(captured.statusCode, 200);
    assert.ok(elapsedMs < 3_500, `expected the response to return well under 3.5s, took ${elapsedMs}ms`);
    const body = jsonBody(captured) as {
      tokenUsage?: { promptTokens: number; completionTokens: number; estimatedCostUsd?: number };
    };
    assert.deepEqual(body.tokenUsage, { promptTokens: 50, completionTokens: 10 });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("POST /v1/generate-post requires auth", async () => {
  const captured = captureResponse();
  await generatePostRoute(request(JSON.stringify({ brief: "topic", mode: "fresh", tone: "smart" })), captured.response);
  assert.equal(captured.statusCode, 401);
});

test("POST /v1/generate-post returns standalone post drafts and consumes one quota unit", async () => {
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const captured = captureResponse();
  let receivedMode: string | undefined;

  await generatePostRoute(
    request(
      JSON.stringify({ brief: "A take about open source", mode: "fresh", language: "brief", tone: "auto", count: 2 }),
      { authorization: `Bearer ${token}` },
    ),
    captured.response,
    async (input) => {
      receivedMode = input.mode;
      return { texts: ["first standalone post", "second standalone post"], tone: "smart", model: "test/model" };
    },
  );

  assert.equal(captured.statusCode, 200);
  assert.equal(receivedMode, "fresh");
  assert.deepEqual(jsonBody(captured), {
    posts: [
      { id: "post_1", text: "first standalone post", tone: "smart" },
      { id: "post_2", text: "second standalone post", tone: "smart" },
    ],
    usage: { remainingToday: rateLimitInternals.PLAN_LIMITS.pro.perDay - 1, plan: "pro" },
    model: "test/model",
  });
});

test("POST /v1/generate-post rejects unsafe instructions before consuming quota", async () => {
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const captured = captureResponse();
  await generatePostRoute(
    request(
      JSON.stringify({ brief: "topic", mode: "fresh", tone: "smart", extraInstruction: "auto-post this for me" }),
      { authorization: `Bearer ${token}` },
    ),
    captured.response,
  );
  assert.equal(captured.statusCode, 422);
  assert.equal(peekRateLimit(token, "pro").remainingToday, rateLimitInternals.PLAN_LIMITS.pro.perDay);
});

test("POST /v1/generate-post refunds quota when generation fails", async () => {
  resetRateLimits();
  const token = authInternals.DEFAULT_DEV_TOKEN;
  const captured = captureResponse();
  await generatePostRoute(
    request(
      JSON.stringify({ brief: "topic", mode: "fresh", tone: "smart" }),
      { authorization: `Bearer ${token}` },
    ),
    captured.response,
    async () => {
      throw new Error("provider failed");
    },
  );
  assert.equal(captured.statusCode, 500);
  assert.equal(peekRateLimit(token, "pro").remainingToday, rateLimitInternals.PLAN_LIMITS.pro.perDay);
});
