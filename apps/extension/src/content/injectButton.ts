export const PROCESSED_ATTRIBUTE = "data-ai-reply-processed";

const ACTION_GROUP_SELECTOR = '[role="group"]';

export function injectReplyButton(
  post: HTMLElement,
  onClick: (button: HTMLButtonElement, post: HTMLElement) => void,
): boolean {
  if (post.hasAttribute(PROCESSED_ATTRIBUTE)) return false;

  // X does not expose a stable post-actions selector. Prefer a group containing
  // the semantic reply button and fail closed if that structure is absent.
  const replyControl = post.querySelector<HTMLElement>('[data-testid="reply"]');
  const actionGroup = replyControl?.closest<HTMLElement>(ACTION_GROUP_SELECTOR);
  if (!actionGroup) return false;

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
  return true;
}
