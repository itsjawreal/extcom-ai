import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeReply } from "./safety.js";

test("sanitizeReply leaves short text under the limit untouched", () => {
  assert.equal(sanitizeReply("a short reply", 220), "a short reply");
});

test("sanitizeReply does not hard-cap at the old hardcoded 220, regardless of the requested limit", () => {
  const text = `${"word ".repeat(100)}done.`; // ~505 chars, one long sentence
  const result = sanitizeReply(text, 4_000);
  assert.equal(result, text.trim());
  assert.ok(result.length > 220);
});

test("sanitizeReply truncates at the last full sentence within the actual limit", () => {
  const text = "First sentence here. Second sentence goes on for a while longer than the limit allows.";
  const result = sanitizeReply(text, 25);
  assert.equal(result, "First sentence here.");
});

test("sanitizeReply falls back to a word boundary with an ellipsis when no sentence fits", () => {
  const text = "onewordthatkeepsgoing andanotherword andmorewords withoutanyperiodsatall";
  const result = sanitizeReply(text, 20);
  assert.ok(result.endsWith("…"));
  assert.ok(result.length <= 20);
});

test("sanitizeReply collapses whitespace and strips excess hashtags/emoji", () => {
  assert.equal(sanitizeReply("hello   world", 220), "hello world");
  assert.equal(sanitizeReply("great #win #lets #go #now", 220), "great");
  assert.equal(sanitizeReply("fire 🔥🔥🔥🔥", 220), "fire 🔥");
});

test("sanitizeReply preserves intentional paragraphs and caps excess blank lines", () => {
  assert.equal(
    sanitizeReply("first line  \r\n\r\n\r\n second   line", 220),
    "first line\n\nsecond line",
  );
});

test("sanitizeReply can truncate on a line boundary when no sentence fits", () => {
  const result = sanitizeReply("opening without punctuation\ncontinuationthatcannotfit", 30);
  assert.equal(result, "opening without punctuation…");
  assert.ok(result.length <= 30);
});

test("sanitizeReply preserves normal relevant emoji usage", () => {
  assert.equal(sanitizeReply("clean setup 🔥", 220), "clean setup 🔥");
  assert.equal(sanitizeReply("strong move 🚀 worth watching 👀", 220), "strong move 🚀 worth watching 👀");
});
