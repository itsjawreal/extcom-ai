import type { ExtractedPostContext } from "../shared/types";

const USER_NAME_SELECTOR = '[data-testid="User-Name"]';
const POST_TEXT_SELECTOR = '[data-testid="tweetText"]';

function cleanText(value: string | null | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function extractAuthor(post: HTMLElement): Pick<
  ExtractedPostContext,
  "authorHandle" | "authorName"
> {
  const userName = post.querySelector<HTMLElement>(USER_NAME_SELECTOR);
  if (!userName) return {};

  const texts = Array.from(userName.querySelectorAll<HTMLElement>("span"))
    .map((span) => cleanText(span.textContent))
    .filter((text): text is string => Boolean(text));
  const authorHandle = texts.find((text) => /^@[A-Za-z0-9_]{1,15}$/.test(text));
  const authorName = texts.find(
    (text) => text !== authorHandle && text !== "·" && !text.startsWith("@"),
  );

  return { authorHandle, authorName };
}

const MAX_IMAGES = 4; // X's own per-post cap.

function extractImageUrls(post: HTMLElement): string[] | undefined {
  const urls = Array.from(post.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img'))
    .map((img) => img.src)
    .filter(Boolean)
    .slice(0, MAX_IMAGES);
  return urls.length ? urls : undefined;
}

function extractPostUrl(post: HTMLElement): string | undefined {
  const timestamp = post.querySelector<HTMLTimeElement>("time");
  const timestampLink = timestamp?.closest<HTMLAnchorElement>('a[href*="/status/"]');
  const fallbackLink = post.querySelector<HTMLAnchorElement>('a[href*="/status/"]');
  const href = timestampLink?.href || fallbackLink?.href;
  if (!href) return undefined;

  try {
    const url = new URL(href, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

export function extractPost(post: HTMLElement): ExtractedPostContext {
  const postText = cleanText(
    post.querySelector<HTMLElement>(POST_TEXT_SELECTOR)?.innerText,
  );
  if (!postText) {
    throw new Error("Post text is not visible or could not be extracted.");
  }

  const timestamp = post.querySelector<HTMLTimeElement>("time");
  const timestampText = cleanText(timestamp?.dateTime || timestamp?.textContent);

  return {
    postText,
    ...extractAuthor(post),
    postUrl: extractPostUrl(post),
    imageUrls: extractImageUrls(post),
    timestampText,
  };
}
