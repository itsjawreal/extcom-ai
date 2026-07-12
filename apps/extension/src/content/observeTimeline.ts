import { injectReplyButton, PROCESSED_ATTRIBUTE } from "./injectButton";
import { extractPost } from "./extractPost";
import { openPanel, syncPanelPosition, syncPanelTheme } from "./panel";

const POST_SELECTOR = "article";
const DEBUG_PREFIX = "[Extcom AI]";
let scanQueued = false;
let scanCount = 0;

function isCandidatePost(post: HTMLElement): boolean {
  return Boolean(
    post.querySelector('[data-testid="reply"]') &&
    (post.querySelector('[data-testid="tweetText"]') || post.querySelector("time")),
  );
}

function scanPosts(root: ParentNode = document): void {
  const posts = Array.from(root.querySelectorAll<HTMLElement>(POST_SELECTOR));
  let candidateCount = 0;
  let injectedCount = 0;

  posts.forEach((post) => {
    if (!isCandidatePost(post)) return;
    candidateCount += 1;
    const injected = injectReplyButton(post, (button, clickedPost) => {
      try {
        openPanel(button, clickedPost, { context: extractPost(clickedPost) });
      } catch (error) {
        openPanel(button, clickedPost, {
          error:
            error instanceof Error
              ? error.message
              : "Post context could not be extracted.",
        });
      }
    });
    if (injected) injectedCount += 1;
  });

  if (injectedCount > 0) syncPanelTheme();

  scanCount += 1;
  if (scanCount <= 5 || injectedCount > 0) {
    console.debug(DEBUG_PREFIX, "scan complete", {
      scanCount,
      articles: posts.length,
      candidates: candidateCount,
      injected: injectedCount,
      path: window.location.pathname,
    });
  }
}

function queueScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  window.requestAnimationFrame(() => {
    scanQueued = false;
    scanPosts();
    syncPanelPosition();
  });
}

export function observeTimeline(): () => void {
  console.info(DEBUG_PREFIX, "content script loaded", {
    path: window.location.pathname,
    title: document.title,
  });
  scanPosts();

  const observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true });

  // X reuses article nodes during navigation. A periodic light scan recovers
  // from action bars rendered after an article was first observed.
  const recoveryTimer = window.setInterval(() => {
    document
      .querySelectorAll<HTMLElement>(`${POST_SELECTOR}[${PROCESSED_ATTRIBUTE}]`)
      .forEach((post) => {
        if (!post.querySelector(".eks-ai-reply-button")) {
          post.removeAttribute(PROCESSED_ATTRIBUTE);
        }
      });
    scanPosts();
    syncPanelPosition();
    syncPanelTheme();
  }, 3000);

  return () => {
    observer.disconnect();
    window.clearInterval(recoveryTimer);
  };
}
