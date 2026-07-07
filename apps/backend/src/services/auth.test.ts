import assert from "node:assert/strict";
import test from "node:test";
import { authenticateToken, authInternals, parseAuthToken } from "./auth.js";

test("parses a bearer token", () => {
  assert.equal(parseAuthToken("Bearer abc123"), "abc123");
  assert.equal(parseAuthToken("Basic abc123"), null);
  assert.equal(parseAuthToken(undefined), null);
});

test("authenticates configured tokens with plans", () => {
  const previous = process.env.AUTH_TOKENS;
  process.env.AUTH_TOKENS = "free-token,pro-token:pro,power-token:power";

  try {
    assert.deepEqual(authenticateToken("free-token"), { token: "free-token", plan: "free" });
    assert.deepEqual(authenticateToken("pro-token"), { token: "pro-token", plan: "pro" });
    assert.deepEqual(authenticateToken("power-token"), { token: "power-token", plan: "power" });
    assert.equal(authenticateToken("missing"), null);
  } finally {
    if (previous === undefined) delete process.env.AUTH_TOKENS;
    else process.env.AUTH_TOKENS = previous;
  }
});

test("accepts the development fallback token outside production", () => {
  const previousEnv = process.env.NODE_ENV;
  delete process.env.AUTH_TOKENS;
  process.env.NODE_ENV = "test";

  try {
    assert.deepEqual(authenticateToken(authInternals.DEFAULT_DEV_TOKEN), {
      token: authInternals.DEFAULT_DEV_TOKEN,
      plan: "pro",
    });
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});
