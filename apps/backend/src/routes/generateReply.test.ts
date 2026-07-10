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

test("rejects maxLength outside the 50-280 range", () => {
  assert.throws(
    () => validateGenerateRequest({ postText: "Post", tone: "smart", maxLength: 30 }),
    /maxLength must be "auto" or an integer/,
  );
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
