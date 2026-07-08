import { insertViaPageBridge } from "./pageBridge";

const REPLY_CONTROL_SELECTOR = '[data-testid="reply"]';
const COMPOSER_SELECTOR = [
  '[data-testid="tweetTextarea_0"]',
  '[data-testid="tweetTextarea_1"]',
  '[data-testid="tweetTextarea_2"]',
  '[data-testid^="tweetTextarea_"]',
  '[aria-label="Post your reply"]',
  '[aria-label="Reply text"]',
  '[role="textbox"][contenteditable="true"]',
].join(", ");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function getVisibleComposers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR))
    .filter((composer) => isVisible(composer));
}

function isConversationPage(): boolean {
  return /\/status\/\d+/.test(window.location.pathname);
}

function findFocusedComposerCandidate(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return active.closest<HTMLElement>(COMPOSER_SELECTOR);
}

function findComposer(excluded: Set<HTMLElement> = new Set()): HTMLElement | null {
  const composers = getVisibleComposers()
    .filter((composer) => !excluded.has(composer));

  const dialogComposer = composers.find((composer) => composer.closest('[role="dialog"]'));
  if (dialogComposer) return dialogComposer;

  const focusedCandidate = findFocusedComposerCandidate();
  if (focusedCandidate && !excluded.has(focusedCandidate) && isVisible(focusedCandidate)) {
    return focusedCandidate;
  }

  const focusedComposer = composers.find((composer) => composer.contains(document.activeElement));
  if (focusedComposer) return focusedComposer;

  return composers.at(-1) || null;
}

function findExistingInlineComposer(post: HTMLElement): HTMLElement | null {
  if (!isConversationPage()) return null;

  const composers = getVisibleComposers()
    .filter((composer) => !composer.closest('[role="dialog"]'));
  if (composers.length === 0) return null;
  if (composers.length === 1) return composers[0] || null;

  const postRect = post.getBoundingClientRect();
  const postMidpoint = postRect.top + (postRect.height / 2);
  const sorted = composers
    .map((composer) => {
      const rect = composer.getBoundingClientRect();
      const isAbovePost = rect.bottom < postMidpoint;
      const startsFarBelowPost = rect.top > postRect.bottom + 260;
      const verticalDistance = rect.top >= postRect.bottom
        ? rect.top - postRect.bottom
        : Math.abs(rect.top - postRect.top);

      return {
        composer,
        isAbovePost,
        startsFarBelowPost,
        verticalDistance,
      };
    })
    .filter((entry) => !entry.isAbovePost && !entry.startsFarBelowPost)
    .sort((left, right) => left.verticalDistance - right.verticalDistance);

  if (sorted[0]?.composer) return sorted[0].composer;
  return null;
}

function resolveEditableTarget(composer: HTMLElement): HTMLElement {
  if (composer.matches('[contenteditable="true"]')) return composer;

  const focused = document.activeElement;
  if (focused instanceof HTMLElement && composer.contains(focused)) {
    const focusedEditable = focused.closest<HTMLElement>('[contenteditable="true"], [role="textbox"]');
    if (focusedEditable && composer.contains(focusedEditable)) return focusedEditable;
  }

  return composer.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"]') || composer;
}

function setSelection(editable: HTMLElement, mode: "all" | "end"): boolean {
  if (!editable.isConnected) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  try {
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(mode === "end");
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function dispatchComposerInput(composer: HTMLElement, text: string): void {
  composer.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text,
  }));
  composer.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: text,
  }));
}

function primeComposer(editable: HTMLElement): void {
  editable.focus();
  editable.click();
}

function getComposerText(editable: HTMLElement): string {
  return editable.textContent?.replace(/\u00a0/g, " ").trim() || "";
}

function composerContainsText(editable: HTMLElement, text: string): boolean {
  const actual = getComposerText(editable);
  const expected = text.replace(/\u00a0/g, " ").trim();
  return actual === expected || actual.includes(expected);
}

async function tryPasteIntoComposer(editable: HTMLElement, text: string): Promise<boolean> {
  if (typeof DataTransfer === "undefined" || typeof ClipboardEvent === "undefined") {
    return false;
  }

  try {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    const notCanceled = editable.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }));
    if (composerContainsText(editable, text)) return true;

    // Controlled editors normally cancel paste while applying it themselves.
    // Give that handler one frame to update state before trying another method;
    // otherwise the same reply can be inserted twice.
    if (!notCanceled) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    return composerContainsText(editable, text);
  } catch {
    return false;
  }
}

async function insertTextIntoComposer(composer: HTMLElement, text: string): Promise<boolean> {
  if (!composer.isConnected) return false;

  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    composer.focus();
    composer.value = text;
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const editable = resolveEditableTarget(composer);
  primeComposer(editable);

  const currentText = getComposerText(editable);
  setSelection(editable, currentText ? "all" : "end");

  if (await tryPasteIntoComposer(editable, text)) {
    editable.focus();
    return true;
  }

  let inserted = false;
  try {
    if (currentText) {
      document.execCommand("delete");
      setSelection(editable, "end");
    }
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    return insertViaPageBridge(editable, text);
  }

  dispatchComposerInput(editable, text);
  if (getComposerText(editable).length > 0) return true;

  // execCommand reported success but the editor state stayed empty (X's editor
  // can swallow isolated-world edits). Retry from the page context.
  return insertViaPageBridge(editable, text);
}

export async function insertReplyIntoComposer(post: HTMLElement, text: string): Promise<void> {
  let composer = findExistingInlineComposer(post);

  if (!composer) {
    const replyButton = post.querySelector<HTMLElement>(REPLY_CONTROL_SELECTOR);
    if (!replyButton) throw new Error("Reply composer button is not available on this post.");

    const existingComposers = new Set(getVisibleComposers());
    replyButton.click();

    composer = null;
    for (let attempt = 0; !composer && attempt < 16; attempt += 1) {
      await wait(150);
      composer = findComposer(existingComposers) || findComposer();
    }
  }

  if (!composer) throw new Error("Reply composer did not open.");
  await wait(200);

  let inserted = await insertTextIntoComposer(composer, text);
  if (!inserted) {
    await wait(250);
    const retryComposer = findComposer() || composer;
    inserted = await insertTextIntoComposer(retryComposer, text);
    composer = retryComposer;
  }

  if (!inserted) {
    throw new Error("Reply composer could not be filled.");
  }
  await wait(50);
  resolveEditableTarget(composer).focus();
}
