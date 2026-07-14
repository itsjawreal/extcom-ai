import { insertQuoteIntoComposer, insertReplyIntoComposer } from "./replyComposer";
import {
  insertPostIntoComposer,
  readStandaloneComposerSnapshot,
  resolveLiveComposerRoot,
} from "./postComposer";
import {
  discoverComposerAttachments,
  fingerprintAttachments,
  prepareAttachedImages,
} from "./composerAttachments";
import { extractQuotedPost, findQuotedPreview } from "./composerQuote";
import { POST_COMPOSER_SESSION_ATTRIBUTE, type StandaloneComposer } from "./postComposerObserver";
import {
  autoIncludeImages,
  clampReplyLength,
  MAX_REPLY_LENGTH,
  MIN_REPLY_LENGTH,
  OBJECTIVE_LABELS,
  REPLY_LENGTH_PRESETS,
  REPLY_LENGTH_SLIDER_MAX,
  replyLengthToSliderPosition,
  sliderPositionToReplyLength,
  TONE_AUTO_LABEL,
  TONE_LABELS,
  toneLabel,
} from "../shared/constants";
import type {
  AttachedImageInput,
  EngagementObjective,
  ExtractedPostContext,
  GeneratePostMode,
  GeneratePostResponse,
  GenerateReplyResponse,
  GeneratedReply,
  ReadImagesMode,
  Tone,
} from "../shared/types";

type PanelInput =
  | { context: ExtractedPostContext }
  | { error: string };

type XTheme = "light" | "dim" | "dark";

const AUTO_POST_LENGTH_CEILING = REPLY_LENGTH_PRESETS[0];

let activePanel: HTMLElement | null = null;
let activeAnchor: HTMLButtonElement | null = null;
let activePost: HTMLElement | null = null;
let activePostKey: string | null = null;
let activePanelKind: "reply" | "post" | null = null;
let activePostComposerRoot: HTMLElement | null = null;
let positionQueued = false;
let activeToneList: HTMLElement | null = null;
let activeTooltipSource: HTMLElement | null = null;
let tooltipKeyboardNavigation = false;
let themeSyncQueued = false;
// Content scripts have one module instance per tab. Keeping the last manual
// choice here makes tone sticky across panels and X's SPA navigation, while a
// tab refresh naturally resets it back to the saved Settings default.
let sessionTone: Tone | "auto" | null = null;

const TOOLTIP_ID = "eks-content-tooltip";
const TOOLTIP_GAP = 6;
const TOOLTIP_VIEWPORT_MARGIN = 8;

function parseRgb(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!match || (match[4] !== undefined && Number(match[4]) === 0)) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function detectXTheme(): XTheme {
  const candidates: Array<Element | null> = [
    document.querySelector('[data-testid="primaryColumn"]'),
    document.querySelector("main"),
    document.body,
    document.documentElement,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const rgb = parseRgb(window.getComputedStyle(candidate).backgroundColor);
    if (!rgb) continue;
    const [red, green, blue] = rgb;
    if (red >= 210 && green >= 210 && blue >= 210) return "light";
    if (red <= 8 && green <= 8 && blue <= 8) return "dark";
    return "dim";
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyXTheme(element: HTMLElement, theme: XTheme): void {
  element.dataset.eksTheme = theme;
}

function applyCurrentXTheme(element: HTMLElement): XTheme {
  const theme = detectXTheme();
  applyXTheme(element, theme);
  return theme;
}

export function syncPanelTheme(): void {
  const theme = detectXTheme();
  if (activePanel) applyXTheme(activePanel, theme);
  if (activeToneList) applyXTheme(activeToneList, theme);
  const tooltip = document.getElementById(TOOLTIP_ID);
  if (tooltip) applyXTheme(tooltip, theme);
  document.querySelectorAll<HTMLElement>(".eks-ai-reply-button, .eks-ai-post-button, .eks-post-panel").forEach((button) => {
    applyXTheme(button, theme);
  });
}

function queueThemeSync(): void {
  if (themeSyncQueued) return;
  themeSyncQueued = true;
  window.requestAnimationFrame(() => {
    themeSyncQueued = false;
    syncPanelTheme();
  });
}

const xThemeObserver = new MutationObserver(queueThemeSync);
xThemeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "style", "data-theme"],
});
if (document.body) {
  xThemeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
}
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", queueThemeSync);
syncPanelTheme();

// Tracks the in-flight transitionend listener per panel so a new call to
// animatePanelHeight() can remove the previous one — without this, rapidly
// interrupting an in-progress transition (e.g. toggling a control twice in
// quick succession) leaves the old listener attached forever, since a
// transition that gets retargeted before completing never fires
// transitionend for it.
const pendingHeightListeners = new WeakMap<HTMLElement, (event: TransitionEvent) => void>();

// Tracks the in-flight request ID per draft card so regenerateSlot can ignore
// stale responses if the user regenerates the same slot again before the
// previous response arrives. Key is the card's DOM node.
const pendingSlotRequestIds = new WeakMap<HTMLElement, string>();
const postPanelDrafts = new WeakMap<HTMLElement, PostPanelDraft[]>();

function getContentTooltip(): HTMLElement {
  const existing = document.getElementById(TOOLTIP_ID);
  if (existing) {
    applyCurrentXTheme(existing);
    // Tooltip and panel share the maximum z-index, so paint order falls back
    // to DOM order. Panels are appended to body on every open — a tooltip
    // created before the current panel would render behind it. Keep the
    // tooltip as body's last child so it always paints on top.
    if (existing !== document.body.lastElementChild) document.body.append(existing);
    return existing;
  }
  const tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;
  tooltip.className = "eks-content-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  applyCurrentXTheme(tooltip);
  document.body.append(tooltip);
  return tooltip;
}

