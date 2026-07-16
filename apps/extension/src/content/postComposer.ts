import {
  getComposerText,
  insertTextIntoComposer,
  resolveEditableTarget,
} from "./replyComposer";
import { findStandaloneComposers, POST_COMPOSER_SESSION_ATTRIBUTE } from "./postComposerObserver";
import { findQuotedPreview } from "./composerQuote";

function normalizeComposerSnapshot(text: string): string {
  // Both values come from getComposerText(), so their DOM representation is
  // directly comparable. Preserve authored whitespace here: adding a blank
  // line after generation is a user edit and must stop replacement.
  return text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
}

function normalizeRenderedText(text: string): string {
  // Draft.js stores paragraphs as ContentBlocks. Chromium innerText can expose
  // extra newlines at their DOM boundaries, so compare authored tokens rather
  // than browser-specific block whitespace only when verifying inserted text.
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function findLiveComposer(initialRoot: HTMLElement): { root: HTMLElement; editable: HTMLElement } | null {
  const composers = findStandaloneComposers();
  const exact = composers.find(({ root }) => root === initialRoot);
  if (exact) return exact;

  const sessionId = initialRoot.getAttribute(POST_COMPOSER_SESSION_ATTRIBUTE);
  if (!sessionId) return null;
  const sameSession = composers.find(
    ({ root }) => root.getAttribute(POST_COMPOSER_SESSION_ATTRIBUTE) === sessionId,
  );
  if (sameSession) return sameSession;

  // MutationObserver reconciliation runs on the next animation frame. If X
  // swaps the root and the user acts inside that tiny window, transfer the
  // still-valid session eagerly. A completed scan with no composer removes
  // the old root's session id, so a genuinely new composer cannot enter here.
  // Quote-ness must match too: a quote composer and a plain modal are both
  // dialogs, but drafts written above a quoted tweet must never transfer to
  // a composer without one (or vice versa).
  const expectedModal = initialRoot.matches('[role="dialog"]');
  const expectedQuote = Boolean(findQuotedPreview(initialRoot));
  const replacement = composers.find(({ root }) =>
    !root.hasAttribute(POST_COMPOSER_SESSION_ATTRIBUTE) &&
    root.matches('[role="dialog"]') === expectedModal &&
    Boolean(findQuotedPreview(root)) === expectedQuote
  );
  if (!replacement) return null;
  replacement.root.setAttribute(POST_COMPOSER_SESSION_ATTRIBUTE, sessionId);
  return replacement;
}

// Lets callers that need the composer's DOM (e.g. attachment discovery)
// follow the same root-replacement reconciliation the text snapshot uses.
export function resolveLiveComposerRoot(initialRoot: HTMLElement): HTMLElement | null {
  return findLiveComposer(initialRoot)?.root ?? null;
}

export function readStandaloneComposerSnapshot(root: HTMLElement): { available: boolean; text: string } {
  const live = findLiveComposer(root);
  if (!live) return { available: false, text: "" };
  return { available: true, text: getComposerText(resolveEditableTarget(live.editable)) };
}

export async function insertPostIntoComposer(
  initialRoot: HTMLElement,
  expectedExistingText: string,
  text: string,
): Promise<HTMLElement> {
  let composer = findLiveComposer(initialRoot);
  if (!composer) throw new Error("Post composer is no longer open.");

  const currentText = getComposerText(resolveEditableTarget(composer.editable));
  if (normalizeComposerSnapshot(currentText) !== normalizeComposerSnapshot(expectedExistingText)) {
    throw new Error("Composer text changed after generation. Generate again before inserting so your edits are not overwritten.");
  }

  let inserted = await insertTextIntoComposer(composer.editable, text);
  if (!inserted) {
    composer = findLiveComposer(initialRoot) ?? composer;
    const retryText = getComposerText(resolveEditableTarget(composer.editable));
    if (normalizeComposerSnapshot(retryText) !== normalizeComposerSnapshot(expectedExistingText)) {
      throw new Error("Composer changed during insertion. Check its current text before trying again; insertion stopped to avoid overwriting it.");
    }
    inserted = await insertTextIntoComposer(composer.editable, text);
  }
  if (!inserted) throw new Error("Post composer could not be filled.");

  composer = findLiveComposer(initialRoot) ?? composer;
  const editable = resolveEditableTarget(composer.editable);
  if (normalizeRenderedText(getComposerText(editable)) !== normalizeRenderedText(text)) {
    throw new Error("Post composer could not be verified after insertion.");
  }
  return composer.root;
}
