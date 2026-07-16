import type { ExtractedPostContext } from "../shared/types";

const USER_NAME_SELECTOR = '[data-testid="User-Name"]';
const POST_TEXT_SELECTOR = '[data-testid="tweetText"]';
// Matches a status permalink path like /someuser/status/1234567890.
const STATUS_PAGE_PATTERN = /^\/[^/]+\/status\/\d+/;
const MAX_THREAD_CONTEXT_ITEMS = 5; // Mirrors the backend's own cap.
// Kept to 1 on purpose: this is a proximity guess, not a verified parent
// link (X's DOM has no actual parent-tweet-id we can read). Live testing
// with 2 confirmed the risk is real, not theoretical — on an ordinary
// timeline, the 2nd-nearest article is frequently just an unrelated feed
// item (not a real ancestor), and it visibly hijacked reply generation
// (all 3 drafts followed the unrelated noise item, ignoring the actual
// parent that was also captured alongside it).
const MAX_NEAREST_ANCESTORS = 1;
const ORIGINAL_RESTORE_TIMEOUT_MS = 2_500;

// X localizes this control to the account UI language. Keep matching exact
// accessible labels so we don't accidentally click an unrelated control
// containing a loose word such as "original". English covers the reported
// case; the remaining values cover X's currently supported UI locales.
const SHOW_ORIGINAL_LABELS = new Set([
  "show original",
  "mostrar original",
  "afficher l’original",
  "afficher l'original",
  "voir l’original",
  "voir l'original",
  "original anzeigen",
  "mostra originale",
  "mostrar o original",
  "показать оригинал",
  "原文を表示",
  "显示原文",
  "顯示原文",
  "원문 보기",
  "عرض النص الأصلي",
  "origineel weergeven",
  "pokaż oryginał",
  "orijinali göster",
  "tampilkan yang asli",
  "tampilkan versi asli",
]);

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

// X renders native video and GIFs inside a [data-testid="videoPlayer"]
// wrapper — a completely different element from [data-testid="tweetPhoto"]
// img used for static images, so extractImageUrls() never matches it. Not
// live-verified against x.com's current markup (same caveat as the rest of
// this file's selectors) — if this stops matching, the effect is just the
// less-accurate generic error message below, not a crash.
function hasVideo(post: HTMLElement): boolean {
  return post.querySelector('[data-testid="videoPlayer"]') !== null;
}

function extractArticleText(article: HTMLElement): string | undefined {
  return cleanText(article.querySelector<HTMLElement>(POST_TEXT_SELECTOR)?.innerText);
}

// X's timeline is a virtualized list: elements are positioned with CSS
// transforms (translateY), not necessarily inserted into the DOM in visual
// order. That rules out any DOM-tree heuristic (sibling order, shared
// containers) for finding "what tweet is this replying to" — the only
// reliable signal is each article's actual rendered position on screen.
// This is still just a proximity guess, not a verified parent link (X's DOM
// has no parent-tweet-id we can read), so it can misattribute a sibling
// reply as an ancestor on a branching thread — kept deliberately shallow
// (MAX_NEAREST_ANCESTORS) to limit how much that risk compounds.
//
// Runs on every page, not just status permalinks: X sometimes injects a
// "reply shown with its parent" unit directly into the Home/For You
// timeline (e.g. a reply from someone you follow, shown under the original
// post) without navigating to a /status/ URL at all.
//
// Accepted trade-off (deliberate, not a bug to fix): on an ordinary
// standalone post — including a top-level post that isn't a reply to
// anything at all — the nearest article above is sometimes just an
// unrelated feed item, not a real parent. There is no cheap, reliable DOM
// signal to tell "reply with its parent shown above" apart from "unrelated
// post that happens to be above" (X only shows a "Replying to @x" caption
// when the parent ISN'T shown alongside it, which is the opposite of the
// case we need to detect). Live-tested impact: capped at 1 item, this
// occasionally attaches one irrelevant sentence of context rather than
// none — in practice the model still weighs the actual post text more
// heavily and the effect on reply quality has been minor to unnoticeable.
function extractThreadContext(post: HTMLElement): string[] | undefined {
  const seen = new Set<HTMLElement>([post]);

  const ancestors: string[] = [];
  const postTop = post.getBoundingClientRect().top;
  const above = Array.from(document.querySelectorAll<HTMLElement>("article"))
    .filter((el) => el !== post)
    .map((el) => ({ el, top: el.getBoundingClientRect().top }))
    .filter((candidate) => candidate.top < postTop)
    .sort((a, b) => b.top - a.top); // nearest above first

  for (const candidate of above.slice(0, MAX_NEAREST_ANCESTORS)) {
    seen.add(candidate.el);
    const text = extractArticleText(candidate.el);
    // Chronological order (oldest first) so the numbered prompt list reads
    // top-to-bottom like an actual conversation transcript.
    if (text) ancestors.unshift(text);
  }

  // Also grab the page's topmost tweet as a root-context fallback — helps
  // when the direct parent scrolled out of the DOM (virtualized away) or
  // wasn't captured above. Restricted to status permalinks: that's the only
  // case where "topmost article on the page" reliably means "the
  // conversation's root tweet" rather than just whatever's scrolled to the
  // top of an ordinary feed.
  const isStatusPage = STATUS_PAGE_PATTERN.test(window.location.pathname);
  const topArticle = isStatusPage ? document.querySelector<HTMLElement>("article") : null;
  const rootText = topArticle && !seen.has(topArticle) ? extractArticleText(topArticle) : undefined;

  const context = rootText ? [rootText, ...ancestors] : ancestors;
  return context.length ? context.slice(0, MAX_THREAD_CONTEXT_ITEMS) : undefined;
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

// Exported for composerQuote.ts: the quoted-preview lang attr needs the same
// legacy-tag canonicalization and malformed-value tolerance as post text.
export function normalizeLanguageTag(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || candidate.toLowerCase() === "und") return undefined;
  try {
    // X still emits a few legacy identifiers (notably "in" and "iw").
    // Canonicalization turns them into modern BCP 47 tags ("id" / "he")
    // and safely drops malformed DOM values instead of breaking generation.
    return Intl.getCanonicalLocales(candidate)[0];
  } catch {
    return undefined;
  }
}

