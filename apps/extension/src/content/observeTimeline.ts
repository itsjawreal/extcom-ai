import { injectReplyButton, PROCESSED_ATTRIBUTE } from "./injectButton";
import { extractPost } from "./extractPost";
import { openPanel, syncPanelPosition } from "./panel";

const POST_SELECTOR = 'article[data-testid="tweet"]';
let scanQueued = false;

function scanPosts(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(POST_SELECTOR).forEach((post) => {
    injectReplyButton(post, (button, clickedPost) => {
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
  });
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
  }, 3000);

  return () => {
    observer.disconnect();
    window.clearInterval(recoveryTimer);
  };
}
