export const POST_COMPOSER_PROCESSED_ATTRIBUTE = "data-eks-ai-post-processed";
export const POST_COMPOSER_SESSION_ATTRIBUTE = "data-eks-ai-post-session";

const EDITABLE_SELECTOR = [
  '[data-testid^="tweetTextarea_"]',
  '[role="textbox"][contenteditable="true"]',
].join(", ");
const INLINE_PUBLISH_SELECTOR = '[data-testid="tweetButtonInline"]';
const MODAL_PUBLISH_SELECTOR = '[data-testid="tweetButton"]';
const POST_BUTTON_CLASS = "eks-ai-post-button";
const REPLY_LABEL = /\b(?:reply|balas|répondre|antworten|responder|rispondi|responder)\b/iu;

export type StandaloneComposer = {
  root: HTMLElement;
  editable: HTMLElement;
};

type ComposerKind = "inline" | "modal";

function composerKind(root: HTMLElement): ComposerKind {
  return root.matches('[role="dialog"]') ? "modal" : "inline";
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function looksLikeReplyComposer(editable: HTMLElement): boolean {
  const label = [
    editable.getAttribute("aria-label"),
    editable.getAttribute("data-placeholder"),
    editable.getAttribute("aria-placeholder"),
  ].filter(Boolean).join(" ");
  return REPLY_LABEL.test(label);
}

function closestRootWithPublishButton(editable: HTMLElement, selector: string): HTMLElement | null {
  let candidate = editable.parentElement;
  for (let depth = 0; candidate && depth < 14; depth += 1, candidate = candidate.parentElement) {
    if (candidate.querySelector(selector)) return candidate;
  }
  return null;
}

function resolveComposer(editable: HTMLElement): StandaloneComposer | null {
  if (!isVisible(editable) || looksLikeReplyComposer(editable)) return null;

  const dialog = editable.closest<HTMLElement>('[role="dialog"]');
  if (dialog) {
    if (!/^\/compose\/post\/?$/.test(window.location.pathname)) return null;
    // A quote composer uses the same route, but mounts the quoted post inside
    // the dialog. It belongs to the existing Quote flow, not Create Post.
    if (dialog.querySelector('[data-testid="tweet"]')) return null;
    if (!dialog.querySelector(MODAL_PUBLISH_SELECTOR)) return null;
    return { root: dialog, editable };
  }

  // X only exposes its always-visible standalone inline composer on Home.
  // Restricting by route prevents the conversation-page reply box from being
  // mistaken for a post composer when labels are localized or absent.
  if (window.location.pathname !== "/home") return null;
  if (editable.closest("article")) return null;
  const root = closestRootWithPublishButton(editable, INLINE_PUBLISH_SELECTOR);
  return root ? { root, editable } : null;
}

export function findStandaloneComposers(): StandaloneComposer[] {
  const byRoot = new Map<HTMLElement, StandaloneComposer>();
  document.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR).forEach((editable) => {
    const composer = resolveComposer(editable);
    if (composer && !byRoot.has(composer.root)) byRoot.set(composer.root, composer);
  });
  return [...byRoot.values()];
}

function injectPostButton(
  composer: StandaloneComposer,
  onClick: (button: HTMLButtonElement, composer: StandaloneComposer) => void | Promise<void>,
): boolean {
  const { root } = composer;
  if (root.querySelector(`.${POST_BUTTON_CLASS}`)) {
    root.setAttribute(POST_COMPOSER_PROCESSED_ATTRIBUTE, "true");
    return false;
  }

  const publish = root.querySelector<HTMLElement>(
    root.matches('[role="dialog"]') ? MODAL_PUBLISH_SELECTOR : INLINE_PUBLISH_SELECTOR,
  );
  const publishShell = publish?.closest<HTMLElement>('button, [role="button"]') ?? publish;
  if (!publishShell?.parentElement) return false;

  // X nests the real publish control inside several wrappers. Inserting next
  // to the innermost role=button can stack AI Post above it (a block/column
  // wrapper). Climb only until its parent is the nearest horizontal action
  // row, then insert there as a proper sibling.
  let candidateTarget = publishShell;
  let insertionTarget = publishShell;
  for (let depth = 0; depth < 6; depth += 1) {
    const parent = candidateTarget.parentElement;
    if (!parent || !root.contains(parent)) break;
    const style = window.getComputedStyle(parent);
    if (
      (style.display === "flex" || style.display === "inline-flex") &&
      style.flexDirection !== "column" &&
      style.flexDirection !== "column-reverse"
    ) {
      insertionTarget = candidateTarget;
      break;
    }
    candidateTarget = parent;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = POST_BUTTON_CLASS;
  button.setAttribute("aria-label", "Generate AI post drafts");
  button.textContent = "✦ AI Post";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onClick(button, {
      root,
      editable: root.querySelector<HTMLElement>(EDITABLE_SELECTOR) ?? composer.editable,
    });
  });

  insertionTarget.insertAdjacentElement("beforebegin", button);
  root.setAttribute(POST_COMPOSER_PROCESSED_ATTRIBUTE, "true");
  return true;
}

export function observePostComposers(
  onClick: (button: HTMLButtonElement, composer: StandaloneComposer) => void | Promise<void>,
): () => void {
  let queued = false;
  let nextSessionId = 1;
  const sessions = new Map<ComposerKind, { id: string; root: HTMLElement }>();

  const scan = () => {
    const composers = findStandaloneComposers();
    const liveRoots = new Set(composers.map(({ root }) => root));

    // Preserve identity across a React node replacement only while the old
    // composer never disappeared for a completed scan. Once a scan sees no
    // composer, a later one is a new user session and must not receive drafts
    // generated for the closed composer.
    for (const kind of ["inline", "modal"] as const) {
      const candidates = composers.filter(({ root }) => composerKind(root) === kind);
      const previous = sessions.get(kind);
      if (candidates.length === 0) {
        previous?.root.removeAttribute(POST_COMPOSER_SESSION_ATTRIBUTE);
        sessions.delete(kind);
        continue;
      }
      const composer = candidates[0];
      if (!composer) continue;
      const id = previous && (previous.root === composer.root || !previous.root.isConnected)
        ? previous.id
        : `${kind}-${nextSessionId++}`;
      composer.root.setAttribute(POST_COMPOSER_SESSION_ATTRIBUTE, id);
      sessions.set(kind, { id, root: composer.root });
    }

    document.querySelectorAll<HTMLButtonElement>(`.${POST_BUTTON_CLASS}`).forEach((button) => {
      const root = button.closest<HTMLElement>(`[${POST_COMPOSER_PROCESSED_ATTRIBUTE}]`);
      if (!root || !liveRoots.has(root)) {
        button.remove();
        root?.removeAttribute(POST_COMPOSER_PROCESSED_ATTRIBUTE);
      }
    });

    composers.forEach((composer) => {
      if (!composer.root.querySelector(`.${POST_BUTTON_CLASS}`)) {
        composer.root.removeAttribute(POST_COMPOSER_PROCESSED_ATTRIBUTE);
      }
      injectPostButton(composer, onClick);
    });
  };

  const queueScan = () => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  };

  scan();
  const observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true });
  const recoveryTimer = window.setInterval(scan, 3000);

  return () => {
    observer.disconnect();
    window.clearInterval(recoveryTimer);
    document.querySelectorAll(`.${POST_BUTTON_CLASS}`).forEach((button) => button.remove());
    sessions.clear();
  };
}
