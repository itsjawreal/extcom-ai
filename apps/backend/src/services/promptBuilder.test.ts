import assert from "node:assert/strict";
import test from "node:test";
import { buildUserPrompt, SYSTEM_PROMPT } from "./promptBuilder.js";

test("SYSTEM_PROMPT does not bias every reply toward being short", () => {
  // Regression: an unconditional "generate short replies" opening line
  // out-biased the per-request length guidance, so long-form maxLength
  // values (4000/25000) still produced ~150-220 char replies in practice.
  assert.doesNotMatch(SYSTEM_PROMPT, /Generate short/);
});

test("short-form maxLength does not add the long-form paragraph instruction", () => {
  const prompt = buildUserPrompt({
    postText: "Post",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /220 characters, hard limit/);
  assert.doesNotMatch(prompt, /short paragraphs separated by a blank line/);
});

test("long-form maxLength adds the paragraph-structure instruction", () => {
  const prompt = buildUserPrompt({
    postText: "Post",
    tone: "smart",
    count: 1,
    maxLength: 4_000,
    useEmoji: false,
  });
  assert.match(prompt, /4000 characters, hard limit/);
  assert.match(prompt, /short paragraphs separated by a blank line/);
  // Regression: this instruction is what actually counteracts the general
  // brevity bias for long-form requests — without it the model kept
  // writing ~150-220 char replies even at maxLength 4000/25000.
  assert.match(prompt, /not restricted to typical short-tweet brevity/);
});

test("auto maxLength keeps the 280-char cap and no long-form instruction", () => {
  const prompt = buildUserPrompt({
    postText: "Post",
    tone: "smart",
    count: 1,
    maxLength: "auto",
    useEmoji: false,
  });
  assert.match(prompt, /capped at 280 characters/);
  assert.doesNotMatch(prompt, /short paragraphs separated by a blank line/);
});
