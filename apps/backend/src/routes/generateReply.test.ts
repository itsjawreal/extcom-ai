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
    /tone must be "auto" or one of/,
  );
});

test("accepts tone: auto", () => {
  const input = validateGenerateRequest({ postText: "Post", tone: "auto", count: 3 });
  assert.equal(input.tone, "auto");
});

test("rejects more than three replies", () => {
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "funny", count: 4 }),
    /count must be an integer/,
  );
});

test("accepts maxLength: auto", () => {
  const input = validateGenerateRequest({
    postText: "Post",
    tone: "smart",
    maxLength: "auto",
  });
  assert.equal(input.maxLength, "auto");
});

test("rejects an invalid maxLength string", () => {
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", maxLength: "Auto" }),
    /maxLength must be "auto" or an integer/,
  );
});

test("rejects maxLength outside the 50-25000 range", () => {
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", maxLength: 30 }),
    /maxLength must be "auto" or an integer/,
  );
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", maxLength: 25_001 }),
    /maxLength must be "auto" or an integer/,
  );
});

test("accepts a long-form maxLength up to the X Premium+ ceiling", () => {
  const input = validateGenerateRequest({ postText: "Post", tone: "smart", maxLength: 25_000 });
  assert.equal(input.maxLength, 25_000);
});

test("accepts multiple imageUrls up to 4", () => {
  const urls = [
    "https://pbs.twimg.com/media/a.jpg",
    "https://pbs.twimg.com/media/b.jpg",
    "https://pbs.twimg.com/media/c.jpg",
    "https://pbs.twimg.com/media/d.jpg",
  ];
  const input = validateGenerateRequest({ postText: "Post", tone: "smart", imageUrls: urls });
  assert.deepEqual(input.imageUrls, urls);
});

test("rejects more than 4 imageUrls", () => {
  const urls = Array.from({ length: 5 }, (_, i) => `https://pbs.twimg.com/media/${i}.jpg`);
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", imageUrls: urls }),
    /imageUrls must contain at most 4 items/,
  );
});

test("rejects a non-http imageUrls entry", () => {
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", imageUrls: ["not-a-url"] }),
    /Each imageUrls item must be a valid http\(s\) URL/,
  );
});

test("treats an empty imageUrls array as undefined", () => {
  const input = validateGenerateRequest({ postText: "Post", tone: "smart", imageUrls: [] });
  assert.equal(input.imageUrls, undefined);
});

test("accepts an image-only request with no postText", () => {
  const input = validateGenerateRequest({
    tone: "smart",
    imageUrls: ["https://pbs.twimg.com/media/a.jpg"],
  });
  assert.equal(input.postText, "");
  assert.deepEqual(input.imageUrls, ["https://pbs.twimg.com/media/a.jpg"]);
});

test("rejects a request with neither postText nor imageUrls", () => {
  assert.throws(
    () => validateGenerateRequest({ tone: "smart" }),
    /Either postText or imageUrls must be provided/,
  );
});

test("accepts an optional model override", () => {
  const input = validateGenerateRequest({ postText: "Post", tone: "smart", model: "google/gemini-2.5-flash" });
  assert.equal(input.model, "google/gemini-2.5-flash");
});

test("model is undefined when omitted, falling back to AI_DEFAULT_MODEL downstream", () => {
  const input = validateGenerateRequest({ postText: "Post", tone: "smart" });
  assert.equal(input.model, undefined);
});

test("accepts post-language metadata and English override", () => {
  const input = validateGenerateRequest({
    postText: "Pasar lagi ramai",
    tone: "smart",
    sourceLanguage: "id-ID",
    replyLanguage: "en",
  });
  assert.equal(input.sourceLanguage, "id-ID");
  assert.equal(input.replyLanguage, "en");
});

test("defaults replyLanguage to post and rejects invalid language values", () => {
  const input = validateGenerateRequest({ postText: "Post", tone: "smart" });
  assert.equal(input.replyLanguage, "post");
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", replyLanguage: "fr" }),
    /replyLanguage must be "post" or "en"/,
  );
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", sourceLanguage: "not a tag" }),
    /valid BCP 47 language tag/,
  );
});

test("canonicalizes X legacy language codes and treats und as unknown", () => {
  const indonesian = validateGenerateRequest({ postText: "Pasar naik", tone: "smart", sourceLanguage: "in" });
  const unknown = validateGenerateRequest({ postText: "gm", tone: "smart", sourceLanguage: "und" });
  assert.equal(indonesian.sourceLanguage, "id");
  assert.equal(unknown.sourceLanguage, undefined);
});

test("normalizes and deduplicates blocked terms case-insensitively", () => {
  const input = validateGenerateRequest({
    postText: "Post",
    tone: "smart",
    blockedTerms: ["  Bitcoin  ", "bitcoin", "pump and dump"],
  });
  assert.deepEqual(input.blockedTerms, ["Bitcoin", "pump and dump"]);
});

test("rejects invalid blocked terms", () => {
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", blockedTerms: Array(51).fill("x") }),
    /at most 50 items/,
  );
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", blockedTerms: [""] }),
    /non-empty string of at most 80 characters/,
  );
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", blockedTerms: ["x".repeat(81)] }),
    /non-empty string of at most 80 characters/,
  );
});

test("objective is optional and validated against the known list", () => {
  const absent = validateGenerateRequest({ postText: "Post", tone: "smart", count: 1 });
  assert.equal(absent.objective, undefined);

  const set = validateGenerateRequest({ postText: "Post", tone: "smart", count: 1, objective: "viral" });
  assert.equal(set.objective, "viral");

  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", count: 1, objective: "spam" }),
    /objective must be omitted or one of: viral, replies, debate, value\./,
  );
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", count: 1, objective: 3 }),
    /objective must be omitted or one of/,
  );
});
