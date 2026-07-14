import assert from "node:assert/strict";
import test from "node:test";
import {
  assertModelAllowed,
  expireModelCatalogCacheForTest,
  getModelOptions,
  getModelPricing,
  isCustomModelAllowed,
  MODEL_ALLOWLIST_UNAVAILABLE_MESSAGE,
  modelSupportsParameter,
  modelVisionCapability,
  resetModelCatalogCache,
} from "./modelCatalog.js";

function mockCatalog(
  models: Array<{
    id: string;
    supported_parameters?: string[];
    pricing?: { prompt?: string; completion?: string };
  }>,
) {
  return async () =>
    new Response(JSON.stringify({ data: models }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

// Sets one or more env vars, awaits fn (which may be async), then restores
// the originals — always awaits fn *before* restoring, otherwise an async
// callback's later assertions would run after the env var has already been
// reset, silently testing the wrong state without failing loudly.
async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("getModelOptions returns starter-list models that support structured_outputs", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([
    { id: "google/gemini-2.5-flash-lite", supported_parameters: ["structured_outputs"] },
    { id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] },
  ]);
  try {
    await withEnv({ AI_ALLOWED_MODELS: "google/gemini-2.5-flash-lite,google/gemini-2.5-flash" }, async () => {
      const options = await getModelOptions();
      assert.deepEqual(options.map((option) => option.id), [
        "google/gemini-2.5-flash-lite",
        "google/gemini-2.5-flash",
      ]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelOptions honors AI_ALLOWED_MODELS, not just the built-in starter list", async () => {
  // Distinct from the starter list entirely, so this can only pass if
  // configuredModelIds() actually read AI_ALLOWED_MODELS.
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([
    { id: "some/custom-operator-pick", supported_parameters: ["structured_outputs"] },
  ]);
  try {
    await withEnv({ AI_ALLOWED_MODELS: "some/custom-operator-pick" }, async () => {
      const options = await getModelOptions();
      assert.deepEqual(options.map((option) => option.id), ["some/custom-operator-pick"]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelOptions silently skips a configured model missing from the live catalog", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([
    { id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] },
  ]);
  try {
    await withEnv({ AI_ALLOWED_MODELS: "google/gemini-2.5-flash-lite,google/gemini-2.5-flash" }, async () => {
      const options = await getModelOptions();
      assert.deepEqual(options.map((option) => option.id), ["google/gemini-2.5-flash"]);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelOptions skips a catalog model that does not declare structured_outputs support", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([{ id: "some/legacy-model", supported_parameters: ["tools"] }]);
  try {
    await withEnv({ AI_ALLOWED_MODELS: "some/legacy-model" }, async () => {
      const options = await getModelOptions();
      assert.deepEqual(options, []);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelOptions caches the catalog and does not refetch within the TTL", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  let calls = 0;
  const fetchOnce = mockCatalog([{ id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] }]);
  globalThis.fetch = async () => {
    calls += 1;
    return fetchOnce();
  };
  try {
    await withEnv({ AI_ALLOWED_MODELS: "google/gemini-2.5-flash" }, async () => {
      await getModelOptions();
      await getModelOptions();
      assert.equal(calls, 1);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelOptions falls back to the last-known-good cache when a live fetch fails", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([{ id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] }]);
  try {
    await withEnv({ AI_ALLOWED_MODELS: "google/gemini-2.5-flash" }, async () => {
      const first = await getModelOptions();
      assert.equal(first.length, 1);

      // Force the cache past its TTL, then make the next live fetch fail —
      // this is the actual "OpenRouter briefly unreachable" scenario the
      // fallback exists for.
      expireModelCatalogCacheForTest();
      globalThis.fetch = async () => {
        throw new Error("network down");
      };
      const second = await getModelOptions();
      assert.deepEqual(second, first);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelOptions throws when the live fetch fails and there is no cache yet", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    await withEnv({ AI_ALLOWED_MODELS: "google/gemini-2.5-flash" }, async () => {
      await assert.rejects(() => getModelOptions(), /network down/);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("isCustomModelAllowed defaults to true and only false on explicit false/0", async () => {
  await withEnv({ AI_ALLOW_CUSTOM_MODEL: undefined }, () => {
    assert.equal(isCustomModelAllowed(), true);
  });
  await withEnv({ AI_ALLOW_CUSTOM_MODEL: "false" }, () => {
    assert.equal(isCustomModelAllowed(), false);
  });
  await withEnv({ AI_ALLOW_CUSTOM_MODEL: "0" }, () => {
    assert.equal(isCustomModelAllowed(), false);
  });
  await withEnv({ AI_ALLOW_CUSTOM_MODEL: "true" }, () => {
    assert.equal(isCustomModelAllowed(), true);
  });
});

test("assertModelAllowed is a no-op when no model override was requested", async () => {
  await withEnv({ AI_ALLOW_CUSTOM_MODEL: "false" }, async () => {
    await assert.doesNotReject(() => assertModelAllowed(undefined));
  });
});

test("assertModelAllowed allows anything when custom models are allowed", async () => {
  await withEnv({ AI_ALLOW_CUSTOM_MODEL: "true" }, async () => {
    await assert.doesNotReject(() => assertModelAllowed("literally/anything"));
  });
});

test("assertModelAllowed surfaces a distinct message when the catalog can't be verified at all", async () => {
  // Regression: this used to propagate the raw fetch-failure error, which
  // routes then mapped to a misleading 400 "validation error" instead of a
  // 502 upstream-failure response.
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    await withEnv({ AI_ALLOW_CUSTOM_MODEL: "false" }, async () => {
      await assert.rejects(
        () => assertModelAllowed("some/model"),
        new RegExp(MODEL_ALLOWLIST_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("assertModelAllowed rejects a model outside the allowlist when custom models are disabled", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([{ id: "google/gemini-2.5-flash", supported_parameters: ["structured_outputs"] }]);
  try {
    await withEnv(
      { AI_ALLOWED_MODELS: "google/gemini-2.5-flash", AI_ALLOW_CUSTOM_MODEL: "false" },
      async () => {
        await assert.doesNotReject(() => assertModelAllowed("google/gemini-2.5-flash"));
        await assert.rejects(() => assertModelAllowed("some/other-model"), /not in the backend's allowed list/);
      },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("modelSupportsParameter returns true only when the model declares that parameter", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([
    { id: "google/gemini-2.5-pro", supported_parameters: ["structured_outputs", "reasoning"] },
    { id: "openai/gpt-4o-mini", supported_parameters: ["structured_outputs"] },
  ]);
  try {
    assert.equal(await modelSupportsParameter("google/gemini-2.5-pro", "reasoning"), true);
    assert.equal(await modelSupportsParameter("openai/gpt-4o-mini", "reasoning"), false);
    assert.equal(await modelSupportsParameter("some/unknown-model", "reasoning"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelPricing returns prompt/completion pricing for a known catalog model", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([
    { id: "google/gemini-2.5-flash", pricing: { prompt: "0.0000003", completion: "0.0000025" } },
  ]);
  try {
    const pricing = await getModelPricing("google/gemini-2.5-flash");
    assert.deepEqual(pricing, { prompt: 0.0000003, completion: 0.0000025 });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelPricing returns null for a model missing from the catalog", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([
    { id: "google/gemini-2.5-flash", pricing: { prompt: "0.0000003", completion: "0.0000025" } },
  ]);
  try {
    assert.equal(await getModelPricing("some/unknown-model"), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelPricing returns null when pricing fields are missing or non-numeric", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([
    { id: "no/pricing-field" },
    { id: "bad/pricing-shape", pricing: { prompt: "not-a-number", completion: "0.0000025" } },
  ]);
  try {
    assert.equal(await getModelPricing("no/pricing-field"), null);
    assert.equal(await getModelPricing("bad/pricing-shape"), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelPricing treats a blank pricing string as missing, not free", async () => {
  // Regression: Number("") is 0, not NaN — a naive Number() coercion would
  // silently report a blank/missing price as "$0 per token" instead of
  // omitting the cost estimate.
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = mockCatalog([{ id: "blank/pricing", pricing: { prompt: "", completion: "0.0000025" } }]);
  try {
    assert.equal(await getModelPricing("blank/pricing"), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("getModelPricing returns null (not a throw) when the catalog can't be reached", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    assert.equal(await getModelPricing("google/gemini-2.5-flash"), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("modelSupportsParameter returns false (not a throw) when the catalog can't be reached", async () => {
  // A missing optional parameter is a much smaller problem than a hard
  // failure blocking the whole generate call.
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    assert.equal(await modelSupportsParameter("google/gemini-2.5-pro", "reasoning"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("modelVisionCapability reads OpenRouter input modalities and stays conservative elsewhere", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      data: [
        { id: "vision/model", architecture: { input_modalities: ["text", "image"] } },
        { id: "text/only", architecture: { input_modalities: ["text"] } },
        { id: "legacy/no-arch" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  try {
    assert.equal(await modelVisionCapability("vision/model", "openrouter"), "supported");
    assert.equal(await modelVisionCapability("text/only", "openrouter"), "unsupported");
    assert.equal(await modelVisionCapability("legacy/no-arch", "openrouter"), "unknown");
    assert.equal(await modelVisionCapability("missing/model", "openrouter"), "unknown");
    // Direct OpenAI has no modality catalog: confirm support only, never
    // confirmed absence.
    assert.equal(await modelVisionCapability("gpt-5.4-nano", "openai"), "supported");
    assert.equal(await modelVisionCapability("some-custom-model", "openai"), "unknown");
  } finally {
    globalThis.fetch = previousFetch;
    resetModelCatalogCache();
  }
});

test("modelVisionCapability returns unknown when the catalog is unreachable", async () => {
  resetModelCatalogCache();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  try {
    assert.equal(await modelVisionCapability("vision/model", "openrouter"), "unknown");
  } finally {
    globalThis.fetch = previousFetch;
    resetModelCatalogCache();
  }
});
