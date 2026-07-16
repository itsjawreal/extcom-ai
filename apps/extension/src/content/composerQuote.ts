// Quote-composer detection and quoted-tweet extraction (plan §20).
//
// Spike-confirmed (docs/spikes/20a-quote-composer.md, 2026-07-15): X mounts
// the quoted-tweet preview inside the same div[data-testid="attachments"]
// container used for image attachments, on the same /compose/post route as
// the plain modal. The preview exposes [data-testid="tweetText"] (with a
// lang attr), [data-testid="User-Name"] spans, a <time> element, and — when
// the quoted tweet has media — https pbs.twimg.com images under
// [data-testid="tweetPhoto"]. A plain modal has none of these (scenario 5
// control), so their presence is the detection predicate.

import { normalizeLanguageTag } from "./extractPost";

export type QuotedPostContext = {
  // May be "" for an image-only quoted tweet.
  text: string;
  authorHandle?: string;
  authorName?: string;
  // Up to 4 https CDN URLs, upgraded from the preview's tiny variant.
  imageUrls?: string[];
  // BCP 47 tag from the preview's tweetText lang attr, when present.
  sourceLanguage?: string;
};

const MAX_QUOTED_IMAGES = 4;

function cleanText(value: string | null | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

// The preview ships the `name=tiny` thumbnail (~120px) — too small for a
// provider to read chart/photo detail. `small` (680px long edge) matches
// what X serves in the timeline and what reply-image reading already sends.
function upgradeMediaVariant(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get("name") === "tiny") parsed.searchParams.set("name", "small");
    return parsed.toString();
  } catch {
    return url;
  }
}

// Returns the quoted-tweet preview element inside a standalone composer
// root, or null when this is not a quote composer. Scoped to the
// attachments container so composer chrome (the user's own avatar, toolbar)
// can never satisfy the predicate.
export function findQuotedPreview(root: HTMLElement): HTMLElement | null {
  for (const container of root.querySelectorAll<HTMLElement>('[data-testid="attachments"]')) {
    if (
      container.querySelector('[data-testid="tweetText"]') ||
      (container.querySelector('[data-testid="User-Name"]') && container.querySelector("time"))
    ) {
      return container;
    }
  }
  return null;
}

// Extracts the quoted tweet from a preview element found by
// findQuotedPreview(). Returns null when nothing usable is readable (markup
// drift) so callers can degrade to text-only generation with a visible
// notice instead of failing.
export function extractQuotedPost(preview: HTMLElement): QuotedPostContext | null {
  const textNode = preview.querySelector<HTMLElement>('[data-testid="tweetText"]');
  const text = cleanText(textNode?.innerText) ?? "";

  const userName = preview.querySelector<HTMLElement>('[data-testid="User-Name"]');
  const spans = Array.from(userName?.querySelectorAll<HTMLElement>("span") ?? [])
    .map((span) => cleanText(span.textContent))
    .filter((value): value is string => Boolean(value));
  const authorHandle = spans.find((value) => /^@[A-Za-z0-9_]{1,15}$/.test(value));
  const authorName = spans.find(
    (value) => value !== authorHandle && value !== "·" && !value.startsWith("@"),
  );

  const imageUrls = Array.from(
    preview.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img'),
  )
    .map((img) => img.currentSrc || img.src)
    .filter((src) => /^https:\/\//.test(src))
    .map(upgradeMediaVariant)
    .slice(0, MAX_QUOTED_IMAGES);

  if (!text && !authorHandle && !imageUrls.length) return null;

  // Canonicalizes legacy tags ("in"→"id", "iw"→"he") and drops malformed
  // values — a raw attr would make the backend's BCP 47 validation reject
  // the whole quote generation instead of degrading to no-language.
  const sourceLanguage = normalizeLanguageTag(textNode?.getAttribute("lang"));
  return {
    text,
    authorHandle,
    authorName,
    imageUrls: imageUrls.length ? imageUrls : undefined,
    sourceLanguage,
  };
}

// Lightweight target identity for the Generate -> Insert safety check. X
// locks a quote target in normal use, but composer roots can be replaced by
// React; binding drafts to text + author prevents a stale panel from writing
// commentary above a different quoted post after an unexpected replacement.
// Media is deliberately excluded: the quote target identity is still stable
// if X swaps thumbnail variants while the panel is open.
export function fingerprintQuotedPost(quoted: QuotedPostContext): string {
  return JSON.stringify([
    cleanText(quoted.text) ?? "",
    cleanText(quoted.authorHandle) ?? "",
    cleanText(quoted.authorName) ?? "",
  ]);
}
