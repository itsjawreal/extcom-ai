import assert from "node:assert/strict";
import test from "node:test";
import { consumeRateLimit, rateLimitInternals, resetRateLimits } from "./rateLimit.js";

test("tracks daily remaining usage", () => {
  resetRateLimits();
  const first = consumeRateLimit("token-a", "free", new Date("2026-07-08T01:00:00.000Z"));
  assert.equal(first.allowed, true);
  assert.equal(first.remainingToday, rateLimitInternals.PLAN_LIMITS.free.perDay - 1);
});

test("blocks when minute limit is exceeded", () => {
  resetRateLimits();
  const now = new Date("2026-07-08T01:00:00.000Z");
  for (let index = 0; index < rateLimitInternals.PLAN_LIMITS.free.perMinute; index += 1) {
    assert.equal(consumeRateLimit("token-b", "free", now).allowed, true);
  }
  const blocked = consumeRateLimit("token-b", "free", now);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);
});

test("resets minute counts on the next minute", () => {
  resetRateLimits();
  const now = new Date("2026-07-08T01:00:00.000Z");
  for (let index = 0; index < rateLimitInternals.PLAN_LIMITS.free.perMinute; index += 1) {
    consumeRateLimit("token-c", "free", now);
  }
  const nextMinute = consumeRateLimit("token-c", "free", new Date("2026-07-08T01:01:00.000Z"));
  assert.equal(nextMinute.allowed, true);
});
