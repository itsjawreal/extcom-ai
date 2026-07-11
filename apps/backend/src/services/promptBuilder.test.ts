import assert from "node:assert/strict";
import test from "node:test";
import { buildUserPrompt } from "./promptBuilder.js";

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
