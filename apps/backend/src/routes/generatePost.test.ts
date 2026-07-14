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

test("allows a long composer-only source to supply context for fresh mode", () => {
  const composerText = `rough thought ${"x".repeat(5_000)}`;
  const input = validateGeneratePostRequest({
    brief: "",
    existingDraft: composerText,
    mode: "fresh",
    tone: "funny",
  });
  assert.equal(input.brief, "");
  assert.equal(input.existingDraft, composerText);
});

test("rewrite and continue require an existing draft", () => {
  for (const mode of ["rewrite", "continue"] as const) {
    assert.throws(
      () => validateGeneratePostRequest({ brief: "topic", mode, tone: "smart" }),
      new RegExp(`${mode} mode requires existingDraft`),
    );
  }
});

test("continue requires enough total length for the existing draft plus new text", () => {
  const existingDraft = "x".repeat(224);
  assert.throws(
    () => validateGeneratePostRequest({
      existingDraft,
      mode: "continue",
      tone: "auto",
      count: 3,
      maxLength: 50,
    }),
    /existing 224-character draft.*at least 274, or use "auto"/,
  );

  const automatic = validateGeneratePostRequest({
    existingDraft,
    mode: "continue",
    tone: "auto",
    count: 3,
    maxLength: "auto",
  });
  assert.equal(automatic.maxLength, "auto");

  const manual = validateGeneratePostRequest({
    existingDraft,
    mode: "continue",
    tone: "auto",
    count: 3,
    maxLength: 274,
  });
  assert.equal(manual.maxLength, 274);
});

test("continue explains when auto mode leaves too little room", () => {
  assert.throws(
    () => validateGeneratePostRequest({
      existingDraft: "x".repeat(250),
      mode: "continue",
      tone: "auto",
      maxLength: "auto",
    }),
    /existing 250-character draft.*at least 300/,
  );
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

function pngAttachment(): Record<string, unknown> {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return {
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
    mimeType: "image/png",
    width: 100,
    height: 100,
  };
}

test("image-only fresh mode is valid with attachments and no text", () => {
  const input = validateGeneratePostRequest({
    brief: "",
    mode: "fresh",
    tone: "auto",
    attachedImages: [pngAttachment()],
  });
  assert.equal(input.brief, "");
  assert.equal(input.attachedImages?.length, 1);
});

test("fresh mode without text still fails when attachments are absent or empty", () => {
  for (const attachedImages of [undefined, []]) {
    assert.throws(
      () => validateGeneratePostRequest({ brief: "", mode: "fresh", tone: "auto", attachedImages }),
      /Either brief or existingDraft must be provided/,
    );
  }
});

test("rewrite and continue still require text even with attachments", () => {
  for (const mode of ["rewrite", "continue"] as const) {
    assert.throws(
      () => validateGeneratePostRequest({
        brief: "",
        mode,
        tone: "smart",
        attachedImages: [pngAttachment()],
      }),
      new RegExp(`${mode} mode requires existingDraft`),
    );
  }
});

test("invalid attachments are rejected with typed image errors", () => {
  assert.throws(
    () => validateGeneratePostRequest({
      brief: "topic",
      mode: "fresh",
      tone: "smart",
      attachedImages: [{ ...pngAttachment(), mimeType: "image/gif" }],
    }),
    /mimeType must be image\/jpeg, image\/png, or image\/webp/,
  );
});

test("objective is optional and validated against the known list", () => {
  const absent = validateGeneratePostRequest({ brief: "topic", mode: "fresh", tone: "smart" });
  assert.equal(absent.objective, undefined);

  const set = validateGeneratePostRequest({ brief: "topic", mode: "fresh", tone: "smart", objective: "replies" });
  assert.equal(set.objective, "replies");

  assert.throws(
    () => validateGeneratePostRequest({ brief: "topic", mode: "fresh", tone: "smart", objective: "question" }),
    /objective must be omitted or one of: viral, replies, debate, value\./,
  );
});
