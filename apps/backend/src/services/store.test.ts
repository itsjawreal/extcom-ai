import assert from "node:assert/strict";
import test from "node:test";
import { authenticateToken } from "./auth.js";
import { consumeRateLimit, peekRateLimit, resetRateLimits } from "./rateLimit.js";
import { createUser, findUser, listUsers } from "./store.js";

test("createUser issues a token that authenticates with its plan", () => {
  const user = createUser("pro", "beta tester");
  assert.match(user.token, /^eks_/);
  assert.equal(findUser(user.token)?.plan, "pro");

  const authenticated = authenticateToken(user.token);
  assert.equal(authenticated?.plan, "pro");
});

test("unknown tokens do not authenticate", () => {
  assert.equal(authenticateToken("eks_definitely-not-issued"), null);
});

test("listUsers includes issued tokens", () => {
  const user = createUser("free", "list check");
  assert.ok(listUsers().some((entry) => entry.token === user.token));
});

test("usage windows persist across consumeRateLimit calls", () => {
  resetRateLimits();
  const user = createUser("free");
  const now = new Date("2026-07-08T02:00:00.000Z");
  const first = consumeRateLimit(user.token, "free", now);
  const second = consumeRateLimit(user.token, "free", now);
  assert.equal(first.remainingToday - second.remainingToday, 1);
});

test("peekRateLimit reports remaining quota without consuming it", () => {
  resetRateLimits();
  const user = createUser("free");
  const now = new Date("2026-07-08T03:00:00.000Z");
  consumeRateLimit(user.token, "free", now);
  const before = peekRateLimit(user.token, "free", now);
  const after = peekRateLimit(user.token, "free", now);
  assert.equal(before.remainingToday, after.remainingToday);
  assert.equal(consumeRateLimit(user.token, "free", now).remainingToday, before.remainingToday - 1);
});
