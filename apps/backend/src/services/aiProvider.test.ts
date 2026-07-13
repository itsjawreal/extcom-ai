import assert from "node:assert/strict";
import test from "node:test";
import { generateReplies, generateWithOpenRouter, providerInternals } from "./aiProvider.js";
import { resetModelCatalogCache } from "./modelCatalog.js";

// generateWithOpenRouter now also looks up the model's supported_parameters
// (to decide whether to send `reasoning`) via a separate fetch to
// OPENROUTER_MODELS_URL before the chat/completions call — this mock
// answers both by URL, and hands the completion request body to onCompletion
// so a test can inspect what was actually sent.
function mockCatalogAndCompletion(
  catalogModels: Array<{ id: string; supported_parameters?: string[] }>,
  onCompletion: (body: Record<string, unknown>) => void,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/models")) {
      return new Response(JSON.stringify({ data: catalogModels }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    onCompletion(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [{ text: "one" }] }) } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
}

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
    220,
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
      220,
    ),
    /incomplete or duplicate/,
  );
});

test("parseReplies resolves the AI-picked tone when tone is auto", () => {
  const result = providerInternals.parseReplies(
    JSON.stringify({ tone: "roast", replies: [{ text: "one" }] }),
    1,
    "auto",
    280,
  );
  assert.equal(result.tone, "roast");
});

test("parseReplies falls back to a safe tone when auto and the model's tone is missing or invalid", () => {
  const missing = providerInternals.parseReplies(JSON.stringify({ replies: [{ text: "one" }] }), 1, "auto", 280);
  assert.equal(missing.tone, "smart");

  const invalid = providerInternals.parseReplies(
    JSON.stringify({ tone: "not-a-real-tone", replies: [{ text: "one" }] }),
    1,
    "auto",
    280,
  );
  assert.equal(invalid.tone, "smart");
});

test("parseReplies does not hard-truncate long-form replies at the old hardcoded 220 cap", () => {
  // Regression: sanitizeReply() used to slice(0, 220) unconditionally,
  // silently cutting long-form replies off mid-sentence server-side even
  // when maxLength was set much higher (e.g. 4000/25000 for X Premium).
  const longText = `${"a".repeat(150)}. ${"b".repeat(150)}.`; // 302 chars, 2 full sentences
  const result = providerInternals.parseReplies(
    JSON.stringify({ replies: [{ text: longText }] }),
    1,
    "smart",
    4_000,
  );
  assert.equal(result.texts[0], longText);
});

test("parseReplies still truncates on a sentence boundary when text exceeds the actual requested limit", () => {
  const longText = `${"a".repeat(150)}. ${"b".repeat(150)}.`; // 302 chars
  const result = providerInternals.parseReplies(
    JSON.stringify({ replies: [{ text: longText }] }),
    1,
    "smart",
    160,
  );
  assert.equal(result.texts[0], `${"a".repeat(150)}.`);
  assert.ok(result.texts[0].length <= 160);
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

test("blocked-term matching is case-insensitive without false substring matches", () => {
  assert.equal(providerInternals.containsBlockedTerm("No BITCOIN here", "bitcoin"), true);
  assert.equal(providerInternals.containsBlockedTerm("classic pump and dump setup", "Pump And Dump"), true);
  assert.equal(providerInternals.containsBlockedTerm("a better solution", "sol"), false);
  assert.equal(providerInternals.containsBlockedTerm("SOL looks strong", "sol"), true);
});

test("generation retries once after a blocked output and reports both attempts' usage", async () => {
  const previousProvider = process.env.AI_DEFAULT_PROVIDER;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.AI_DEFAULT_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const text = calls === 1 ? "Bitcoin is flying" : "the market is flying";
    return new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ replies: [{ text }] }) }] }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await generateReplies({
      postText: "Post",
      tone: "smart",
      count: 1,
      maxLength: 220,
      useEmoji: false,
      blockedTerms: ["bitcoin"],
    });
    assert.equal(calls, 2);
    assert.deepEqual(result.texts, ["the market is flying"]);
    assert.deepEqual(result.usage, { promptTokens: 20, completionTokens: 10 });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete process.env.AI_DEFAULT_PROVIDER;
    else process.env.AI_DEFAULT_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
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

