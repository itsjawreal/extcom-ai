import assert from "node:assert/strict";
import test from "node:test";
import { validateGeneratePostRequest } from "./generatePost.js";

test("validates and normalizes a fresh post request", () => {
  const input = validateGeneratePostRequest({
    brief: "  Share a take about open source AI  ",
    mode: "fresh",
    language: "brief",
    tone: "smart",
    count: 3,
    maxLength: 280,
    useEmoji: false,
  });
  assert.equal(input.brief, "Share a take about open source AI");
  assert.equal(input.mode, "fresh");
  assert.equal(input.language, "brief");
});

test("allows an existing draft to supply context for fresh mode", () => {
  const input = validateGeneratePostRequest({
    existingDraft: "rough thought",
    mode: "fresh",
    tone: "funny",
  });
  assert.equal(input.brief, "");
  assert.equal(input.existingDraft, "rough thought");
});

test("rewrite and continue require an existing draft", () => {
  for (const mode of ["rewrite", "continue"] as const) {
    assert.throws(
      () => validateGeneratePostRequest({ brief: "topic", mode, tone: "smart" }),
      new RegExp(`${mode} mode requires existingDraft`),
    );
  }
});

test("rejects missing source material and unsupported modes", () => {
  assert.throws(
    () => validateGeneratePostRequest({ brief: "", mode: "fresh", tone: "smart" }),
    /Either brief or existingDraft/,
  );
  assert.throws(
    () => validateGeneratePostRequest({ brief: "topic", mode: "expand", tone: "smart" }),
    /mode must be/,
  );
});

test("validates language, count, max length, and emoji preference", () => {
  assert.throws(
    () => validateGeneratePostRequest({ brief: "topic", mode: "fresh", tone: "smart", language: "id" }),
    /language must be/,
  );
  assert.throws(
    () => validateGeneratePostRequest({ brief: "topic", mode: "fresh", tone: "smart", count: 4 }),
    /count must be/,
  );
  assert.throws(
    () => validateGeneratePostRequest({ brief: "topic", mode: "fresh", tone: "smart", maxLength: 25_001 }),
    /maxLength must be/,
  );
  assert.throws(
    () => validateGeneratePostRequest({ brief: "topic", mode: "fresh", tone: "smart", useEmoji: "yes" }),
    /useEmoji must be/,
  );
});

test("rejects malformed or oversized optional text instead of silently dropping it", () => {
  assert.throws(
    () => validateGeneratePostRequest({
      brief: "x".repeat(5_001),
      existingDraft: "valid fallback",
      mode: "fresh",
      tone: "smart",
    }),
    /brief must contain at most 5000 characters/,
  );
  assert.throws(
    () => validateGeneratePostRequest({
      brief: "topic",
      existingDraft: 123,
      mode: "fresh",
      tone: "smart",
    }),
    /existingDraft must be a string/,
  );
  assert.throws(
    () => validateGeneratePostRequest({
      brief: "topic",
      mode: "fresh",
      tone: "smart",
      extraInstruction: "x".repeat(501),
    }),
    /extraInstruction must contain at most 500 characters/,
  );
});

test("deduplicates Never mention rules case-insensitively", () => {
  const input = validateGeneratePostRequest({
    brief: "topic",
    mode: "fresh",
    tone: "smart",
    blockedTerms: [" Bitcoin ", "bitcoin", "pump and dump"],
  });
  assert.deepEqual(input.blockedTerms, ["Bitcoin", "pump and dump"]);
});
