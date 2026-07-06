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
  const replies = providerInternals.parseReplies(
    JSON.stringify({ replies: [{ text: " first   reply " }, { text: "second reply" }] }),
    2,
  );
  assert.deepEqual(replies, ["first reply", "second reply"]);
});

test("rejects duplicate replies", () => {
  assert.throws(
    () => providerInternals.parseReplies(
      JSON.stringify({ replies: [{ text: "same" }, { text: "same" }] }),
      2,
    ),
    /incomplete or duplicate/,
  );
});

test("OpenRouter is the default provider and requires its server-side key", async () => {
  const previousProvider = process.env.AI_DEFAULT_PROVIDER;
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.AI_DEFAULT_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;

  const { generateReplies } = await import("./aiProvider.js");
  await assert.rejects(
    generateReplies({ postText: "Post", tone: "smart", count: 3 }),
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
    const replies = await generateWithOpenRouter({
      postText: "Post",
      tone: "smart",
      count: 3,
    });
    assert.deepEqual(replies, ["one", "two", "three"]);
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
