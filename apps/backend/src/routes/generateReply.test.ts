import assert from "node:assert/strict";
import test from "node:test";
import { validateGenerateRequest } from "./generateReply.js";

test("validates a generation request", () => {
  const input = validateGenerateRequest({
    postText: "A visible X post",
    tone: "smart",
    count: 3,
  });
  assert.equal(input.postText, "A visible X post");
  assert.equal(input.tone, "smart");
  assert.equal(input.count, 3);
});

test("rejects unsupported tone", () => {
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "spam", count: 3 }),
    /tone must be one of/,
  );
});

test("rejects more than three replies", () => {
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "funny", count: 4 }),
    /count must be an integer/,
  );
});
