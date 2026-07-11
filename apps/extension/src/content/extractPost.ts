import type { ExtractedPostContext } from "../shared/types";

const USER_NAME_SELECTOR = '[data-testid="User-Name"]';
const POST_TEXT_SELECTOR = '[data-testid="tweetText"]';
const CELL_SELECTOR = '[data-testid="cellInnerDiv"]';
// Matches a status permalink path like /someuser/status/1234567890.
const STATUS_PAGE_PATTERN = /^\/[^/]+\/status\/\d+/;
const MAX_THREAD_CONTEXT_ITEMS = 5; // Mirrors the backend's own cap.

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

function extractArticleText(article: HTMLElement): string | undefined {
  return cleanText(article.querySelector<HTMLElement>(POST_TEXT_SELECTOR)?.innerText);
}

// X groups a reply-to-reply (not reply-to-root) together with the tweet(s)
// it's replying to inside one shared cellInnerDiv — the connected-looking
// chain in the UI. A standalone top-level reply gets its own cellInnerDiv
// with just one <article>. So multiple <article> siblings in the same cell,
// in DOM order, is a real (if occasionally incomplete) ancestor chain —
// this only fires for genuinely nested replies, not unrelated timeline posts.
function extractThreadContext(post: HTMLElement): string[] | undefined {
  const ancestors: string[] = [];
  const seen = new Set<HTMLElement>([post]);

  const cell = post.closest<HTMLElement>(CELL_SELECTOR);
  if (cell) {
    const siblings = Array.from(cell.querySelectorAll<HTMLElement>("article"));
    const index = siblings.indexOf(post);
    if (index > 0) {
      for (const ancestor of siblings.slice(0, index)) {
        seen.add(ancestor);
        const text = extractArticleText(ancestor);
        if (text) ancestors.push(text);
      }
    }
  }

  // On a permalink page, also grab the page's topmost tweet as a root-context
  // fallback — helps branchy threads where the direct parent isn't grouped
  // into the same cellInnerDiv as this reply. Skipped on the general
  // timeline, where the topmost article is just an unrelated post.
  let rootText: string | undefined;
  if (STATUS_PAGE_PATTERN.test(window.location.pathname)) {
    const topArticle = document.querySelector<HTMLElement>("article");
    if (topArticle && !seen.has(topArticle)) {
      rootText = extractArticleText(topArticle);
    }
  }

  // The ancestors immediately preceding the clicked reply are the strongest
  // signal, so they win the cap over the (weaker-signal) root fallback.
  const closestAncestors = ancestors.slice(-MAX_THREAD_CONTEXT_ITEMS);
  const context =
    rootText && closestAncestors.length < MAX_THREAD_CONTEXT_ITEMS
      ? [rootText, ...closestAncestors]
      : closestAncestors;

  return context.length ? context : undefined;
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
  const imageUrls = extractImageUrls(post);

  // A post can be image-only (screenshot, chart, meme with no caption) —
  // only bail out if there's truly nothing to reply from.
  if (!postText && !imageUrls) {
    throw new Error("Post text is not visible or could not be extracted.");
  }

  const timestamp = post.querySelector<HTMLTimeElement>("time");
  const timestampText = cleanText(timestamp?.dateTime || timestamp?.textContent);

  return {
    postText: postText ?? "",
    ...extractAuthor(post),
    postUrl: extractPostUrl(post),
    imageUrls,
    timestampText,
    visibleThreadText: extractThreadContext(post),
  };
}
