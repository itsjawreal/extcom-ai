import { insertViaPageBridge } from "./pageBridge";

const REPLY_CONTROL_SELECTOR = '[data-testid="reply"]';
// X flips the action test id after a post has already been reposted. Both
// states open the same menu; Quote remains available beside Repost/Undo.
const RETWEET_CONTROL_SELECTOR = '[data-testid="retweet"], [data-testid="unretweet"]';
const QUOTE_MENU_ITEM_TEXT = /\b(?:quote|kutip)\b/iu;
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

function findExistingDialogComposer(): HTMLElement | null {
  const composers = getVisibleComposers().filter((composer) => composer.closest('[role="dialog"]'));
  return composers.at(-1) || null;
}

// X doesn't expose a stable testid for the "Quote" menu item, so this leans
// on the label text first (works for the English UI we've verified against)
// and falls back to position — the repost menu is Repost then Quote, in
// that order — for other locales or markup changes.
function findQuoteMenuItem(): HTMLElement | null {
  const scoped = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="Dropdown"] [role="menuitem"]'))
    .filter((item) => isVisible(item));
  const candidates = scoped.length > 0
    ? scoped
    : Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((item) => isVisible(item));

  const byText = candidates.find((item) => QUOTE_MENU_ITEM_TEXT.test(item.textContent || ""));
  if (byText) return byText;

  return candidates.length >= 2 ? candidates[1] || null : null;
}

