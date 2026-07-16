import { findQuotedPreview } from "./composerQuote";
import type { AttachedImageInput } from "../shared/types";

// Client-side limits; the backend enforces the same numbers authoritatively
// (apps/backend/src/services/attachedImages.ts). Enforcing them here first
// gives the user an actionable error before any bytes leave the browser.
export const MAX_ATTACHED_IMAGES = 4;
export const MAX_IMAGE_BYTES = Math.floor(1.25 * 1024 * 1024);
export const MAX_TOTAL_IMAGE_BYTES = 4 * 1024 * 1024;
// Long-edge cap for re-encoded attachments. 1,600px keeps typical chart and
// screenshot text legible at low provider detail; revisit during the Phase F
// canary (plan §18.5).
export const MAX_LONG_EDGE = 1600;
const ENCODE_QUALITY = 0.88;

const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type AttachmentErrorCode =
  | "ATTACHMENT_READ_FAILED"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_PAYLOAD_TOO_LARGE";

export class AttachmentError extends Error {
  constructor(
    readonly code: AttachmentErrorCode,
    message: string,
    // 1-based position of the failing attachment in X's display order, when
    // the failure is attributable to a single image (plan §18.5: never
    // silently omit an attachment — tell the user which one failed).
    readonly imageIndex?: number,
  ) {
    super(message);
    this.name = "AttachmentError";
  }
}

// One discovered composer attachment, before any bytes are read.
export type ComposerImageAttachment = {
  id: string;
  source: "file" | "blob" | "data" | "remote";
  mimeType?: string;
  previewUrl?: string;
  getBytes: () => Promise<Blob>;
};

export type ComposerAttachmentSnapshot = {
  images: ComposerImageAttachment[];
  // SHA-256 over each attachment's bytes, joined in display order. Computed
  // lazily by fingerprintAttachments() because reading bytes must wait for an
  // explicit Generate (plan §18.10).
  fingerprint?: string;
};

function isLikelyAttachmentImage(img: HTMLImageElement): boolean {
  // X uses several unrelated avatar testids. Timeline/composer avatars start
  // with UserAvatar, while the embedded quote card uses Tweet-User-Avatar.
  // Match the stable semantic fragment so a 40x40 quoted-author avatar can
  // never be counted as the user's attachment.
  if (img.closest('[data-testid*="Avatar"], [data-testid="toolBar"]')) return false;
  // Emoji, icons, and decorative sprites are far smaller than any real
  // attachment preview X renders.
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  return width >= 40 && height >= 40;
}

// Discovers supported image attachments inside one composer root, in X's
// display order, capped at MAX_ATTACHED_IMAGES.
//
// Spike-confirmed (docs/spikes/18a-composer-image-attachments.md, 2026-07-14):
// X clears input[data-testid="fileInput"] after ingesting a selection, so
// the byte source is the blob: preview <img> inside
// div[data-testid="attachments"]. The file-input path stays as a
// future-proof first preference in case X changes that behavior.
export function discoverComposerAttachments(root: HTMLElement): ComposerAttachmentSnapshot {
  const images: ComposerImageAttachment[] = [];
  const seen = new Set<string>();

  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    for (const [index, file] of [...(input.files ?? [])].entries()) {
      if (!SUPPORTED_MIME_TYPES.has(file.type)) continue;
      const id = `file:${file.name}:${file.size}:${file.lastModified}:${index}`;
      if (seen.has(id)) continue;
      seen.add(id);
      images.push({ id, source: "file", mimeType: file.type, getBytes: async () => file });
    }
  }

  if (!images.length) {
    const isQuoteComposer = Boolean(findQuotedPreview(root));
    // Prefer every spike-confirmed attachment container; X may split the
    // quoted preview and the user's attachments into sibling containers in
    // another composer variant. Fall back to the root only when all expected
    // containers disappear.
    const attachmentScopes = Array.from(
      root.querySelectorAll<HTMLElement>('[data-testid="attachments"]'),
    );
    const previewScopes = attachmentScopes.length ? attachmentScopes : [root];
    // A quote composer can mount the quoted preview and the user's own
    // attachments inside the same container. Excluding the whole preview
    // container would therefore hide the user's blobs too. Spike 20-A found
    // the precise boundary: quoted media always sits under tweetPhoto, while
    // composer attachments never do.
    for (const previewScope of previewScopes) {
      for (const img of previewScope.querySelectorAll<HTMLImageElement>("img")) {
        if (img.closest('[data-testid="tweetPhoto"]')) continue;
        const src = img.currentSrc || img.src;
        const scheme = src.split(":")[0];
        if (scheme !== "blob" && scheme !== "data" && scheme !== "https") continue;
        // Browser-real scenario 4 established the durable ownership boundary:
        // the user's composer previews are blob:/data:, while every image
        // belonging to the embedded quoted post is remote HTTPS. tweetPhoto
        // handles primary media; this second guard catches avatars, unloaded
        // media placeholders, and any other remote quote-card assets.
        // ACCEPTED TRADE-OFF (review 2026-07-16): if X ever serves the
        // user's OWN attachments as https inside a quote composer (e.g. a
        // reopened saved draft re-served from CDN — not observed in any
        // spike), they would be misclassified as quote assets and skipped.
        // The inverse error — uploading someone else's quoted media as the
        // user's attachment bytes — is worse, so https stays quote-owned
        // until a spike shows a real own-https case to distinguish.
        if (isQuoteComposer && scheme === "https") continue;
        if (!isLikelyAttachmentImage(img)) continue;
        if (seen.has(src)) continue;
        seen.add(src);
        images.push({
          id: src,
          source: scheme === "https" ? "remote" : scheme,
          previewUrl: src,
          getBytes: async () => {
            const response = await fetch(src);
            if (!response.ok) throw new Error(`Preview fetch failed with ${response.status}.`);
            return response.blob();
          },
        });
      }
    }
  }

  return { images: images.slice(0, MAX_ATTACHED_IMAGES) };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Content-based identity for the stale-media check (plan §18.9): recomputed
