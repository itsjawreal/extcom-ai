import assert from "node:assert/strict";
import test from "node:test";
import { generateWithOpenRouter, providerInternals } from "./aiProvider.js";

test("extracts output text from a Responses API payload", () => {
  const text = providerInternals.extractOutputText({
    output: [{ type: "message", content: [{ type: "output_text", text: '{"replies":[]}' }] }],
  });
  assert.equal(text, '{"replies":[]}');
});

test("parses and sanitizes distinct replies", () => {
  const result = providerInternals.parseReplies(
    JSON.stringify({ replies: [{ text: " first   reply " }, { text: "second reply" }] }),
    2,
    "smart",
  );
  assert.deepEqual(result.texts, ["first reply", "second reply"]);
  assert.equal(result.tone, "smart");
});

test("rejects duplicate replies", () => {
  assert.throws(
    () => providerInternals.parseReplies(
      JSON.stringify({ replies: [{ text: "same" }, { text: "same" }] }),
      2,
      "smart",
    ),
    /incomplete or duplicate/,
  );
});

test("parseReplies resolves the AI-picked tone when tone is auto", () => {
  const result = providerInternals.parseReplies(
    JSON.stringify({ tone: "roast", replies: [{ text: "one" }] }),
    1,
    "auto",
  );
  assert.equal(result.tone, "roast");
});

test("parseReplies falls back to a safe tone when auto and the model's tone is missing or invalid", () => {
  const missing = providerInternals.parseReplies(JSON.stringify({ replies: [{ text: "one" }] }), 1, "auto");
  assert.equal(missing.tone, "smart");

  const invalid = providerInternals.parseReplies(
    JSON.stringify({ tone: "not-a-real-tone", replies: [{ text: "one" }] }),
    1,
    "auto",
  );
  assert.equal(invalid.tone, "smart");
});

test("OpenRouter is the default provider and requires its server-side key", async () => {
  const previousProvider = process.env.AI_DEFAULT_PROVIDER;
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.AI_DEFAULT_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;

  const { generateReplies } = await import("./aiProvider.js");
  await assert.rejects(
    generateReplies({ postText: "Post", tone: "smart", count: 3, maxLength: 220, useEmoji: false }),
    /OPENROUTER_API_KEY is not configured/,
  );

  if (previousProvider === undefined) delete process.env.AI_DEFAULT_PROVIDER;
  else process.env.AI_DEFAULT_PROVIDER = previousProvider;
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
});

test("sends an OpenRouter chat completion with structured output", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              replies: [{ text: "one" }, { text: "two" }, { text: "three" }],
            }),
          },
        }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await generateWithOpenRouter({
      postText: "Post",
      tone: "smart",
      count: 3,
      maxLength: 220,
      useEmoji: false,
    });
    assert.deepEqual(result.texts, ["one", "two", "three"]);
    assert.equal(result.tone, "smart");
    assert.equal(requestBody?.model, "openrouter/auto");
    assert.equal(
      (requestBody?.response_format as { type?: string })?.type,
      "json_schema",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("sends a tone schema and resolves the AI's pick when tone is auto", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ tone: "hot_take", replies: [{ text: "one" }] }),
          },
        }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await generateWithOpenRouter({
      postText: "Post",
      tone: "auto",
      count: 1,
      maxLength: 220,
      useEmoji: false,
    });
    assert.deepEqual(result.texts, ["one"]);
    assert.equal(result.tone, "hot_take");

    const schema = (
      (requestBody?.response_format as { json_schema?: { schema?: unknown } })?.json_schema?.schema
    ) as { required?: string[]; properties?: Record<string, unknown> };
    assert.deepEqual(schema.required, ["tone", "replies"]);
    assert.ok(schema.properties?.tone);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