function positionContentTooltip(source: HTMLElement, tooltip: HTMLElement): void {
  const sourceRect = source.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const spaceAbove = sourceRect.top - TOOLTIP_GAP - TOOLTIP_VIEWPORT_MARGIN;
  const top = spaceAbove >= tooltipRect.height
    ? sourceRect.top - tooltipRect.height - TOOLTIP_GAP
    : Math.min(
      sourceRect.bottom + TOOLTIP_GAP,
      viewportHeight - tooltipRect.height - TOOLTIP_VIEWPORT_MARGIN,
    );
  const centeredLeft = sourceRect.left + (sourceRect.width - tooltipRect.width) / 2;
  const left = Math.max(
    TOOLTIP_VIEWPORT_MARGIN,
    Math.min(centeredLeft, viewportWidth - tooltipRect.width - TOOLTIP_VIEWPORT_MARGIN),
  );
  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(Math.max(TOOLTIP_VIEWPORT_MARGIN, top))}px`;
}

function openContentTooltip(source: HTMLElement): void {
  if (!source.isConnected || source.offsetParent === null) return;
  if (activeTooltipSource !== source) {
    activeTooltipSource?.removeAttribute("aria-describedby");
    activeTooltipSource?.removeAttribute("data-tooltip-active");
  }
  const tooltip = getContentTooltip();
  activeTooltipSource = source;
  tooltip.textContent = source.dataset.tooltip || "";
  tooltip.dataset.open = "true";
  tooltip.setAttribute("aria-hidden", "false");
  source.setAttribute("aria-describedby", TOOLTIP_ID);
  source.dataset.tooltipActive = "true";
  positionContentTooltip(source, tooltip);
}

function closeContentTooltip(): void {
  activeTooltipSource?.removeAttribute("aria-describedby");
  activeTooltipSource?.removeAttribute("data-tooltip-active");
  activeTooltipSource = null;
  const tooltip = document.getElementById(TOOLTIP_ID);
  if (!tooltip) return;
  tooltip.dataset.open = "false";
  tooltip.setAttribute("aria-hidden", "true");
}

// X can stop pointer/click bubbling inside its React event layer. Bind the
// small info controls directly as well as keeping the document delegation
// below for dynamically-created action buttons.
function bindContentTooltip(source: HTMLElement): void {
  source.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse" || event.pointerType === "pen") openContentTooltip(source);
  });
  source.addEventListener("pointerleave", () => {
    if (activeTooltipSource === source) closeContentTooltip();
  });
  source.addEventListener("focus", () => openContentTooltip(source));
  source.addEventListener("blur", () => {
    if (activeTooltipSource === source) closeContentTooltip();
  });
  source.addEventListener("click", () => openContentTooltip(source));
}

function getPostKey(post: HTMLElement): string | null {
  const timeLink = post.querySelector("time")?.closest("a");
  const match = timeLink?.getAttribute("href")?.match(/\/status\/(\d+)/);
  return match?.[1] || null;
}

function findReanchorTarget(): { anchor: HTMLButtonElement; post: HTMLElement } | null {
  if (!activePostKey) return null;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".eks-ai-reply-button")) {
    const post = button.closest("article");
    if (post instanceof HTMLElement && getPostKey(post) === activePostKey) {
      return { anchor: button, post };
    }
  }
  return null;
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  type Response = { ok: boolean; data?: GenerateReplyResponse; historyId?: string; error?: string };
  const unavailableMessage =
    "Extension connection is unavailable. Reload Extcom AI in chrome://extensions, then refresh this X tab (F5).";
  const runtime = getRuntimeMessenger();
  if (!runtime) throw new Error(unavailableMessage);

  let response: Response;
  try {
    response = await runtime.sendMessage(message) as Response;
  } catch (error) {
    // Thrown (not returned as { ok: false }) when this content script is a
    // stale leftover from before the extension was reloaded/updated in
    // chrome://extensions — its connection to the background service
    // worker is permanently dead, reloading the extension again won't fix
    // it, only reloading THIS page will. The raw browser message
    // ("Extension context invalidated.") gives no hint that a page refresh
    // is the actual fix, so callers would otherwise show that cryptic
    // string verbatim in the panel status.
    if (
      error instanceof Error &&
      /context invalidated|extension context|receiving end does not exist|reading ['"]?sendMessage/i.test(error.message)
    ) {
      throw new Error(unavailableMessage);
    }
    throw error;
  }
  if (!response.ok) throw new Error(response.error || "Extension request failed.");
  return response as T;
}

function getRuntimeMessenger(): typeof chrome.runtime | null {
  try {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      typeof chrome.runtime.sendMessage !== "function"
    ) {
      return null;
    }
    return chrome.runtime;
  } catch {
    return null;
  }
}

function sendRuntimeMessageQuietly(message: unknown): void {
  const runtime = getRuntimeMessenger();
  if (!runtime) return;
  void runtime.sendMessage(message).catch(() => {});
}

// Same cap as .eks-reply-panel's CSS max-height (min(729px, 100vh - 112px))
// — kept in sync manually since the CSS value isn't readable from here in a
// way worth the complexity of parsing it back out.
function panelMaxHeightCapPx(): number {
  return Math.min(729, window.innerHeight - 112);
}

// Animates the panel growing/shrinking to fit its new content instead of
// snapping instantly, by pinning max-height to the measured before/after
// pixel values around the mutation (CSS can't transition to/from "auto").
// Operates on .eks-panel-body's own scrollHeight (not the outer panel's)
// since the body is the actual scroll container — measuring the outer
// panel would be affected by its own overflow:hidden clipping the body's
// current (pre-mutation) rendered height instead of its full content size.
function animatePanelHeight(panel: HTMLElement, mutate: () => void): void {
  const header = panel.querySelector<HTMLElement>("header");
  const body = panel.querySelector<HTMLElement>(".eks-panel-body");
  const footer = panel.querySelector<HTMLElement>(".eks-panel-footer");
  if (!header || !body) {
    mutate();
    return;
  }

  const startHeight = panel.getBoundingClientRect().height;
  panel.style.maxHeight = `${startHeight}px`;

  mutate();

  const targetHeight = Math.min(
    header.getBoundingClientRect().height + body.scrollHeight + (footer?.getBoundingClientRect().height ?? 0),
    panelMaxHeightCapPx(),
  );

  // Force a reflow so the browser registers startHeight as the current
  // value before we set the new one — otherwise both writes land in the
  // same frame and there's nothing for the CSS transition to animate from.
  void panel.offsetHeight;
  panel.style.maxHeight = `${targetHeight}px`;

  // A transition interrupted by this call's own maxHeight write above never
  // fires transitionend for the *previous* call — remove its listener
  // explicitly instead of leaking it.
  const previousListener = pendingHeightListeners.get(panel);
  if (previousListener) panel.removeEventListener("transitionend", previousListener);

  const onEnd = (event: TransitionEvent) => {
    if (event.propertyName !== "max-height" || event.target !== panel) return;
    cleanup();
  };

  const cleanup = () => {
    panel.removeEventListener("transitionend", onEnd);
    pendingHeightListeners.delete(panel);
    // Hand control back to the CSS rule so it keeps responding to viewport
    // resizes instead of staying pinned to this one stale pixel value.
    panel.style.maxHeight = "";
    if (timeoutId) clearTimeout(timeoutId);
  };

  pendingHeightListeners.set(panel, onEnd);
  panel.addEventListener("transitionend", onEnd);

  // Fallback: if transitionend never fires (e.g., transition was cancelled
  // mid-flight, or browser doesn't fire the event for some reason), clean up
  // after ~3 seconds to prevent listener leak on rapid toggle cycles.
  const timeoutId = window.setTimeout(cleanup, 3000);
}

const panelStatusTimers = new WeakMap<HTMLElement, number>();

function showStatus(panel: HTMLElement, message: string, state: "info" | "error" = "info"): void {
  const status = panel.querySelector<HTMLElement>("[data-panel-status]");
  if (!status) return;
  const existingTimer = panelStatusTimers.get(status);
  if (existingTimer) window.clearTimeout(existingTimer);
  status.textContent = message;
  status.dataset.state = state;
  if (state === "error") return;
  const timer = window.setTimeout(() => {
    if (status.textContent === message) status.textContent = "";
    status.removeAttribute("data-state");
    panelStatusTimers.delete(status);
  }, 3500);
  panelStatusTimers.set(status, timer);
}

function setControlsDisabled(panel: HTMLElement, disabled: boolean): void {
  panel.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input, button, select, textarea",
  ).forEach((element) => {
    if (element.dataset.panelClose === "true") return;
    element.disabled = disabled;
  });

  // Re-enabling shouldn't un-disable the max-length slider while Length mode
  // is Auto — that disabled state is a mode choice, not a loading state.
  if (!disabled) {
    const activeMode = panel.querySelector<HTMLButtonElement>(
      '[data-length-mode-group] button[aria-pressed="true"]',
    );
    const maxLengthInput = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
    if (maxLengthInput && activeMode?.dataset.lengthMode === "auto") {
      maxLengthInput.disabled = true;
    }
  }
}

function setPanelLoading(panel: HTMLElement, loading: boolean): void {
  const generateButton = panel.querySelector<HTMLButtonElement>("[data-generate-button]");
  if (generateButton) generateButton.textContent = loading ? "Generating..." : "Generate";
  setControlsDisabled(panel, loading);
}

function renderSkeleton(panel: HTMLElement, count: number): void {
  const list = panel.querySelector<HTMLElement>("[data-reply-list]");
  if (!list) return;
  list.replaceChildren();
  for (let i = 0; i < count; i += 1) {
    const item = document.createElement("div");
    item.className = "eks-reply-option eks-skeleton";
    item.innerHTML = '<div class="eks-skeleton-line"></div><div class="eks-skeleton-line eks-skeleton-line-short"></div>';
    list.append(item);
  }
}

// resolvedTone is only passed when the request used tone: "auto" — showing
// which tone the AI actually picked. A manually-picked tone is already
// visible in the Tone dropdown itself, so it'd be redundant here.
function renderUsage(panel: HTMLElement, usage?: GenerateReplyResponse["usage"], resolvedTone?: Tone): void {
  const usageNode = panel.querySelector<HTMLElement>("[data-usage]");
  if (!usageNode) return;
  if (!usage) {
    usageNode.textContent = "Token & backend live in the toolbar popup.";
    return;
  }
  const remaining = usage.remainingToday === null ? "?" : String(usage.remainingToday);
  const toneSuffix = resolvedTone ? ` • AI picked: ${toneLabel(resolvedTone)}` : "";
  usageNode.textContent = `Plan ${usage.plan} • ${remaining} left today${toneSuffix}`;
}

type PanelReply = { reply: GeneratedReply; historyId?: string };

function toPanelReplies(replies: GeneratedReply[], historyId?: string): PanelReply[] {
  return replies.map((reply) => ({ reply, historyId }));
}

async function performInsert(
  panel: HTMLElement,
  kind: "reply" | "quote",
  item: PanelReply,
): Promise<void> {
  if (!activePost) return;
  const { reply, historyId } = item;

  const filledFailureMessage = kind === "reply"
    ? "Reply composer could not be filled."
    : "Quote composer could not be filled.";

  try {
    if (kind === "reply") {
      await insertReplyIntoComposer(activePost, reply.text);
    } else {
      await insertQuoteIntoComposer(activePost, reply.text);
    }
    if (historyId) {
      // Fire-and-forget: don't make Insert feel slow waiting on this. The
      // catch is just to avoid an unhandled-rejection console warning if
      // the extension context went stale (see sendRuntimeMessage) — losing
      // one history record in that case isn't worth surfacing to the user.
      sendRuntimeMessageQuietly({ type: "RECORD_INSERT", historyId, kind });
    }
    closePanel();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Composer insertion failed.";

    if (message === filledFailureMessage) {
      try {
        await navigator.clipboard.writeText(reply.text);
        showStatus(
          panel,
          "Composer opened, but X blocked auto-insert. Reply copied. Paste with Ctrl+V.",
          "error",
        );
        return;
      } catch {
        showStatus(
          panel,
          "Composer opened, but X blocked auto-insert and clipboard copy failed.",
          "error",
        );
        return;
      }
    }

    showStatus(panel, message, "error");
  }
}

function renderReplies(panel: HTMLElement, items: PanelReply[], context?: ExtractedPostContext): void {
  const list = panel.querySelector<HTMLElement>("[data-reply-list]");
  if (!list) return;
  list.replaceChildren();

  // Guards outside-click/Escape close (see the pointerdown/keydown
  // listeners below) so a stray click on the page can't silently discard
  // drafts the user hasn't inserted or explicitly dismissed yet.
  panel.dataset.hasDrafts = String(items.length > 0);
  panel.querySelector<HTMLButtonElement>("[data-panel-close]")?.setAttribute(
    "aria-label",
    items.length > 0 ? "Close and discard drafts" : "Close",
  );

  const maxLength = readMaxLength(panel) ?? 220;

  items.forEach((item, index) => {
    const { reply } = item;
    const card = document.createElement("article");
    card.className = "eks-reply-option";

    const text = document.createElement("p");
    text.textContent = reply.text;

    const charCount = document.createElement("p");
    charCount.className = "eks-reply-char-count";
    charCount.textContent = maxLength === "auto" ? `${reply.text.length} chars` : `${reply.text.length}/${maxLength}`;

    const actions = document.createElement("div");
    actions.className = "eks-reply-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "eks-icon-action";
    copyButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
    copyButton.setAttribute("aria-label", "Copy this draft");
    copyButton.setAttribute("data-tooltip", "Copy");
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(reply.text);
        showStatus(panel, "Reply copied.");
      } catch {
        showStatus(panel, "Copy failed. Check browser permission.", "error");
      }
    });

    const regenerateButton = document.createElement("button");
    regenerateButton.type = "button";
    regenerateButton.className = "eks-icon-action";
    regenerateButton.textContent = "↻";
    regenerateButton.setAttribute("aria-label", "Regenerate this draft");
    regenerateButton.setAttribute("data-tooltip", "Regenerate");
    regenerateButton.addEventListener("click", () => {
      if (context) void regenerateSlot(panel, index, items, context);
    });

    const quoteButton = document.createElement("button");
    quoteButton.type = "button";
    quoteButton.textContent = "Quote";
    quoteButton.setAttribute("aria-label", "Insert this draft into a Quote Tweet");
    quoteButton.setAttribute("data-tooltip", "Insert into Quote Tweet");
    quoteButton.addEventListener("click", () => void performInsert(panel, "quote", item));

    const insertButton = document.createElement("button");
    insertButton.type = "button";
    insertButton.textContent = "Insert";
    insertButton.addEventListener("click", () => void performInsert(panel, "reply", item));

    actions.append(copyButton, regenerateButton, quoteButton, insertButton);
    card.append(text, charCount, actions);
    list.append(card);
  });
}

async function regenerateSlot(
  panel: HTMLElement,
  index: number,
  items: PanelReply[],
  context: ExtractedPostContext,
): Promise<void> {
  const card = panel.querySelectorAll<HTMLElement>(".eks-reply-option")[index];
  if (!card) return;

  card.classList.add("eks-reply-option-loading");
  // Lock the whole panel for the duration of this request, same as a full
  // Generate — otherwise the user could start a second regenerate (or a full
  // Generate) before this one resolves, and whichever response lands last
  // would silently overwrite the other with a stale items[] snapshot.
  setControlsDisabled(panel, true);

  // Unique ID for this regenerate request. If user regenerates this same slot
  // again before this request completes, the stored ID will change and this
  // response will be ignored as stale.
  const requestId = Math.random().toString(36).slice(2);
  pendingSlotRequestIds.set(card, requestId);

  try {
    const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
    const tone = (toneSelect?.value || undefined) as Tone | "auto" | undefined;
    const useEmoji = readUseEmoji(panel);
    const maxLength = readMaxLength(panel);
    const readImages = readReadImages(panel);
    const replyLanguage = readReplyLanguage(panel);
    const extraInstruction = readExtraInstruction(panel);
    const response = await sendRuntimeMessage<{ ok: true; data: GenerateReplyResponse; historyId?: string }>({
      type: "GENERATE_REPLY",
      input: { ...context, tone, count: 1, useEmoji, maxLength, readImages, replyLanguage, extraInstruction },
    });

    // Ignore response if this slot was regenerated again while we were waiting.
    if (pendingSlotRequestIds.get(card) !== requestId) return;

    const newReply = response.data.replies[0];
    if (!newReply) throw new Error("No draft returned.");

    // This slot now belongs to a fresh generate call (its own history entry),
    // while the other slots still belong to whatever call produced them —
    // each card tracks its own historyId rather than sharing one for the list.
    const updated = items.slice();
    updated[index] = { reply: newReply, historyId: response.historyId };
    animatePanelHeight(panel, () => renderReplies(panel, updated, context));
    renderUsage(panel, response.data.usage, tone === "auto" ? newReply.tone : undefined);
    showStatus(panel, "Draft regenerated.");
  } catch (error) {
    // Only show error if this is still the latest request for this slot.
    if (pendingSlotRequestIds.get(card) === requestId) {
      card.classList.remove("eks-reply-option-loading");
      showStatus(panel, error instanceof Error ? error.message : "Regenerate failed.", "error");
    }
  } finally {
    setControlsDisabled(panel, false);
  }
}

export function closePanel(): void {
  const panel = activePanel;
  const anchor = activeAnchor;
  const restoreFocus = Boolean(panel?.contains(document.activeElement));
  closeContentTooltip();
  closeToneList();
  panel?.remove();
  activePanel = null;
  activeAnchor = null;
  activePost = null;
  activePostKey = null;
  activePanelKind = null;
  activePostComposerRoot = null;
  if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
}

// Outside clicks, Escape, and re-clicking the same post's AI Reply button
// all route through here instead of calling closePanel() directly, so a
// stray click elsewhere on the page can't silently discard drafts the user
// hasn't inserted or explicitly dismissed — the × button is the only way
// out while panel.dataset.hasDrafts is true (see renderReplies). Opening a
// different post is guarded separately in openPanel for the same reason.
function attemptClosePanel(): void {
  if (activePanel?.dataset.hasDrafts === "true") {
    shakePanel(activePanel);
    showStatus(activePanel, "Insert or close a draft first.");
    return;
  }
  closePanel();
}

function shakePanel(panel: HTMLElement): void {
  panel.classList.remove("eks-panel-shake");
  // Force a reflow so re-adding the class restarts the animation even on
  // repeated blocked attempts in a row.
  void panel.offsetWidth;
  panel.classList.add("eks-panel-shake");
}

// The panel is docked to a fixed screen corner (see .eks-reply-panel), not
// anchored next to the post's button, so this no longer repositions
// anything visually — it only keeps activeAnchor/activePost pointing at a
// live DOM node. X rerenders replace post nodes while the user reads
// drafts; Insert/Quote/Generate all operate on activePost, so a stale
// detached reference would silently break them without this.
export function syncPanelPosition(): void {
  if (!activePanel || !activeAnchor) return;
  if (activePanelKind === "post") {
    if (activeAnchor.isConnected) return;
    const sessionId = activePostComposerRoot?.getAttribute(POST_COMPOSER_SESSION_ATTRIBUTE);
    const root = activePostComposerRoot?.isConnected
      ? activePostComposerRoot
      : sessionId
        ? document.querySelector<HTMLElement>(`[${POST_COMPOSER_SESSION_ATTRIBUTE}="${CSS.escape(sessionId)}"]`)
        : null;
    const anchor = root?.querySelector<HTMLButtonElement>(".eks-ai-post-button");
    if (root && anchor) {
      activePostComposerRoot = root;
      activeAnchor = anchor;
    }
    return;
  }
  if (!activeAnchor.isConnected) {
    const target = findReanchorTarget();
    if (!target) {
      closePanel();
      return;
    }
    activeAnchor = target.anchor;
    activePost = target.post;
  }
}

function jumpToActivePost(): void {
  if (!activePost || !activePost.isConnected) {
    const target = findReanchorTarget();
    if (!target) {
      if (activePanel) {
        showStatus(activePanel, "Could not find the original post — it may have scrolled out of the timeline.", "error");
      }
      return;
    }
    activeAnchor = target.anchor;
    activePost = target.post;
  }
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  activePost.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  activePost.classList.add("eks-jump-highlight");
  window.setTimeout(() => activePost?.classList.remove("eks-jump-highlight"), 1200);
}

function queuePanelPosition(): void {
  if (positionQueued) return;
  positionQueued = true;
  window.requestAnimationFrame(() => {
    positionQueued = false;
    syncPanelPosition();
  });
}

function renderContext(panel: HTMLElement, input: PanelInput): void {
  const container = panel.querySelector<HTMLElement>("[data-context]");
  if (!container) return;
  container.replaceChildren();

  if ("error" in input) {
    container.className = "eks-context eks-context-error";
    container.textContent = input.error;
    panel.querySelector<HTMLElement>("[data-reply-controls]")?.setAttribute("hidden", "");
    // The Generate button now floats outside [data-reply-controls] (see
    // .eks-generate-fab), so it needs to be hidden here too — otherwise
    // it's still visible (though inert, since openPanel only wires its
    // click handler when there's no error) when context extraction failed.
    panel.querySelector<HTMLElement>(".eks-generate-fab")?.setAttribute("hidden", "");
    return;
  }

  container.className = "eks-context eks-context-card";
  const context = input.context;

  // Always visible, unlike the collapsed details below — the panel is
  // docked to a screen corner now instead of sitting next to the post, so
  // this is the only thing reminding you which post you're drafting for
  // once you've scrolled away from it.
  const summaryRow = document.createElement("div");
  summaryRow.className = "eks-context-summary";
  const author = document.createElement("span");
  author.className = "eks-context-author";
  author.textContent = [context.authorName, context.authorHandle].filter(Boolean).join(" ") || "Post";
  const text = document.createElement("span");
  text.className = "eks-context-text";
  text.textContent = context.postText ? `"${truncateText(context.postText, 90)}"` : "";
  summaryRow.append(author, text);

  const jumpButton = document.createElement("button");
  jumpButton.type = "button";
  jumpButton.className = "eks-context-jump";
  jumpButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M9 7h8v8"/></svg>';
  jumpButton.setAttribute("aria-label", "Jump to post");
  jumpButton.setAttribute("data-tooltip", "Jump to post");
  jumpButton.addEventListener("click", jumpToActivePost);

  const details = document.createElement("details");
  details.className = "eks-context-details";
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = "More details";
  // Manual toggle (see the extra-instruction details in openPanel for why)
  // so the height animation measures a clean before/after instead of
  // racing the browser's own default <details> toggle timing.
  detailsSummary.addEventListener("click", (event) => {
    event.preventDefault();
    animatePanelHeight(panel, () => {
      details.open = !details.open;
    });
  });

  const fields: Array<[string, string | undefined]> = [
    ["Post", context.postText],
    ["Author", [context.authorName, context.authorHandle].filter(Boolean).join(" ") || undefined],
    ["Time", context.timestampText],
    ["URL", context.postUrl],
  ];
  const list = document.createElement("dl");
  for (const [label, value] of fields) {
    if (!value) continue;
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    list.append(term, description);
  }

  details.append(detailsSummary, list);

  // Jump-to-post and the collapsible detail list are both small secondary
  // actions tied to the same summary line — sharing one row keeps them from
  // reading as two separate stacked sections.
  const actionsRow = document.createElement("div");
  actionsRow.className = "eks-context-actions";
  actionsRow.append(jumpButton, details);

  container.append(summaryRow, actionsRow);
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function populateToneSelect(select: HTMLSelectElement): void {
  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = TONE_AUTO_LABEL;
  select.append(autoOption);

  for (const [value, label] of Object.entries(TONE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

// Tone's visible control is a custom trigger + list (see eks-select-list in
// styles.css) rather than the native <select> popup, whose list background
// can't be reliably themed cross-browser — that was the white-on-white Tone
// dropdown bug. The <select> itself stays in the DOM, hidden, purely to hold
// the value so the rest of the panel's read/write logic doesn't change.
function syncToneTrigger(panel: HTMLElement): void {
  const select = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
  const label = panel.querySelector<HTMLElement>("[data-tone-trigger-label]");
  if (select && label) label.textContent = toneLabel(select.value);
  syncQuickTones(panel);
}

function syncQuickTones(panel: HTMLElement): void {
  const select = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
  const container = panel.querySelector<HTMLElement>("[data-quick-tones]");
  if (!select || !container) return;
  container.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.tone === select.value));
  });
}

function renderQuickTones(panel: HTMLElement, favoriteTones: Tone[]): void {
  const container = panel.querySelector<HTMLElement>("[data-quick-tones]");
  const select = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
  if (!container || !select) return;
  container.replaceChildren();
  container.hidden = favoriteTones.length === 0;
  for (const tone of favoriteTones) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tone = tone;
    button.textContent = TONE_LABELS[tone] ?? tone;
    button.setAttribute("aria-pressed", String(tone === select.value));
    container.append(button);
  }
}

function closeToneList({ restoreFocus = false }: { restoreFocus?: boolean } = {}): void {
  activeToneList?.remove();
  activeToneList = null;
  const trigger = activePanel?.querySelector<HTMLButtonElement>("[data-tone-trigger]");
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.removeAttribute("aria-controls");
  if (restoreFocus) trigger?.focus({ preventScroll: true });
}

function positionToneList(list: HTMLElement, trigger: HTMLElement): void {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;

  list.style.width = `${rect.width}px`;
  list.style.left = `${rect.left}px`;
  list.style.maxHeight = `${Math.min(240, Math.max(120, openUp ? spaceAbove : spaceBelow))}px`;
  if (openUp) {
    list.style.top = "";
    list.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    list.style.bottom = "";
    list.style.top = `${rect.bottom + 4}px`;
  }
}

function openToneList(panel: HTMLElement, trigger: HTMLButtonElement, select: HTMLSelectElement): void {
  closeToneList();
  const list = document.createElement("ul");
  list.className = "eks-select-list";
  applyCurrentXTheme(list);
  list.id = "eks-tone-listbox";
  list.setAttribute("role", "listbox");

  const autoItem = document.createElement("li");
  autoItem.setAttribute("role", "option");
  autoItem.tabIndex = -1;
  autoItem.dataset.value = "auto";
  autoItem.textContent = TONE_AUTO_LABEL;
  if (select.value === "auto") autoItem.setAttribute("aria-selected", "true");
  list.append(autoItem);

  for (const [value, label] of Object.entries(TONE_LABELS)) {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.tabIndex = -1;
    item.dataset.value = value;
    item.textContent = label;
    if (value === select.value) item.setAttribute("aria-selected", "true");
    list.append(item);
  }

  const selectItem = (item: HTMLLIElement): void => {
    if (!item.dataset.value) return;
    select.value = item.dataset.value;
    sessionTone = item.dataset.value as Tone | "auto";
    panel.dataset.controlsTouched = "true";
    syncToneTrigger(panel);
    closeToneList({ restoreFocus: true });
  };

  list.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLLIElement>("li[data-value]");
    if (item) selectItem(item);
  });

  list.addEventListener("keydown", (event) => {
    const items = Array.from(list.querySelectorAll<HTMLLIElement>('li[role="option"]'));
    const focusedIndex = items.indexOf(document.activeElement as HTMLLIElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : 0;
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex]?.focus({ preventScroll: true });
      items[nextIndex]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const item = document.activeElement instanceof HTMLLIElement ? document.activeElement : null;
      if (item?.dataset.value) {
        event.preventDefault();
        selectItem(item);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeToneList({ restoreFocus: true });
    }
  });

  list.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (activeToneList === list && !list.contains(document.activeElement)) closeToneList();
    }, 0);
  });

  document.body.append(list);
  positionToneList(list, trigger);
  trigger.setAttribute("aria-expanded", "true");
  trigger.setAttribute("aria-controls", list.id);
  activeToneList = list;
  (list.querySelector<HTMLLIElement>('li[aria-selected="true"]') || autoItem).focus({ preventScroll: true });
}

function setDraftCountGroup(panel: HTMLElement, count: number): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-count-group] button").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.count) === count));
  });
}

function readDraftCount(panel: HTMLElement): number | undefined {
  const active = panel.querySelector<HTMLButtonElement>('[data-count-group] button[aria-pressed="true"]');
  return active ? Number(active.dataset.count) : undefined;
}

function setUseEmojiGroup(panel: HTMLElement, value: boolean): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-emoji-group] button").forEach((button) => {
    button.setAttribute("aria-pressed", String((button.dataset.emoji === "on") === value));
  });
}

function readUseEmoji(panel: HTMLElement): boolean | undefined {
  const active = panel.querySelector<HTMLButtonElement>('[data-emoji-group] button[aria-pressed="true"]');
  return active ? active.dataset.emoji === "on" : undefined;
}

function setGoalGroup(panel: HTMLElement, value: EngagementObjective | "none"): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-goal-group] button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.goal === value));
  });
}

// Always returns an explicit value ("none" included) so the service worker
// never mistakes a deliberate Default choice for a missing field and applies
// the saved objectiveDefault over it.
function readGoal(panel: HTMLElement): EngagementObjective | "none" {
  const active = panel.querySelector<HTMLButtonElement>('[data-goal-group] button[aria-pressed="true"]');
  const value = active?.dataset.goal;
  return value === "viral" || value === "replies" || value === "debate" || value === "value" ? value : "none";
}

function goalRowMarkup(noun: "reply" | "post"): string {
  const buttons = (Object.entries(OBJECTIVE_LABELS) as Array<[string, string]>)
    .map(([value, label]) => `<button type="button" data-goal="${value}" aria-pressed="${value === "none"}">${label}</button>`)
    .join("");
  return `
          <div class="eks-count-label" data-goal-row>
            <span class="eks-image-label-heading">
              <span>Goal</span>
              <button type="button" class="eks-tooltip-info" data-goal-info aria-label="About engagement goals" data-tooltip="What this ${noun} should achieve, combinable with any tone. Viral leads with a hook (best effort), Replies ends with one easy question, Debate takes a stance that invites pushback, Value delivers a save-worthy takeaway. Default changes nothing.">i</button>
            </span>
            <div class="eks-count-group eks-goal-group" data-goal-group role="group" aria-label="Engagement goal">${buttons}</div>
          </div>`;
}

function setReadImagesGroup(panel: HTMLElement, value: ReadImagesMode): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-images-group] button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.images === value));
  });
}

function readReadImages(panel: HTMLElement): ReadImagesMode | undefined {
  const active = panel.querySelector<HTMLButtonElement>('[data-images-group] button[aria-pressed="true"]');
  if (!active) return undefined;
  return active.dataset.images === "on" ? "on" : active.dataset.images === "off" ? "off" : "auto";
}

function setReplyLanguage(panel: HTMLElement, value: "post" | "en"): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-language-group] button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === value));
  });
}

function readReplyLanguage(panel: HTMLElement): "post" | "en" {
  const active = panel.querySelector<HTMLButtonElement>('[data-language-group] button[aria-pressed="true"]');
  return active?.dataset.language === "en" ? "en" : "post";
}

function languageDisplayName(languageTag?: string): string {
  if (!languageTag) return "Post language";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(languageTag);
    return name ? `Post (${name})` : "Post language";
  } catch {
    return `Post (${languageTag})`;
  }
}

function setLengthMode(panel: HTMLElement, mode: "auto" | "manual"): void {
  const input = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  const slider = panel.querySelector<HTMLInputElement>("[data-max-length-slider]");
  const manualRow = panel.querySelector<HTMLElement>("[data-max-length-manual-row]");
  panel.querySelectorAll<HTMLButtonElement>("[data-length-mode-group] button[data-length-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lengthMode === mode));
  });
  if (input) input.disabled = mode === "auto";
  if (slider) slider.disabled = mode === "auto";
  // Auto has no numeric target to show — hide the slider/value row entirely
  // instead of leaving a disabled, dead control taking up space.
  if (manualRow) manualRow.hidden = mode === "auto";
}

function readMaxLength(panel: HTMLElement): number | "auto" | undefined {
  const activeMode = panel.querySelector<HTMLButtonElement>(
    '[data-length-mode-group] button[aria-pressed="true"]',
  );
  if (activeMode?.dataset.lengthMode === "auto") return "auto";
  const input = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  // Clamped here, not just on the input's own change listener — this is a
  // free-typed number field with no native min/max enforcement, and it's
  // read directly at generate-time, which can happen before a blur/change
  // event has had a chance to fire and correct the display.
  return input ? clampReplyLength(Number(input.value)) : undefined;
}

function syncMaxLengthSlider(panel: HTMLElement, value?: number): void {
  const input = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  const slider = panel.querySelector<HTMLInputElement>("[data-max-length-slider]");
  const current = clampReplyLength(value ?? Number(input?.value));
  if (slider) slider.value = String(replyLengthToSliderPosition(current));
  panel
    .querySelectorAll<HTMLElement>("[data-length-mark]")
    .forEach((mark) => {
      mark.dataset.active = String(Number(mark.dataset.lengthMark) === current);
    });
}

function setMaxLength(panel: HTMLElement, value: number | "auto"): void {
  if (value === "auto") {
    setLengthMode(panel, "auto");
    return;
  }
  const input = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  const slider = panel.querySelector<HTMLInputElement>("[data-max-length-slider]");
  if (input) input.value = String(value);
  if (slider) slider.value = String(replyLengthToSliderPosition(value));
  syncMaxLengthSlider(panel, value);
  setLengthMode(panel, "manual");
}

function readExtraInstruction(panel: HTMLElement): string | undefined {
  const textarea = panel.querySelector<HTMLTextAreaElement>("[data-extra-instruction]");
  return textarea?.value.trim() || undefined;
}

// Panel controls open pre-filled with the popup's saved defaults (tone,
// draft count, max length) so the panel behaves the same as before unless
// the user actively touches a control here — this only fetches, never writes.
async function initPanelSettings(panel: HTMLElement): Promise<void> {
  try {
    const response = await sendRuntimeMessage<{
      ok: boolean;
      settings?: {
        toneDefault?: Tone | "auto";
        draftCount?: number;
        maxReplyLength?: number | "auto";
        useEmoji?: boolean;
        readImages?: ReadImagesMode;
        objectiveDefault?: EngagementObjective | "none";
        favoriteTones?: Tone[];
      };
    }>({ type: "GET_SETTINGS" });
    if (!response.ok || !response.settings) return;

    // A fast user can click tone/draft-count/emoji/length/images before this
    // fetch resolves (e.g. right after opening the panel while the service
    // worker is still waking up). Don't silently revert a choice they already
    // made.
    if (panel.dataset.controlsTouched !== "true") {
      const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
      if (toneSelect && (sessionTone || response.settings.toneDefault)) {
        toneSelect.value = sessionTone ?? response.settings.toneDefault ?? "auto";
        syncToneTrigger(panel);
      }
      if (response.settings.draftCount) {
        setDraftCountGroup(panel, response.settings.draftCount);
      }
      if (typeof response.settings.useEmoji === "boolean") {
        setUseEmojiGroup(panel, response.settings.useEmoji);
      }
      if (response.settings.maxReplyLength) {
        setMaxLength(panel, response.settings.maxReplyLength);
      }
      if (response.settings.readImages) {
        setReadImagesGroup(panel, response.settings.readImages);
      }
      if (response.settings.objectiveDefault) {
        setGoalGroup(panel, response.settings.objectiveDefault);
      }
    }
    // The quick-tone chips themselves aren't a "current value" to protect
    // from a race — render them regardless of controlsTouched, clicking one
    // is itself a fresh user action.
    renderQuickTones(panel, response.settings.favoriteTones ?? []);
  } catch {
    // Extension context gone or message failed — controls just keep their
    // static markup defaults.
  }
}

async function generateRepliesForPanel(
  panel: HTMLElement,
  context: ExtractedPostContext,
): Promise<void> {
  setPanelLoading(panel, true);
  animatePanelHeight(panel, () => renderSkeleton(panel, readDraftCount(panel) ?? 3));
  try {
    // Tone, draft count, emoji preference, reply length, whether to read an
    // attached image, and a one-off extra instruction can all be overridden
    // per-generation via the panel's own controls (fall back to the settings
    // defaults when untouched — the extra instruction is added on top of the
    // standing instruction, not a replacement for it, see serviceWorker.ts).
    const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
    const tone = (toneSelect?.value || undefined) as Tone | "auto" | undefined;
    const count = readDraftCount(panel);
    const useEmoji = readUseEmoji(panel);
    const maxLength = readMaxLength(panel);
    const readImages = readReadImages(panel);
    const replyLanguage = readReplyLanguage(panel);
    const extraInstruction = readExtraInstruction(panel);
    const objective = readGoal(panel);
    const response = await sendRuntimeMessage<{ ok: true; data: GenerateReplyResponse; historyId?: string }>({
      type: "GENERATE_REPLY",
      input: { ...context, tone, count, useEmoji, maxLength, readImages, replyLanguage, extraInstruction, objective },
    });
    animatePanelHeight(panel, () => renderReplies(panel, toPanelReplies(response.data.replies, response.historyId), context));
    renderUsage(panel, response.data.usage, tone === "auto" ? response.data.replies[0]?.tone : undefined);
    showStatus(panel, "Replies generated.");
  } catch (error) {
    animatePanelHeight(panel, () => renderReplies(panel, [], context));
    showStatus(panel, error instanceof Error ? error.message : "Reply generation failed.", "error");
  } finally {
    setPanelLoading(panel, false);
  }
}

export function openPanel(anchor: HTMLButtonElement, post: HTMLElement, input: PanelInput): void {
  if (activeAnchor === anchor && activePanel) {
    attemptClosePanel();
    return;
  }

  // Treat drafts from another post the same as drafts in the current panel:
  // require an explicit close before replacing them. Previously, clicking a
  // different post's AI Reply button discarded the current drafts instantly.
  if (activePanel?.dataset.hasDrafts === "true") {
    shakePanel(activePanel);
    showStatus(activePanel, "Close the current drafts before opening another post.");
    return;
  }
  closePanel();
  const panel = document.createElement("section");
  panel.className = "eks-reply-panel";
  applyCurrentXTheme(panel);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "eks-panel-title");
  panel.innerHTML = `
    <header>
      <strong id="eks-panel-title">AI Reply</strong>
      <button type="button" class="eks-panel-close" data-panel-close="true" aria-label="Close">×</button>
    </header>
    <div class="eks-panel-body">
    <div data-context></div>
    <div data-reply-controls>
      <div class="eks-settings-card">
        <div class="eks-tone-label">
          Tone
          <div class="eks-quick-tones" data-quick-tones hidden></div>
          <select data-tone-select hidden aria-hidden="true" tabindex="-1"></select>
          <button type="button" class="eks-select-trigger" data-tone-trigger aria-haspopup="listbox" aria-expanded="false">
            <span data-tone-trigger-label></span>
            <span class="eks-select-caret" aria-hidden="true">▾</span>
          </button>
        </div>
        <div class="eks-tone-label">
          <span class="eks-field-row">
            <span>Max length</span>
            <div class="eks-count-group" data-length-mode-group role="group" aria-label="Reply length mode">
              <button type="button" data-length-mode="manual" aria-pressed="true">Manual</button>
              <button type="button" data-length-mode="auto" aria-pressed="false">Auto</button>
            </div>
          </span>
          <div data-max-length-manual-row>
            <div class="eks-max-length-control-row">
              <div class="eks-max-length-slider-column">
                <div class="eks-max-length-marks" aria-hidden="true">
                  ${REPLY_LENGTH_PRESETS.map((preset) => `<span data-length-mark="${preset}" style="left:${replyLengthToSliderPosition(preset) / REPLY_LENGTH_SLIDER_MAX * 100}%">${preset.toLocaleString()}</span>`).join("")}
                </div>
                <input type="range" data-max-length-slider min="0" max="${REPLY_LENGTH_SLIDER_MAX}" step="1" value="${replyLengthToSliderPosition(220)}" aria-label="Reply length slider" />
              </div>
              <input type="number" inputmode="numeric" data-max-length-input min="50" max="25000" step="10" value="220" aria-label="Reply length in characters" />
            </div>
          </div>
        </div>
        <div class="eks-panel-config">
          <div class="eks-count-label eks-language-label">
            Language
            <div class="eks-count-group" data-language-group role="group" aria-label="Reply language">
              <button type="button" data-language="post" aria-pressed="true">Post language</button>
              <button type="button" data-language="en" aria-pressed="false">English</button>
            </div>
          </div>
          <div class="eks-count-label">
            Drafts
            <div class="eks-count-group" data-count-group role="group" aria-label="Number of drafts">
              <button type="button" data-count="1" aria-pressed="false">1</button>
              <button type="button" data-count="2" aria-pressed="false">2</button>
              <button type="button" data-count="3" aria-pressed="true">3</button>
            </div>
          </div>
          <div class="eks-count-label">
            Emoji
            <div class="eks-count-group" data-emoji-group role="group" aria-label="Use emoji">
              <button type="button" data-emoji="off" aria-pressed="false">Off</button>
              <button type="button" data-emoji="on" aria-pressed="true">On</button>
            </div>
          </div>
          <div class="eks-count-label" data-images-label hidden>
            <span class="eks-image-label-heading">
              <span data-images-label-text>Read image</span>
              <button type="button" class="eks-tooltip-info" data-images-info aria-label="About automatic image reading" data-tooltip="Auto reads image-only posts, short captions, or captions that refer to visual content. On always reads attached images; Off never sends them.">i</button>
            </span>
            <div class="eks-count-group" data-images-group role="group" aria-label="Read images in this post">
              <button type="button" data-images="auto" aria-pressed="true">Auto</button>
              <button type="button" data-images="on" aria-pressed="false">On</button>
              <button type="button" data-images="off" aria-pressed="false">Off</button>
            </div>
          </div>
        </div>
        ${goalRowMarkup("reply")}
        <details class="eks-extra-details">
          <summary>Add instruction for this reply</summary>
          <textarea data-extra-instruction rows="2" placeholder="e.g. mention the airdrop"></textarea>
        </details>
      </div>
      <div data-reply-list></div>
      <p class="eks-panel-note">Reply posting stays manual. Extension never clicks X/Twitter's final publish button.</p>
    </div>
    <p class="eks-panel-status" data-panel-status aria-live="polite"></p>
    </div>
    <footer class="eks-panel-footer">
      <span class="eks-panel-usage" data-usage></span>
      <button type="button" class="eks-generate-fab" data-generate-button>Generate</button>
    </footer>
  `;

  renderContext(panel, input);
  panel.querySelector(".eks-panel-close")?.addEventListener("click", () => closePanel());
  panel.querySelectorAll<HTMLElement>(".eks-tooltip-info[data-tooltip]").forEach(bindContentTooltip);

  const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
  const toneTrigger = panel.querySelector<HTMLButtonElement>("[data-tone-trigger]");
  if (toneSelect && toneTrigger) {
    populateToneSelect(toneSelect);
    // Apply the tab-session choice immediately so opening the next panel
    // never flashes Auto/default while GET_SETTINGS wakes the service worker.
    if (sessionTone) toneSelect.value = sessionTone;
    syncToneTrigger(panel);
    toneTrigger.addEventListener("click", () => {
      if (activeToneList) {
        closeToneList();
      } else {
        openToneList(panel, toneTrigger, toneSelect);
      }
    });
    toneTrigger.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      if (!activeToneList) openToneList(panel, toneTrigger, toneSelect);
      const items = Array.from(activeToneList?.querySelectorAll<HTMLLIElement>('li[role="option"]') ?? []);
      if (event.key === "ArrowUp") items.at(-1)?.focus({ preventScroll: true });
    });
    panel.querySelector("[data-quick-tones]")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tone]");
      if (!button?.dataset.tone) return;
      toneSelect.value = button.dataset.tone;
      sessionTone = button.dataset.tone as Tone;
      panel.dataset.controlsTouched = "true";
      syncToneTrigger(panel);
    });
  }

  const maxLengthInput = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  const maxLengthSlider = panel.querySelector<HTMLInputElement>("[data-max-length-slider]");
  maxLengthInput?.addEventListener("input", () => {
    panel.dataset.controlsTouched = "true";
    syncMaxLengthSlider(panel);
  });

  // "change" (fires once on blur/commit) clamps the visible value into
  // range — "input" (fires on every keystroke) deliberately doesn't, or
  // typing "4" toward "4000" would get snapped to 50 after the first digit.
  maxLengthInput?.addEventListener("change", () => {
    maxLengthInput.value = String(clampReplyLength(Number(maxLengthInput.value)));
    syncMaxLengthSlider(panel);
  });

  maxLengthSlider?.addEventListener("input", () => {
    panel.dataset.controlsTouched = "true";
    const length = sliderPositionToReplyLength(Number(maxLengthSlider.value));
    if (maxLengthInput) maxLengthInput.value = String(length);
    syncMaxLengthSlider(panel, length);
  });

  panel.querySelector("[data-length-mode-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-length-mode]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    animatePanelHeight(panel, () => setLengthMode(panel, button.dataset.lengthMode === "auto" ? "auto" : "manual"));
  });

  panel.querySelector("[data-count-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-count]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    setDraftCountGroup(panel, Number(button.dataset.count));
  });

  panel.querySelector("[data-emoji-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-emoji]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    setUseEmojiGroup(panel, button.dataset.emoji === "on");
  });

  if (!("error" in input)) {
    const sourceLanguage = input.context.sourceLanguage;
    const languageLabel = panel.querySelector<HTMLElement>(".eks-language-label");
    if (!sourceLanguage || sourceLanguage.split("-", 1)[0]?.toLowerCase() === "en") {
      // Show this override only when X positively identifies a non-English
      // source language. English makes both choices identical; unknown/und
      // is common on short English posts and otherwise leaves a confusing
      // generic "Post language" control with no useful language label.
      if (languageLabel) languageLabel.hidden = true;
    } else {
      const postLanguageButton = panel.querySelector<HTMLButtonElement>('[data-language="post"]');
      if (postLanguageButton) postLanguageButton.textContent = languageDisplayName(sourceLanguage);
    }
  }

  panel.querySelector("[data-language-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-language]");
    if (!button) return;
    setReplyLanguage(panel, button.dataset.language === "en" ? "en" : "post");
  });

  // Only show the image toggle when this specific post actually has at
  // least one image — nothing to switch on/off otherwise.
  const imageCount = !("error" in input) ? input.context.imageUrls?.length ?? 0 : 0;
  if (imageCount > 0) {
    panel.querySelector<HTMLElement>("[data-images-label]")?.removeAttribute("hidden");
    const labelText = panel.querySelector<HTMLElement>("[data-images-label-text]");
    if (labelText) labelText.textContent = imageCount > 1 ? `Read images (${imageCount})` : "Read image";
  }

  panel.querySelector("[data-images-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-images]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    setReadImagesGroup(panel, button.dataset.images === "on" ? "on" : button.dataset.images === "off" ? "off" : "auto");
  });

  panel.querySelector("[data-goal-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-goal]");
    if (!button?.dataset.goal) return;
    panel.dataset.controlsTouched = "true";
    setGoalGroup(panel, button.dataset.goal as EngagementObjective | "none");
  });

  // Take manual control of the disclosure toggle instead of letting the
  // browser's default <details> behavior race the height measurement —
  // preventDefault, then flip .open ourselves inside the same mutation the
  // animation measures around.
  const extraDetails = panel.querySelector<HTMLDetailsElement>(".eks-extra-details");
  extraDetails?.querySelector("summary")?.addEventListener("click", (event) => {
    event.preventDefault();
    animatePanelHeight(panel, () => {
      extraDetails.open = !extraDetails.open;
    });
  });

  void initPanelSettings(panel);

  document.body.append(panel);
  activePanel = panel;
  activeAnchor = anchor;
  activePost = post;
  activePostKey = getPostKey(post);
  activePanelKind = "reply";
  renderUsage(panel);
  panel.querySelector<HTMLButtonElement>("[data-panel-close]")?.focus({ preventScroll: true });

  if (!("error" in input)) {
    panel.querySelector<HTMLButtonElement>("[data-generate-button]")?.addEventListener("click", () => {
      void generateRepliesForPanel(panel, input.context);
    });
  }
}

type PostPanelDraft = {
  post: GeneratedReply;
  historyId?: string;
  expectedComposerText: string;
  // Content fingerprint of the attachments this draft was generated with.
  // Present only when images were actually sent; Insert/Replace re-checks it
  // so text written for one image never lands next to another (plan §18.9).
  attachmentFingerprint?: string;
};

// Shows the Read attached images control only while the composer actually
// has supported attachments (plan §18.3), and keeps its count current.
function refreshPostAttachmentRow(panel: HTMLElement, composerRoot: HTMLElement): void {
  const row = panel.querySelector<HTMLElement>("[data-attachment-row]");
  if (!row) return;
  const liveRoot = resolveLiveComposerRoot(composerRoot) ?? composerRoot;
  const count = discoverComposerAttachments(liveRoot).images.length;
  const label = row.querySelector<HTMLElement>("[data-attachment-label]");
  if (label) label.textContent = count ? `Read attached images (${count})` : "Read attached images";
  if (row.hidden !== (count === 0)) {
    animatePanelHeight(panel, () => {
      row.hidden = count === 0;
    });
  }
}

function setPostMode(panel: HTMLElement, mode: GeneratePostMode): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-post-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.postMode === mode));
  });
}

function readPostMode(panel: HTMLElement): GeneratePostMode {
  const active = panel.querySelector<HTMLButtonElement>('[data-post-mode][aria-pressed="true"]');
  return active?.dataset.postMode === "rewrite"
    ? "rewrite"
    : active?.dataset.postMode === "continue"
      ? "continue"
      : "fresh";
}

function setPostLanguage(panel: HTMLElement, language: "brief" | "en"): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-post-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.postLanguage === language));
  });
}

function readPostLanguage(panel: HTMLElement): "brief" | "en" {
  const active = panel.querySelector<HTMLButtonElement>('[data-post-language][aria-pressed="true"]');
  return active?.dataset.postLanguage === "en" ? "en" : "brief";
}

function assertContinueHasLengthRoom(
  mode: GeneratePostMode,
  existingDraft: string,
  maxLength: number | "auto" | undefined,
): void {
  if (mode !== "continue" || !existingDraft || maxLength === undefined) return;
  const requiredLength = existingDraft.length + MIN_REPLY_LENGTH;
  if (requiredLength > MAX_REPLY_LENGTH) {
    throw new Error(
      `Continue cannot extend this ${existingDraft.length}-char draft within the ${MAX_REPLY_LENGTH.toLocaleString()}-char maximum.`,
    );
  }
  const effectiveLimit = maxLength === "auto" ? AUTO_POST_LENGTH_CEILING : maxLength;
  if (effectiveLimit >= requiredLength) return;

  if (maxLength === "auto") {
    throw new Error(
      `Continue needs at least ${requiredLength} total chars for this ${existingDraft.length}-char draft. Auto stops at ${AUTO_POST_LENGTH_CEILING}; choose Manual.`,
    );
  }
  const autoAlternative = requiredLength <= AUTO_POST_LENGTH_CEILING ? " or choose Auto" : "";
  throw new Error(
    `Continue needs at least ${requiredLength} total chars for this ${existingDraft.length}-char draft. Raise Max length to ${requiredLength}${autoAlternative}.`,
  );
}

async function requestPostDrafts(
  panel: HTMLElement,
  composerRoot: HTMLElement,
  countOverride?: number,
): Promise<{ items: PostPanelDraft[]; response: GeneratePostResponse; requestedTone?: Tone | "auto" }> {
  const mode = readPostMode(panel);
  const composerSnapshot = readStandaloneComposerSnapshot(composerRoot);
  if (!composerSnapshot.available) throw new Error("Post composer is no longer open. Open a new composer and try again.");
  const existingDraft = composerSnapshot.text;

  const liveRoot = resolveLiveComposerRoot(composerRoot) ?? composerRoot;
  const discovered = discoverComposerAttachments(liveRoot).images;
  const imageMode = readReadImages(panel) ?? "auto";
  // Every mode may use attached media as context (rewrite/continue grounding,
  // plan §18.2); only generation with an empty composer is fresh-specific.
  const includeImages = imageMode === "on" ||
    (imageMode === "auto" && autoIncludeImages(existingDraft, discovered.length > 0));

  // Read the quoted tweet (if this is a quote composer) at Generate time,
  // like attachments — the §20.2 matrix allows an empty-composer Fresh to
  // generate commentary from the quoted post alone.
  const quotedPreview = findQuotedPreview(liveRoot);
  const quotedPost = quotedPreview ? extractQuotedPost(quotedPreview) ?? undefined : undefined;

  if (!existingDraft && !(mode === "fresh" && (quotedPost || (includeImages && discovered.length)))) {
    if (mode !== "fresh" && quotedPost) {
      throw new Error(
        `${mode === "rewrite" ? "Rewrite" : "Continue"} edits composer text. Type your take first, or switch to Fresh to write a comment on the quoted post.`,
      );
    }
    if (mode !== "fresh" && discovered.length) {
      throw new Error(
        `${mode === "rewrite" ? "Rewrite" : "Continue"} edits composer text, so images alone aren't enough. Type a draft first, or switch to Fresh for an image-only post.`,
      );
    }
    if (mode === "fresh" && discovered.length && !includeImages) {
      throw new Error(
        'Type a topic in the composer, or set "Read attached images" to Auto or On to generate from the attached image.',
      );
    }
    throw new Error(`Type a topic or draft in X's "What's happening?" composer first.`);
  }
  const maxLength = readMaxLength(panel);
  assertContinueHasLengthRoom(mode, existingDraft, maxLength);

  // Attachment bytes are read only here, after the user pressed Generate.
  let attachedImages: AttachedImageInput[] | undefined;
  let attachmentFingerprint: string | undefined;
  if (includeImages && discovered.length) {
    showStatus(panel, `Preparing ${discovered.length} image${discovered.length > 1 ? "s" : ""}…`);
    const prepared = await prepareAttachedImages(discovered);
    attachedImages = prepared.images;
    attachmentFingerprint = prepared.fingerprint;
  }

  const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
  const tone = (toneSelect?.value || undefined) as Tone | "auto" | undefined;
  const response = await sendRuntimeMessage<{ ok: true; data: GeneratePostResponse; historyId?: string }>({
    type: "GENERATE_POST",
    input: {
      // X's composer is the only source field. Keep it in existingDraft for
      // every mode so Premium long-form source text retains the 25k limit;
      // Fresh still treats it only as source material in the backend prompt.
      brief: "",
      existingDraft,
      mode,
      language: readPostLanguage(panel),
      tone,
      objective: readGoal(panel),
      count: countOverride ?? readDraftCount(panel),
      maxLength,
      useEmoji: readUseEmoji(panel),
      extraInstruction: readExtraInstruction(panel),
      attachedImages,
      quotedPost,
    },
  });

  return {
    items: response.data.posts.map((post) => ({
      post,
      historyId: response.historyId,
      expectedComposerText: existingDraft,
      attachmentFingerprint,
    })),
    response: response.data,
    requestedTone: tone,
  };
}

