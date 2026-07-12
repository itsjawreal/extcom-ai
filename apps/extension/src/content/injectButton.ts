export const PROCESSED_ATTRIBUTE = "data-ai-reply-processed";

const ACTION_GROUP_SELECTOR = '[role="group"]';
const ACTION_ITEM_SELECTOR = '[data-testid="reply"], [data-testid="retweet"], [data-testid="like"]';
const DEBUG_PREFIX = "[Extcom AI]";

type InsertionTarget =
  | { mode: "append"; element: HTMLElement }
  | { mode: "after"; element: HTMLElement };

function resolveInsertionTarget(post: HTMLElement): InsertionTarget | null {
  const replyControl = post.querySelector<HTMLElement>('[data-testid="reply"]');
  const semanticGroup = replyControl?.closest<HTMLElement>(ACTION_GROUP_SELECTOR);
  if (semanticGroup) return { mode: "append", element: semanticGroup };

  const actionItem = post.querySelector<HTMLElement>(ACTION_ITEM_SELECTOR);
  const fallbackGroup = actionItem?.parentElement;
  if (fallbackGroup instanceof HTMLElement) return { mode: "append", element: fallbackGroup };

  const replyButtonShell = replyControl?.closest<HTMLElement>('button, [role="button"]');
  if (replyButtonShell?.parentElement instanceof HTMLElement) {
    return { mode: "after", element: replyButtonShell.parentElement };
  }

  if (replyControl?.parentElement instanceof HTMLElement) {
    return { mode: "after", element: replyControl.parentElement };
  }

  return null;
}

export function injectReplyButton(
  post: HTMLElement,
  onClick: (button: HTMLButtonElement, post: HTMLElement) => void | Promise<void>,
): boolean {
  if (post.hasAttribute(PROCESSED_ATTRIBUTE)) return false;

  // X changes post action wrappers often. Prefer the semantic action group but
  // fall back to the reply/retweet/like row or directly after the reply control.
  const insertionTarget = resolveInsertionTarget(post);
  if (!insertionTarget) {
    console.debug(DEBUG_PREFIX, "skip post without insertion target", post);
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

  if (insertionTarget.mode === "append") {
    insertionTarget.element.append(button);
  } else {
    insertionTarget.element.insertAdjacentElement("afterend", button);
  }
  post.setAttribute(PROCESSED_ATTRIBUTE, "true");
  console.debug(DEBUG_PREFIX, "button injected", {
    mode: insertionTarget.mode,
    postText: post.querySelector('[data-testid="tweetText"]')?.textContent?.slice(0, 80) || null,
  });
  return true;
}