// before Insert/Replace and compared with the value captured at Generate.
export async function fingerprintAttachments(images: ComposerImageAttachment[]): Promise<string> {
  const hashes: string[] = [];
  for (const image of images) {
    try {
      hashes.push(await sha256Hex(await (await image.getBytes()).arrayBuffer()));
    } catch {
      // An unreadable attachment still changes identity; hash its id instead
      // so a swap between two unreadable states is still detected.
      hashes.push(`unreadable:${image.id}`);
    }
  }
  return hashes.join("|");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed."));
    reader.readAsDataURL(blob);
  });
}

async function encodeBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mimeType: "image/webp" | "image/jpeg",
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2d context is unavailable.");
  if (mimeType === "image/jpeg") {
    // JPEG has no alpha; flatten onto white instead of default black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type: mimeType, quality: ENCODE_QUALITY });
}

async function prepareOne(blob: Blob, position: number): Promise<AttachedImageInput> {
  if (!SUPPORTED_MIME_TYPES.has(blob.type)) {
    throw new AttachmentError(
      "UNSUPPORTED_IMAGE_TYPE",
      `Attachment ${position} is ${blob.type || "an unknown type"}. Use JPEG, PNG, or WebP.`,
      position,
    );
  }
  if (blob.size === 0) {
    throw new AttachmentError("ATTACHMENT_READ_FAILED", `Attachment ${position} is empty.`, position);
  }

  let bitmap: ImageBitmap;
  try {
    // createImageBitmap respects EXIF orientation and, together with
    // re-encoding below, strips filename/EXIF metadata (plan §18.5).
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new AttachmentError(
      "ATTACHMENT_READ_FAILED",
      `Attachment ${position} could not be decoded. Replace it and try again.`,
      position,
    );
  }

  try {
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    // A PNG already within every bound is passed through untouched: charts
    // and screenshots keep lossless small text (plan §18.5). Everything else
    // is re-encoded — WebP first, JPEG when WebP is unavailable.
    if (blob.type === "image/png" && scale === 1 && blob.size <= MAX_IMAGE_BYTES) {
      return { dataUrl: await blobToDataUrl(blob), mimeType: "image/png", width, height };
    }

    let encoded = await encodeBitmap(bitmap, width, height, "image/webp");
    if (encoded.type !== "image/webp") encoded = await encodeBitmap(bitmap, width, height, "image/jpeg");
    if (encoded.size > MAX_IMAGE_BYTES) {
      throw new AttachmentError(
        "IMAGE_TOO_LARGE",
        `Attachment ${position} is still ${(encoded.size / (1024 * 1024)).toFixed(2)} MiB after compression (limit ${(MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(2)} MiB). Use a smaller image.`,
        position,
      );
    }
    return {
      dataUrl: await blobToDataUrl(encoded),
      mimeType: encoded.type as AttachedImageInput["mimeType"],
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

export type PreparedAttachments = {
  images: AttachedImageInput[];
  fingerprint: string;
};

// Reads, bounds, and encodes every discovered attachment. Call only after the
// user selects Generate — this is the first moment attachment bytes are read
// (plan §18.10). Throws AttachmentError identifying the failing image rather
// than silently dropping it (plan §18.5).
export async function prepareAttachedImages(
  attachments: ComposerImageAttachment[],
): Promise<PreparedAttachments> {
  const capped = attachments.slice(0, MAX_ATTACHED_IMAGES);
  const images: AttachedImageInput[] = [];
  const hashes: string[] = [];
  let totalBytes = 0;

  for (const [index, attachment] of capped.entries()) {
    const position = index + 1;
    let blob: Blob;
    try {
      blob = await attachment.getBytes();
    } catch {
      throw new AttachmentError(
        "ATTACHMENT_READ_FAILED",
        `Attachment ${position} could not be read from the composer. Re-attach it and try again.`,
        position,
      );
    }
    hashes.push(await sha256Hex(await blob.arrayBuffer()));

    const prepared = await prepareOne(blob, position);
    // dataUrl length ≈ 4/3 of encoded bytes; recover the byte count from the
    // base64 payload rather than keeping the intermediate blob alive.
    const base64Length = prepared.dataUrl.length - prepared.dataUrl.indexOf(",") - 1;
    totalBytes += Math.floor((base64Length * 3) / 4);
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new AttachmentError(
        "IMAGE_PAYLOAD_TOO_LARGE",
        `Attachments exceed the ${(MAX_TOTAL_IMAGE_BYTES / (1024 * 1024)).toFixed(0)} MiB combined limit at image ${position}. Remove an image or turn image reading off.`,
        position,
      );
    }
    images.push(prepared);
  }

  return { images, fingerprint: hashes.join("|") };
}