async function insertPostDraft(panel: HTMLElement, composerRoot: HTMLElement, item: PostPanelDraft): Promise<void> {
  // Never insert text generated for different media (plan §18.9). Copy stays
  // available for stale drafts because it does not touch the composer.
  if (item.attachmentFingerprint !== undefined) {
    const liveRoot = resolveLiveComposerRoot(composerRoot) ?? composerRoot;
    const current = await fingerprintAttachments(discoverComposerAttachments(liveRoot).images);
    if (current !== item.attachmentFingerprint) {
      showStatus(panel, "Attached images changed. Regenerate for the current composer.", "error");
      return;
    }
  }
  try {
    const liveComposerRoot = await insertPostIntoComposer(composerRoot, item.expectedComposerText, item.post.text);
    if (item.historyId) {
      sendRuntimeMessageQuietly({ type: "RECORD_INSERT", historyId: item.historyId, kind: "post" });
    }
    activePostComposerRoot = liveComposerRoot;
    const liveAnchor = liveComposerRoot.querySelector<HTMLButtonElement>(".eks-ai-post-button");
    if (liveAnchor) activeAnchor = liveAnchor;
    animatePanelHeight(panel, () => renderPostDrafts(panel, liveComposerRoot, []));
    showStatus(panel, "Inserted into X. Choose another mode to generate again.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Post insertion failed.";
    try {
      await navigator.clipboard.writeText(item.post.text);
      const copyMessage = /could not be (?:filled|verified)/i.test(message)
        ? "X blocked auto-insert. Post copied; paste it with Ctrl+V."
        : `${message} Post draft copied as a fallback.`;
      showStatus(panel, copyMessage, "error");
    } catch {
      showStatus(panel, `${message} Clipboard copy also failed.`, "error");
    }
  }
}

function renderPostDrafts(panel: HTMLElement, composerRoot: HTMLElement, items: PostPanelDraft[]): void {
  const list = panel.querySelector<HTMLElement>("[data-reply-list]");
  if (!list) return;
  list.replaceChildren();
  postPanelDrafts.set(panel, items);
  panel.dataset.hasDrafts = String(items.length > 0);
  panel.querySelector<HTMLButtonElement>("[data-panel-close]")?.setAttribute(
    "aria-label",
    items.length > 0 ? "Close and discard drafts" : "Close",
  );
  const maxLength = readMaxLength(panel) ?? 220;

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "eks-reply-option";
    const text = document.createElement("p");
    text.textContent = item.post.text;
    const charCount = document.createElement("p");
    charCount.className = "eks-reply-char-count";
    charCount.textContent = maxLength === "auto"
      ? `${item.post.text.length} chars`
      : `${item.post.text.length}/${maxLength}`;
    const actions = document.createElement("div");
    actions.className = "eks-reply-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "eks-icon-action";
    copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
    copy.setAttribute("aria-label", "Copy this post draft");
    copy.setAttribute("data-tooltip", "Copy");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.post.text);
        showStatus(panel, "Post copied.");
      } catch {
        showStatus(panel, "Copy failed. Check browser permission.", "error");
      }
    });

    const regenerate = document.createElement("button");
    regenerate.type = "button";
    regenerate.className = "eks-icon-action";
    regenerate.textContent = "↻";
    regenerate.setAttribute("aria-label", "Regenerate this post draft");
    regenerate.setAttribute("data-tooltip", "Regenerate");
    regenerate.addEventListener("click", async () => {
      card.classList.add("eks-reply-option-loading");
      setControlsDisabled(panel, true);
      try {
        const generated = await requestPostDrafts(panel, composerRoot, 1);
        const replacement = generated.items[0];
        if (!replacement) throw new Error("No draft returned.");
        const updated = items.slice();
        updated[index] = replacement;
        animatePanelHeight(panel, () => renderPostDrafts(panel, composerRoot, updated));
        renderUsage(
          panel,
          generated.response.usage,
          generated.requestedTone === "auto" ? replacement.post.tone : undefined,
        );
        showStatus(panel, "Post draft regenerated.");
      } catch (error) {
        card.classList.remove("eks-reply-option-loading");
        showStatus(panel, error instanceof Error ? error.message : "Regenerate failed.", "error");
      } finally {
        setControlsDisabled(panel, false);
      }
    });

    const insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = "Insert";
    let replaceArmed = false;
    let replaceTimer: number | undefined;
    insert.addEventListener("click", () => {
      if (item.expectedComposerText && !replaceArmed) {
        replaceArmed = true;
        insert.textContent = "Replace draft?";
        insert.setAttribute("aria-label", "Confirm replacing the existing composer draft");
        showStatus(panel, "This will replace your existing composer text. Click Replace draft? again to confirm.");
        window.clearTimeout(replaceTimer);
        replaceTimer = window.setTimeout(() => {
          replaceArmed = false;
          insert.textContent = "Insert";
          insert.removeAttribute("aria-label");
        }, 6_000);
        return;
      }
      window.clearTimeout(replaceTimer);
      replaceArmed = false;
      insert.textContent = "Insert";
      insert.removeAttribute("aria-label");
      void insertPostDraft(panel, composerRoot, item);
    });
    actions.append(copy, regenerate, insert);
    card.append(text, charCount, actions);
    list.append(card);
  });
}