function findShowOriginalControl(post: HTMLElement): HTMLElement | null {
  const controls = post.querySelectorAll<HTMLElement>('button, [role="button"], a');
  for (const control of controls) {
    // Avoid a translation control belonging to a nested/quoted article.
    if (control.closest("article") !== post) continue;
    const label = cleanText(control.getAttribute("aria-label") || control.textContent)?.toLocaleLowerCase();
    if (label && SHOW_ORIGINAL_LABELS.has(label)) return control;
  }
  return null;
}

function waitForOriginalText(post: HTMLElement, previousText: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const hasChanged = (): boolean => {
      const current = cleanText(post.querySelector<HTMLElement>(POST_TEXT_SELECTOR)?.innerText);
      return Boolean(current && current !== previousText);
    };
    const observer = new MutationObserver(() => {
      if (hasChanged()) finish();
    });
    observer.observe(post, { childList: true, subtree: true, characterData: true, attributes: true });
    const timeout = window.setTimeout(() => {
      if (hasChanged()) finish();
      else finish(new Error("X did not restore the original post text. Try clicking Show original, then retry."));
    }, ORIGINAL_RESTORE_TIMEOUT_MS);
  });
}

export async function extractPostForReply(post: HTMLElement): Promise<ExtractedPostContext> {
  const showOriginal = findShowOriginalControl(post);
  if (!showOriginal) return extractPost(post);

  const translatedText = cleanText(post.querySelector<HTMLElement>(POST_TEXT_SELECTOR)?.innerText);
  const restored = waitForOriginalText(post, translatedText);
  showOriginal.click();
  await restored;
  return extractPost(post);
}

export function extractPost(post: HTMLElement): ExtractedPostContext {
  const postTextNode = post.querySelector<HTMLElement>(POST_TEXT_SELECTOR);
  const postText = cleanText(postTextNode?.innerText);
  const sourceLanguage = normalizeLanguageTag(
    postTextNode?.getAttribute("lang")
      ?? postTextNode?.querySelector<HTMLElement>("[lang]")?.getAttribute("lang"),
  );
  const imageUrls = extractImageUrls(post);

  // A post can be image-only (screenshot, chart, meme with no caption) —
  // only bail out if there's truly nothing to reply from.
  if (!postText && !imageUrls) {
    // Distinguishes "this post has a video, which we don't read yet" from
    // the generic case below — the old message ("Post text is not visible")
    // was actively misleading here, since the real issue isn't that text
    // failed to extract, it's that video content isn't supported at all.
    if (hasVideo(post)) {
      throw new Error("This post only has a video — video content isn't supported yet. Try a post with text or images.");
    }
    throw new Error("Post text is not visible or could not be extracted.");
  }

  const timestamp = post.querySelector<HTMLTimeElement>("time");
  const timestampText = cleanText(timestamp?.dateTime || timestamp?.textContent);

  return {
    postText: postText ?? "",
    sourceLanguage,
    ...extractAuthor(post),
    postUrl: extractPostUrl(post),
    imageUrls,
    timestampText,
    visibleThreadText: extractThreadContext(post),
  };
}
