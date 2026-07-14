import type { ApiErrorCode, AttachedImageInput } from "../types/index.js";

// Server-side limits for composer attachments (plan §18.5/§18.6). The
// extension enforces the same numbers before sending; these are the
// authoritative bounds because the data URL prefix alone is untrusted.
export const MAX_ATTACHED_IMAGES = 4;
export const MAX_IMAGE_BYTES = Math.floor(1.25 * 1024 * 1024);
export const MAX_TOTAL_IMAGE_BYTES = 4 * 1024 * 1024;
// X caps image uploads at 8192px on the long edge; anything beyond that in
// the declared metadata is a malformed request, not a real attachment.
const MAX_DECLARED_DIMENSION = 8192;

const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export class ImageValidationError extends Error {
  constructor(
    readonly code: Extract<
      ApiErrorCode,
      "UNSUPPORTED_IMAGE_TYPE" | "IMAGE_TOO_LARGE" | "IMAGE_PAYLOAD_TOO_LARGE" | "INVALID_IMAGE_DATA"
    >,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "ImageValidationError";
  }
}

function matchesSignature(bytes: Buffer, mimeType: AttachedImageInput["mimeType"]): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return (
        bytes.length > 7 &&
        bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    case "image/webp":
      return (
        bytes.length > 11 &&
        bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
        bytes.subarray(8, 12).toString("latin1") === "WEBP"
      );
  }
}

function validateDimension(value: unknown, field: string, index: number): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_DECLARED_DIMENSION) {
    throw new ImageValidationError(
      "INVALID_IMAGE_DATA",
      `attachedImages[${index}].${field} must be an integer between 1 and ${MAX_DECLARED_DIMENSION}.`,
    );
  }
  return Number(value);
}

// Validates the untrusted attachedImages field of a Create Post request.
// Returns undefined when the field is absent or an empty array so callers can
// treat "no attachments" uniformly.
export function parseAttachedImages(value: unknown): AttachedImageInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ImageValidationError("INVALID_IMAGE_DATA", "attachedImages must be an array.");
  }
  if (value.length === 0) return undefined;
  if (value.length > MAX_ATTACHED_IMAGES) {
    throw new ImageValidationError(
      "INVALID_IMAGE_DATA",
      `attachedImages must contain at most ${MAX_ATTACHED_IMAGES} entries.`,
    );
  }

  let totalBytes = 0;
  const images: AttachedImageInput[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") {
      throw new ImageValidationError("INVALID_IMAGE_DATA", `attachedImages[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;

    if (
      record.mimeType !== "image/jpeg" &&
      record.mimeType !== "image/png" &&
      record.mimeType !== "image/webp"
    ) {
      throw new ImageValidationError(
        "UNSUPPORTED_IMAGE_TYPE",
        `attachedImages[${index}].mimeType must be image/jpeg, image/png, or image/webp.`,
      );
    }
    const mimeType = record.mimeType;

    if (typeof record.dataUrl !== "string") {
      throw new ImageValidationError("INVALID_IMAGE_DATA", `attachedImages[${index}].dataUrl must be a string.`);
    }
    const match = DATA_URL_PATTERN.exec(record.dataUrl);
    if (!match || !match[1] || !match[2]) {
      throw new ImageValidationError(
        "INVALID_IMAGE_DATA",
        `attachedImages[${index}].dataUrl must be a canonical base64 data URL for a supported image type.`,
      );
    }
    if (match[1] !== mimeType) {
      throw new ImageValidationError(
        "INVALID_IMAGE_DATA",
        `attachedImages[${index}] declares ${mimeType} but its data URL says ${match[1]}.`,
      );
    }

    const base64 = match[2];
    if (base64.length % 4 !== 0) {
      throw new ImageValidationError(
        "INVALID_IMAGE_DATA",
        `attachedImages[${index}].dataUrl base64 payload is malformed.`,
      );
    }
    const bytes = Buffer.from(base64, "base64");
    // Canonical round-trip: rejects padding tricks and non-canonical
    // encodings so the provider receives exactly the bytes we validated.
    if (bytes.length === 0 || bytes.toString("base64") !== base64) {
      throw new ImageValidationError(
        "INVALID_IMAGE_DATA",
        `attachedImages[${index}].dataUrl base64 payload is malformed.`,
      );
    }
    if (!matchesSignature(bytes, mimeType)) {
      throw new ImageValidationError(
        "INVALID_IMAGE_DATA",
        `attachedImages[${index}] bytes do not match the declared ${mimeType} signature.`,
      );
    }

    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new ImageValidationError(
        "IMAGE_TOO_LARGE",
        `attachedImages[${index}] is ${bytes.length} bytes; the per-image maximum is ${MAX_IMAGE_BYTES} bytes.`,
      );
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new ImageValidationError(
        "IMAGE_PAYLOAD_TOO_LARGE",
        `attachedImages exceed the ${MAX_TOTAL_IMAGE_BYTES}-byte total limit. Remove or shrink an image.`,
        413,
      );
    }

    images.push({
      dataUrl: record.dataUrl,
      mimeType,
      width: validateDimension(record.width, "width", index),
      height: validateDimension(record.height, "height", index),
    });
  }
  return images;
}