async function generatePostsForPanel(panel: HTMLElement, composerRoot: HTMLElement): Promise<void> {
  const previousItems = postPanelDrafts.get(panel) ?? [];
  setPanelLoading(panel, true);
  animatePanelHeight(panel, () => renderSkeleton(panel, readDraftCount(panel) ?? 3));
  try {
    const generated = await requestPostDrafts(panel, composerRoot);
    animatePanelHeight(panel, () => renderPostDrafts(panel, composerRoot, generated.items));
    renderUsage(
      panel,
      generated.response.usage,
      generated.requestedTone === "auto" ? generated.items[0]?.post.tone : undefined,
    );
    showStatus(panel, "Post drafts generated.");
  } catch (error) {
    // A retrying user should not lose already-good drafts just because the
    // next provider call failed or timed out.
    animatePanelHeight(panel, () => renderPostDrafts(panel, composerRoot, previousItems));
    showStatus(panel, error instanceof Error ? error.message : "Post generation failed.", "error");
  } finally {
    setPanelLoading(panel, false);
  }
}

function bindPostPanelControls(panel: HTMLElement): void {
  const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
  const toneTrigger = panel.querySelector<HTMLButtonElement>("[data-tone-trigger]");
  if (toneSelect && toneTrigger) {
    populateToneSelect(toneSelect);
    if (sessionTone) toneSelect.value = sessionTone;
    syncToneTrigger(panel);
    toneTrigger.addEventListener("click", () => {
      if (activeToneList) closeToneList();
      else openToneList(panel, toneTrigger, toneSelect);
    });
    panel.querySelector("[data-quick-tones]")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tone]");
      if (!button?.dataset.tone) return;
      toneSelect.value = button.dataset.tone;
      sessionTone = button.dataset.tone as Tone;
      panel.dataset.controlsTouched = "true";
      syncToneTrigger(panel);
    });
  }

  const lengthInput = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  const lengthSlider = panel.querySelector<HTMLInputElement>("[data-max-length-slider]");
  lengthInput?.addEventListener("input", () => {
    panel.dataset.controlsTouched = "true";
    syncMaxLengthSlider(panel);
  });
  lengthInput?.addEventListener("change", () => {
    lengthInput.value = String(clampReplyLength(Number(lengthInput.value)));
    syncMaxLengthSlider(panel);
  });
  lengthSlider?.addEventListener("input", () => {
    panel.dataset.controlsTouched = "true";
    const length = sliderPositionToReplyLength(Number(lengthSlider.value));
    if (lengthInput) lengthInput.value = String(length);
    syncMaxLengthSlider(panel, length);
  });
  panel.querySelector("[data-length-mode-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-length-mode]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    animatePanelHeight(panel, () => setLengthMode(panel, button.dataset.lengthMode === "auto" ? "auto" : "manual"));
  });
  panel.querySelector("[data-count-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-count]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    setDraftCountGroup(panel, Number(button.dataset.count));
  });
  panel.querySelector("[data-emoji-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-emoji]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    setUseEmojiGroup(panel, button.dataset.emoji === "on");
  });
  panel.querySelector("[data-post-mode-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-post-mode]");
    if (!button) return;
    setPostMode(panel, button.dataset.postMode as GeneratePostMode);
  });
  panel.querySelector("[data-images-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-images]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    setReadImagesGroup(panel, button.dataset.images as ReadImagesMode);
  });
  panel.querySelector("[data-goal-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-goal]");
    if (!button?.dataset.goal) return;
    panel.dataset.controlsTouched = "true";
    setGoalGroup(panel, button.dataset.goal as EngagementObjective | "none");
  });
  panel.querySelector("[data-post-language-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-post-language]");
    if (!button) return;
    setPostLanguage(panel, button.dataset.postLanguage === "en" ? "en" : "brief");
  });
  const details = panel.querySelector<HTMLDetailsElement>(".eks-extra-details");
  details?.querySelector("summary")?.addEventListener("click", (event) => {
    event.preventDefault();
    animatePanelHeight(panel, () => {
      details.open = !details.open;
    });
  });
}

