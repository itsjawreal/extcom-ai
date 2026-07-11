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

test("computeMaxTokens scales with maxLength and count, floored and capped", () => {
  assert.equal(
    providerInternals.computeMaxTokens({ postText: "Post", tone: "smart", count: 3, maxLength: 220, useEmoji: false }),
    800,
  );
  assert.equal(
    providerInternals.computeMaxTokens({ postText: "Post", tone: "smart", count: 3, maxLength: "auto", useEmoji: false }),
    800,
  );
  const longForm = providerInternals.computeMaxTokens({
    postText: "Post",
    tone: "smart",
    count: 3,
    maxLength: 4_000,
    useEmoji: false,
  });
  assert.ok(longForm > 800, "long-form maxLength should raise the token budget above the floor");
  const extreme = providerInternals.computeMaxTokens({
    postText: "Post",
    tone: "smart",
    count: 3,
    maxLength: 25_000,
    useEmoji: false,
  });
  assert.equal(extreme, 20_000);
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

test("sends one content block per image when imageUrls has multiple entries", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ replies: [{ text: "one" }] }) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await generateWithOpenRouter({
      postText: "Post",
      tone: "smart",
      count: 1,
      maxLength: 220,
      useEmoji: false,
      imageUrls: ["https://pbs.twimg.com/media/a.jpg", "https://pbs.twimg.com/media/b.jpg"],
    });

    const messages = requestBody?.messages as Array<{ role: string; content: unknown }>;
    const userContent = messages.find((message) => message.role === "user")?.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    const imageBlocks = userContent.filter((block) => block.type === "image_url");
    assert.equal(imageBlocks.length, 2);
    assert.deepEqual(
      imageBlocks.map((block) => block.image_url?.url),
      ["https://pbs.twimg.com/media/a.jpg", "https://pbs.twimg.com/media/b.jpg"],
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("scales max_tokens and the JSON schema's text length for a long-form request", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ replies: [{ text: "one" }] }) } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await generateWithOpenRouter({
      postText: "Post",
      tone: "smart",
      count: 1,
      maxLength: 4_000,
      useEmoji: false,
    });

    assert.ok((requestBody?.max_tokens as number) > 800);
    const schema = (
      (requestBody?.response_format as { json_schema?: { schema?: unknown } })?.json_schema?.schema
    ) as { properties?: { replies?: { items?: { properties?: { text?: { maxLength?: number } } } } } };
    assert.equal(schema.properties?.replies?.items?.properties?.text?.maxLength, 4_000);
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