test("pads the JSON schema's text maxLength above the real target", async () => {
  // Regression: this used to equal the raw target exactly — some providers
  // grammar-constrain generation to a strict schema and cut the string
  // precisely there, mid-word, with no ellipsis. Confirmed live: a reply
  // came back as exactly "1000/1000" chars ending on "...institutional
  // backst". The buffer gives room to finish the sentence naturally;
  // sanitizeReply() (tested separately below) does the real trimming down
  // to the true target.
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [{ text: "one" }] }) } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await generateWithOpenRouter({ postText: "Post", tone: "smart", count: 1, maxLength: 1_000, useEmoji: false });
    const schema = (
      (requestBody?.response_format as { json_schema?: { schema?: unknown } })?.json_schema?.schema
    ) as { properties?: { replies?: { items?: { properties?: { text?: { maxLength?: number } } } } } };
    assert.equal(schema.properties?.replies?.items?.properties?.text?.maxLength, 1_150);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("pads the schema's text maxLength in auto mode too (280 base)", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [{ text: "one" }] }) } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await generateWithOpenRouter({ postText: "Post", tone: "smart", count: 1, maxLength: "auto", useEmoji: false });
    const schema = (
      (requestBody?.response_format as { json_schema?: { schema?: unknown } })?.json_schema?.schema
    ) as { properties?: { replies?: { items?: { properties?: { text?: { maxLength?: number } } } } } };
    assert.equal(schema.properties?.replies?.items?.properties?.text?.maxLength, 430);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("re-truncates a reply that used the schema buffer to finish past the true target", async () => {
  // End-to-end: simulates a provider that used the padded schema room to
  // finish its sentence naturally, landing past the true 100-char target —
  // sanitizeReply() should still cut it back to the true target, on a
  // sentence boundary, not leave the padded-length text as-is.
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  const longReply = `${"a".repeat(90)}. ${"b".repeat(40)}.`; // 132 chars, 2 full sentences

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [{ text: longReply }] }) } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const result = await generateWithOpenRouter({
      postText: "Post",
      tone: "smart",
      count: 1,
      maxLength: 100,
      useEmoji: false,
    });
    assert.equal(result.texts[0], `${"a".repeat(90)}.`);
    assert.ok(result.texts[0].length <= 100);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("does not inject a Persona section with the shipped default (empty) PERSONA.md", async () => {
  // Confirms the persona.ts wiring in generateWithOpenRouter doesn't
  // accidentally inject anything for the common (no persona configured)
  // case — the real, shipped PERSONA.md ships with an empty Voice section.
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [{ text: "one" }] }) } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await generateWithOpenRouter({ postText: "Post", tone: "smart", count: 1, maxLength: 220, useEmoji: false });
    const messages = requestBody?.messages as Array<{ role: string; content: unknown }>;
    const userMessage = messages.find((message) => message.role === "user")?.content;
    assert.doesNotMatch(String(userMessage), /Persona — who you are replying as/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("a per-request model overrides AI_DEFAULT_MODEL", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  const previousModel = process.env.AI_DEFAULT_MODEL;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.AI_DEFAULT_MODEL = "openrouter/auto";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replies: [{ text: "one" }] }) } }] }),
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
      model: "google/gemini-2.5-flash",
    });
    assert.equal(requestBody?.model, "google/gemini-2.5-flash");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.AI_DEFAULT_MODEL;
    else process.env.AI_DEFAULT_MODEL = previousModel;
  }
});

test("sends reasoning: effort none when the model declares reasoning support", async () => {
  // Regression: google/gemini-2.5-pro spent its max_tokens budget on
  // invisible internal reasoning before writing the actual JSON reply,
  // producing "AI provider returned invalid JSON" — confirmed live.
  resetModelCatalogCache();
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = mockCatalogAndCompletion(
    [{ id: "google/gemini-2.5-pro", supported_parameters: ["structured_outputs", "reasoning"] }],
    (body) => { requestBody = body; },
  );

  try {
    await generateWithOpenRouter({
      postText: "Post",
      tone: "smart",
      count: 1,
      maxLength: 220,
      useEmoji: false,
      model: "google/gemini-2.5-pro",
    });
    assert.deepEqual(requestBody?.reasoning, { effort: "none" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});

test("omits the reasoning parameter entirely when the model doesn't declare support for it", async () => {
  // Regression guard for the fix above: this backend sets
  // provider.require_parameters: true, so sending `reasoning` to a model
  // that doesn't support it wouldn't be ignored — it would make the whole
  // request unroutable on OpenRouter's side.
  resetModelCatalogCache();
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = mockCatalogAndCompletion(
    [{ id: "openai/gpt-4o-mini", supported_parameters: ["structured_outputs"] }],
    (body) => { requestBody = body; },
  );

  try {
    await generateWithOpenRouter({
      postText: "Post",
      tone: "smart",
      count: 1,
      maxLength: 220,
      useEmoji: false,
      model: "openai/gpt-4o-mini",
    });
    assert.equal("reasoning" in (requestBody ?? {}), false);
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
    // 4000 + the schema buffer (see "pads the JSON schema's text maxLength
    // above the real target" above) — sanitizeReply() still trims the
    // actual response down to the true 4000 target.
    assert.equal(schema.properties?.replies?.items?.properties?.text?.maxLength, 4_150);
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