export function openPostPanel(anchor: HTMLButtonElement, composer: StandaloneComposer): void {
  if (activePanelKind === "post" && activeAnchor === anchor && activePanel) {
    attemptClosePanel();
    return;
  }
  if (activePanel?.dataset.hasDrafts === "true") {
    shakePanel(activePanel);
    showStatus(activePanel, "Close the current drafts before opening another composer.");
    return;
  }
  closePanel();

  const panel = document.createElement("section");
  panel.className = "eks-reply-panel eks-post-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", "eks-post-panel-title");
  panel.innerHTML = `
    <header>
      <strong id="eks-post-panel-title">AI Post</strong>
      <button type="button" class="eks-panel-close" data-panel-close="true" aria-label="Close">×</button>
    </header>
    <div class="eks-panel-body">
      <div class="eks-settings-card">
        <div class="eks-count-label" data-post-mode-row>
          Mode
          <div class="eks-count-group eks-post-mode-group" data-post-mode-group role="group" aria-label="Post generation mode">
            <button type="button" data-post-mode="fresh" aria-pressed="true">Fresh</button>
            <button type="button" data-post-mode="rewrite" aria-pressed="false">Rewrite</button>
            <button type="button" data-post-mode="continue" aria-pressed="false">Continue</button>
          </div>
          <span class="eks-control-hint" data-post-mode-hint>Fresh uses the composer as an idea; Rewrite and Continue treat it as a draft.</span>
        </div>
        <div class="eks-control-hint" data-quote-strip hidden></div>
        <div class="eks-count-label" data-attachment-row hidden>
          <span data-attachment-label>Read attached images</span>
          <div class="eks-count-group" data-images-group role="group" aria-label="Read attached composer images">
            <button type="button" data-images="auto" aria-pressed="true">Auto</button>
            <button type="button" data-images="on" aria-pressed="false">On</button>
            <button type="button" data-images="off" aria-pressed="false">Off</button>
          </div>
          <span class="eks-control-hint">Attached images are read and sent to your backend/AI provider only when you press Generate. They are never uploaded, changed, or posted by the extension.</span>
        </div>
        <div class="eks-tone-label">
          Tone
          <div class="eks-quick-tones" data-quick-tones hidden></div>
          <select data-tone-select hidden aria-hidden="true" tabindex="-1"></select>
          <button type="button" class="eks-select-trigger" data-tone-trigger aria-haspopup="listbox" aria-expanded="false">
            <span data-tone-trigger-label></span><span class="eks-select-caret" aria-hidden="true">▾</span>
          </button>
        </div>
        <div class="eks-tone-label">
          <span class="eks-field-row">
            <span>Max length</span>
            <div class="eks-count-group" data-length-mode-group role="group" aria-label="Post length mode">
              <button type="button" data-length-mode="manual" aria-pressed="true">Manual</button>
              <button type="button" data-length-mode="auto" aria-pressed="false">Auto</button>
            </div>
          </span>
          <div data-max-length-manual-row>
            <div class="eks-max-length-control-row">
              <div class="eks-max-length-slider-column">
                <div class="eks-max-length-marks" aria-hidden="true">
                  ${REPLY_LENGTH_PRESETS.map((preset) => `<span data-length-mark="${preset}" style="left:${replyLengthToSliderPosition(preset) / REPLY_LENGTH_SLIDER_MAX * 100}%">${preset.toLocaleString()}</span>`).join("")}
                </div>
                <input type="range" data-max-length-slider min="0" max="${REPLY_LENGTH_SLIDER_MAX}" step="1" value="${replyLengthToSliderPosition(220)}" aria-label="Post length slider" />
              </div>
              <input type="number" inputmode="numeric" data-max-length-input min="50" max="25000" step="10" value="220" aria-label="Post length in characters" />
            </div>
          </div>
        </div>
        <div class="eks-panel-config eks-post-config">
          <div class="eks-count-label">
            Language
            <div class="eks-count-group" data-post-language-group role="group" aria-label="Post language">
              <button type="button" data-post-language="brief" aria-pressed="true">Composer language</button>
              <button type="button" data-post-language="en" aria-pressed="false">English</button>
            </div>
          </div>
          <div class="eks-count-label">
            Drafts
            <div class="eks-count-group" data-count-group role="group" aria-label="Number of drafts">
              <button type="button" data-count="1" aria-pressed="false">1</button>
              <button type="button" data-count="2" aria-pressed="false">2</button>
              <button type="button" data-count="3" aria-pressed="true">3</button>
            </div>
          </div>
          <div class="eks-count-label">
            Emoji
            <div class="eks-count-group" data-emoji-group role="group" aria-label="Use emoji">
              <button type="button" data-emoji="off" aria-pressed="false">Off</button>
              <button type="button" data-emoji="on" aria-pressed="true">On</button>
            </div>
          </div>
        </div>
        ${goalRowMarkup("post")}
        <details class="eks-extra-details">
          <summary>Add instruction for this post</summary>
          <textarea data-extra-instruction rows="2" maxlength="500" placeholder="e.g. end with a question"></textarea>
        </details>
      </div>
      <div data-reply-list></div>
      <p class="eks-panel-note">Posting stays manual. Extension never clicks X/Twitter's final Post button.</p>
      <p class="eks-panel-status" data-panel-status aria-live="polite"></p>
    </div>
    <footer class="eks-panel-footer">
      <span class="eks-panel-usage" data-usage></span>
      <button type="button" class="eks-generate-fab" data-generate-button>Generate</button>
    </footer>
  `;

  setPostMode(panel, "fresh");
  bindPostPanelControls(panel);
  panel.querySelectorAll<HTMLElement>(".eks-tooltip-info[data-tooltip]").forEach(bindContentTooltip);

  // Quote composer (plan §20.3): retitle the panel, show what was read from
  // the quoted preview, and adjust the mode hint. Extraction failure only
  // downgrades the strip — generation still works from composer text.
  const quotedPreview = findQuotedPreview(composer.root);
  if (quotedPreview) {
    const title = panel.querySelector<HTMLElement>("#eks-post-panel-title");
    if (title) title.textContent = "AI Quote";
    const strip = panel.querySelector<HTMLElement>("[data-quote-strip]");
    const quoted = extractQuotedPost(quotedPreview);
    if (strip) {
      strip.hidden = false;
      if (!quoted) {
        strip.textContent = "Quoted post not readable — generating from your composer text only.";
      } else {
        const who = quoted.authorHandle ?? quoted.authorName ?? "a post";
        const snippet = quoted.text
          ? `: “${quoted.text.length > 80 ? `${quoted.text.slice(0, 80)}…` : quoted.text}”`
          : quoted.imageUrls?.length
            ? ` (image post, ${quoted.imageUrls.length} image${quoted.imageUrls.length > 1 ? "s" : ""})`
            : "";
        strip.textContent = `Quoting ${who}${snippet}`;
      }
    }
    if (quoted) {
      const modeHint = panel.querySelector<HTMLElement>("[data-post-mode-hint]");
      if (modeHint) modeHint.textContent = "Fresh writes your take on the quoted post; Rewrite and Continue edit your draft.";
    }
  }

  panel.querySelector("[data-panel-close]")?.addEventListener("click", () => closePanel());
  document.body.append(panel);
  activePanel = panel;
  activeAnchor = anchor;
  activePanelKind = "post";
  activePostComposerRoot = composer.root;
  renderUsage(panel);
  syncPanelTheme();
  void initPanelSettings(panel);
  refreshPostAttachmentRow(panel, composer.root);
  // Attachments can be added/removed while the panel is open; poll cheaply
  // instead of observing X's whole composer subtree. The timer dies with the
  // panel element.
  const attachmentTimer = window.setInterval(() => {
    if (!panel.isConnected) {
      window.clearInterval(attachmentTimer);
      return;
    }
    refreshPostAttachmentRow(panel, activePostComposerRoot ?? composer.root);
  }, 1_500);
  panel.querySelector<HTMLButtonElement>("[data-generate-button]")?.addEventListener("click", () => {
    void generatePostsForPanel(panel, activePostComposerRoot ?? composer.root);
  });
  panel.querySelector<HTMLButtonElement>('[data-post-mode="fresh"]')?.focus({ preventScroll: true });
}