export function resolveEditableTarget(composer: HTMLElement): HTMLElement {
  if (composer.matches('[contenteditable="true"]')) return composer;

  const focused = document.activeElement;
  if (focused instanceof HTMLElement && composer.contains(focused)) {
    const focusedEditable = focused.closest<HTMLElement>('[contenteditable="true"], [role="textbox"]');
    if (focusedEditable && composer.contains(focusedEditable)) return focusedEditable;
  }

  const editable = composer.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"]');
  if (!editable) {
    throw new Error("Editable target not found in composer");
  }
  return editable;
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

function primeComposer(editable: HTMLElement): void {
  editable.focus();
  editable.click();
}

function waitForEditorFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

export function getComposerText(editable: HTMLElement): string {
  if (editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement) {
    return editable.value.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
  }

  // X visually paints "What's happening?" inside an empty contenteditable.
  // In Chromium that placeholder can leak into innerText even though there is
  // no authored text node. textContent is therefore the emptiness gate;
  // innerText is only used after real content exists, to preserve <br>/block
  // line breaks in multiline drafts.
  const authoredText = editable.textContent?.replace(/\u00a0/g, " ").trim() || "";
  if (!authoredText) return "";
  const text = editable.innerText || authoredText;
  return text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
}

function normalizeComposerTextForComparison(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function composerContainsText(editable: HTMLElement, text: string): boolean {
  const actual = normalizeComposerTextForComparison(getComposerText(editable));
  const expected = normalizeComposerTextForComparison(text);
  return actual === expected || actual.includes(expected);
}

function composerMatchesText(editable: HTMLElement, text: string): boolean {
  // X/Draft.js renders newlines as block elements. innerText may add an extra
  // newline at block boundaries while the controlled EditorState is correct.
  // Normalize render-only whitespace but keep all authored tokens strict.
  return normalizeComposerTextForComparison(getComposerText(editable)) ===
    normalizeComposerTextForComparison(text);
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
    if (composerMatchesText(editable, text)) return true;

    // Controlled editors normally cancel paste while applying it themselves.
    // Give that handler one frame to update state before trying another method;
    // otherwise the same reply can be inserted twice.
    if (!notCanceled) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    return composerMatchesText(editable, text);
  } catch {
    return false;
  }
}

export async function insertTextIntoComposer(composer: HTMLElement, text: string): Promise<boolean> {
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

  // Replacement is handled once in X's own page context. Trying an
  // isolated-world edit first and then falling back can append the same text
  // twice when X ignores the Range selection but still mutates its state.
  if (currentText) {
    const bridged = await insertViaPageBridge(editable, text);
    if (!bridged) return false;
    await waitForEditorFrame();
    return composerMatchesText(editable, text);
  }

  // Synthetic paste is safe only for a genuinely empty composer.
  setSelection(editable, "end");
  if (await tryPasteIntoComposer(editable, text)) {
    editable.focus();
    return true;
  }
  // A canceled/failed paste may still have mutated a controlled editor. Never
  // follow a partial write with another insertion attempt.
  if (getComposerText(editable)) return false;

  // Keep the fallback state-driven too. Native insertText mutates Draft's DOM
  // outside React and can leave stale nodes or lose all but the final line.
  const bridged = await insertViaPageBridge(editable, text);
  if (!bridged) return false;
  await waitForEditorFrame();
  return composerMatchesText(editable, text);
}

export async function insertReplyIntoComposer(post: HTMLElement, text: string): Promise<void> {
  let composer = findExistingInlineComposer(post);
  let openedFreshModal = false;

  if (!composer) {
    const replyButton = post.querySelector<HTMLElement>(REPLY_CONTROL_SELECTOR);
    if (!replyButton) throw new Error("Reply composer button is not available on this post.");

    const existingComposers = new Set(getVisibleComposers());
    replyButton.click();
    openedFreshModal = true;

    composer = null;
    for (let attempt = 0; !composer && attempt < 16; attempt += 1) {
      await wait(150);
      composer = findComposer(existingComposers) || findComposer();
    }
  }

  if (!composer) throw new Error("Reply composer did not open.");

  // A modal that just opened keeps swapping its composer node for a bit
  // (entry animation, media/GIF toolbar mounting) before it settles. Writing
  // into it too early lands on a node X is about to discard, which still
  // reads back as "filled" from the detached reference even though the
  // modal on screen stays empty. Give it longer and re-fetch right before
  // the first write.
  await wait(openedFreshModal ? 400 : 200);
  composer = findComposer() || composer;

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

  // Verify against whatever composer is actually live right now, not the
  // (possibly stale/detached) reference we just wrote into.
  await wait(50);
  const finalComposer = findComposer() || composer;
  const finalEditable = resolveEditableTarget(finalComposer);
  if (!composerContainsText(finalEditable, text)) {
    const reinserted = await insertTextIntoComposer(finalComposer, text);
    if (!reinserted) throw new Error("Reply composer could not be filled.");
    resolveEditableTarget(finalComposer).focus();
    return;
  }

  finalEditable.focus();
}

export async function insertQuoteIntoComposer(post: HTMLElement, text: string): Promise<void> {
  // A Quote modal already open (e.g. the user opened it manually) reuses
  // that dialog instead of opening a second one on top of it.
  let composer = findExistingDialogComposer();
  let openedFreshModal = false;

  if (!composer) {
    const retweetButton = post.querySelector<HTMLElement>(RETWEET_CONTROL_SELECTOR);
    if (!retweetButton) throw new Error("Quote button is not available on this post.");

    retweetButton.click();

    let quoteMenuItem: HTMLElement | null = null;
    for (let attempt = 0; !quoteMenuItem && attempt < 10; attempt += 1) {
      await wait(100);
      quoteMenuItem = findQuoteMenuItem();
    }
    if (!quoteMenuItem) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      throw new Error("Quote option did not appear.");
    }
    quoteMenuItem.click();
    openedFreshModal = true;

    composer = null;
    for (let attempt = 0; !composer && attempt < 16; attempt += 1) {
      await wait(150);
      composer = findExistingDialogComposer();
    }
  }

  if (!composer) throw new Error("Quote composer did not open.");

  // Same settling delay as the reply modal — entry animation and the quoted
  // post card mounting can swap the composer node right after it opens.
  await wait(openedFreshModal ? 400 : 200);
  composer = findExistingDialogComposer() || composer;

  let inserted = await insertTextIntoComposer(composer, text);
  if (!inserted) {
    await wait(250);
    const retryComposer = findExistingDialogComposer() || composer;
    inserted = await insertTextIntoComposer(retryComposer, text);
    composer = retryComposer;
  }

  if (!inserted) {
    throw new Error("Quote composer could not be filled.");
  }

  await wait(50);
  const finalComposer = findExistingDialogComposer() || composer;
  const finalEditable = resolveEditableTarget(finalComposer);
  if (!composerContainsText(finalEditable, text)) {
    const reinserted = await insertTextIntoComposer(finalComposer, text);
    if (!reinserted) throw new Error("Quote composer could not be filled.");
    resolveEditableTarget(finalComposer).focus();
    return;
  }

  finalEditable.focus();
}
