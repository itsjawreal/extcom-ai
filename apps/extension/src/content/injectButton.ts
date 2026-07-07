export const PROCESSED_ATTRIBUTE = "data-ai-reply-processed";

const ACTION_GROUP_SELECTOR = '[role="group"]';
const ACTION_ITEM_SELECTOR = '[data-testid="reply"], [data-testid="retweet"], [data-testid="like"]';
const DEBUG_PREFIX = "[Ekskomen AI]";

function resolveActionGroup(post: HTMLElement): HTMLElement | null {
  const replyControl = post.querySelector<HTMLElement>('[data-testid="reply"]');
  const semanticGroup = replyControl?.closest<HTMLElement>(ACTION_GROUP_SELECTOR);
  if (semanticGroup) return semanticGroup;

  const actionItem = post.querySelector<HTMLElement>(ACTION_ITEM_SELECTOR);
  const fallbackGroup = actionItem?.parentElement;
  if (fallbackGroup instanceof HTMLElement) return fallbackGroup;
  return null;
}

export function injectReplyButton(
  post: HTMLElement,
  onClick: (button: HTMLButtonElement, post: HTMLElement) => void,
): boolean {
  if (post.hasAttribute(PROCESSED_ATTRIBUTE)) return false;

  // X changes post action wrappers often. Prefer the semantic action group but
  // fall back to the reply/retweet/like row when group roles disappear.
  const actionGroup = resolveActionGroup(post);
  if (!actionGroup) {
    console.debug(DEBUG_PREFIX, "skip post without action group", post);
    return false;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "eks-ai-reply-button";
  button.setAttribute("aria-label", "Generate AI reply drafts");
  button.textContent = "✦ AI Reply";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(button, post);
  });

  actionGroup.append(button);
  post.setAttribute(PROCESSED_ATTRIBUTE, "true");
  console.debug(DEBUG_PREFIX, "button injected", {
    postText: post.querySelector('[data-testid="tweetText"]')?.textContent?.slice(0, 80) || null,
  });
  return true;
}