window.addEventListener("resize", () => {
  closeContentTooltip();
  closeToneList();
  queuePanelPosition();
});
window.addEventListener(
  "scroll",
  (event) => {
    closeContentTooltip();
    // Scroll doesn't bubble, but capture-phase listeners on window still fire
    // for scrolling inside any descendant — including the tone list's own
    // overflow-y:auto. Without this check, scrolling (or clicking its
    // scrollbar track, which jumps the scroll position) closes the list
    // instead of letting the user scroll through the tone options.
    if (activeToneList && event.target instanceof Node && activeToneList.contains(event.target)) {
      return;
    }
    closeToneList();
    queuePanelPosition();
  },
  { capture: true, passive: true },
);

document.addEventListener("keydown", (event) => {
  tooltipKeyboardNavigation = true;
  if (event.key !== "Escape") return;
  closeContentTooltip();
  if (activeToneList) {
    closeToneList({ restoreFocus: true });
    return;
  }
  attemptClosePanel();
});

document.addEventListener("pointerdown", (event) => {
  tooltipKeyboardNavigation = false;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!(target instanceof Element) || !target.closest(".eks-reply-panel [data-tooltip]")) {
    closeContentTooltip();
  }

  const insideToneList = activeToneList?.contains(target) ?? false;

  if (activeToneList && !insideToneList) {
    const trigger = activePanel?.querySelector<HTMLElement>("[data-tone-trigger]");
    if (!trigger || !trigger.contains(target)) closeToneList();
  }

  // The tone list is appended to <body>, outside the panel's own subtree
  // (so it isn't clipped by the panel's overflow-y:auto) — without this,
  // clicking an option reads as "outside the panel" and closes the whole
  // panel instead of just picking a tone.
  if (insideToneList) return;

  if (!activePanel || !activeAnchor) return;
  const insideActiveComposer = activePanelKind === "post" && activePostComposerRoot?.contains(target);
  if (!activePanel.contains(target) && !activeAnchor.contains(target) && !insideActiveComposer) attemptClosePanel();
});

