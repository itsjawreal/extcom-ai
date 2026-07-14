import assert from "node:assert/strict";
import test from "node:test";
import {
  ImageValidationError,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  parseAttachedImages,
} from "./attachedImages.js";

const SIGNATURES = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
} as const;

function fakeImage(
  mimeType: keyof typeof SIGNATURES,
  byteLength = 64,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const bytes = Buffer.alloc(byteLength);
  Buffer.from(SIGNATURES[mimeType]).copy(bytes);
  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    mimeType,
    width: 100,
    height: 100,
    ...overrides,
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ImageValidationError);
    return error.code;
  }
  assert.fail("expected an ImageValidationError");
}

test("accepts each supported type and preserves order", () => {
  const input = [fakeImage("image/jpeg"), fakeImage("image/png"), fakeImage("image/webp")];
  const images = parseAttachedImages(input);
  assert.equal(images?.length, 3);
  assert.deepEqual(images?.map((image) => image.mimeType), ["image/jpeg", "image/png", "image/webp"]);
});

test("absent or empty attachments normalize to undefined", () => {
  assert.equal(parseAttachedImages(undefined), undefined);
  assert.equal(parseAttachedImages([]), undefined);
});

test("rejects a fifth image", () => {
  const five = Array.from({ length: 5 }, () => fakeImage("image/png"));
  assert.equal(codeOf(() => parseAttachedImages(five)), "INVALID_IMAGE_DATA");
});

test("rejects unsupported mime types", () => {
  assert.equal(
    codeOf(() => parseAttachedImages([fakeImage("image/png", 64, { mimeType: "image/gif" })])),
    "UNSUPPORTED_IMAGE_TYPE",
  );
});

test("rejects a data URL whose MIME disagrees with the declared mimeType", () => {
  const png = fakeImage("image/png");
  assert.equal(
    codeOf(() => parseAttachedImages([{ ...png, mimeType: "image/jpeg" }])),
    "INVALID_IMAGE_DATA",
  );
});

test("rejects bytes that do not match the declared signature", () => {
  const bytes = Buffer.alloc(64, 0x41); // no known image signature
  const entry = fakeImage("image/png", 64, {
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
  });
  assert.equal(codeOf(() => parseAttachedImages([entry])), "INVALID_IMAGE_DATA");
});

test("rejects zero-byte, corrupt, and non-canonical base64 payloads", () => {
  for (const dataUrl of [
    "data:image/png;base64,",
    "data:image/png;base64,!!!!",
    "data:image/png;base64,AAA", // length % 4 !== 0
    "data:image/png;base64,ib==", // non-canonical: nonzero padding bits re-encode as iQ==
  ]) {
    assert.equal(
      codeOf(() => parseAttachedImages([fakeImage("image/png", 64, { dataUrl })])),
      "INVALID_IMAGE_DATA",
    );
  }
});

test("rejects an oversized single image", () => {
  assert.equal(
    codeOf(() => parseAttachedImages([fakeImage("image/jpeg", MAX_IMAGE_BYTES + 1)])),
    "IMAGE_TOO_LARGE",
  );
});

test("rejects when the combined payload exceeds the total limit", () => {
  const perImage = MAX_IMAGE_BYTES; // 4 × 1.25 MiB > 4 MiB total
  const four = Array.from({ length: 4 }, () => fakeImage("image/jpeg", perImage));
  const error = (() => {
    try {
      parseAttachedImages(four);
    } catch (err) {
      return err;
    }
    return undefined;
  })();
  assert.ok(error instanceof ImageValidationError);
  assert.equal(error.code, "IMAGE_PAYLOAD_TOO_LARGE");
  assert.equal(error.status, 413);
  assert.ok(MAX_IMAGE_BYTES * 4 > MAX_TOTAL_IMAGE_BYTES);
});

test("rejects missing or extreme declared dimensions", () => {
  for (const overrides of [{ width: 0 }, { height: 100000 }, { width: undefined }]) {
    assert.equal(
      codeOf(() => parseAttachedImages([fakeImage("image/png", 64, overrides)])),
      "INVALID_IMAGE_DATA",
    );
  }
});