document.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse") return;
  const source = event.target instanceof Element
    ? event.target.closest<HTMLElement>(".eks-reply-panel [data-tooltip]")
    : null;
  if (source) {
    const rect = source.getBoundingClientRect();
    const directlyInside = event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
    if (directlyInside) {
      openContentTooltip(source);
      return;
    }
  }
  closeContentTooltip();
});

// pointermove only fires while the cursor stays inside the document, so a
// mouse leaving the page (off the browser viewport) without another move
// event never reaches the handler above and the tooltip would stay open
// forever. relatedTarget is null exactly when the pointer exits the
// document, which pointerout still reports.
document.addEventListener("pointerout", (event) => {
  if (event.pointerType === "mouse" && event.relatedTarget === null) closeContentTooltip();
});

document.addEventListener("focusin", (event) => {
  if (!tooltipKeyboardNavigation || !(event.target instanceof Element)) return;
  const source = event.target.closest<HTMLElement>(".eks-reply-panel [data-tooltip]");
  if (source) openContentTooltip(source);
});

document.addEventListener("focusout", (event) => {
  if (event.target === activeTooltipSource) closeContentTooltip();
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const infoButton = event.target.closest<HTMLElement>(".eks-tooltip-info[data-tooltip]");
  if (infoButton) openContentTooltip(infoButton);
});
