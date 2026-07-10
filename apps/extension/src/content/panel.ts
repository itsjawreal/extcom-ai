import { insertQuoteIntoComposer, insertReplyIntoComposer } from "./replyComposer";
import { TONE_AUTO_LABEL, TONE_LABELS, toneLabel } from "../shared/constants";
import type {
  ExtractedPostContext,
  GenerateReplyResponse,
  GeneratedReply,
  Tone,
} from "../shared/types";

type PanelInput =
  | { context: ExtractedPostContext }
  | { error: string };

let activePanel: HTMLElement | null = null;
let activeAnchor: HTMLButtonElement | null = null;
let activePost: HTMLElement | null = null;
let activePostKey: string | null = null;
let positionQueued = false;
let activeToneList: HTMLElement | null = null;

// Tracks the in-flight transitionend listener per panel so a new call to
// animatePanelHeight() can remove the previous one — without this, rapidly
// interrupting an in-progress transition (e.g. toggling a control twice in
// quick succession) leaves the old listener attached forever, since a
// transition that gets retargeted before completing never fires
// transitionend for it.
const pendingHeightListeners = new WeakMap<HTMLElement, (event: TransitionEvent) => void>();

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
  const response = await chrome.runtime.sendMessage(message) as {
    ok: boolean;
    data?: GenerateReplyResponse;
    historyId?: string;
    error?: string;
  };
  if (!response.ok) throw new Error(response.error || "Extension request failed.");
  return response as T;
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
    panel.removeEventListener("transitionend", onEnd);
    pendingHeightListeners.delete(panel);
    // Hand control back to the CSS rule so it keeps responding to viewport
    // resizes instead of staying pinned to this one stale pixel value.
    panel.style.maxHeight = "";
  };
  pendingHeightListeners.set(panel, onEnd);
  panel.addEventListener("transitionend", onEnd);
}

function showStatus(panel: HTMLElement, message: string): void {
  const status = panel.querySelector<HTMLElement>("[data-panel-status]");
  if (!status) return;
  status.textContent = message;
  window.setTimeout(() => {
    if (status.textContent === message) status.textContent = "";
  }, 2200);
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

type PanelReply = { reply: GeneratedReply; historyId?: string; usedKinds?: Set<"reply" | "quote"> };

function toPanelReplies(replies: GeneratedReply[], historyId?: string): PanelReply[] {
  return replies.map((reply) => ({ reply, historyId }));
}

// Marks a draft card as used instead of disabling it — the same draft can
// still be inserted as a reply AND quoted elsewhere, so the badge just
// tracks which actions have been taken, it never blocks further ones.
// State lives on the PanelReply object (not just the DOM node): regenerating
// a *different* slot rebuilds the whole list from scratch via renderReplies,
// and item.slice() in regenerateSlot keeps the same object reference for
// every untouched slot — tracking only the DOM would silently lose the
// badge for slots that weren't the one being regenerated.
function applyUsedBadge(card: HTMLElement, used: Set<"reply" | "quote">): void {
  card.classList.add("eks-reply-option-used");

  let badge = card.querySelector<HTMLElement>(".eks-reply-used-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "eks-reply-used-badge";
    card.querySelector(".eks-reply-char-count")?.insertAdjacentElement("afterend", badge);
  }
  const labels = [...used].map((usedKind) => (usedKind === "reply" ? "Inserted" : "Quoted"));
  badge.textContent = `✓ ${labels.join(" · ")}`;
}

async function performInsert(
  panel: HTMLElement,
  kind: "reply" | "quote",
  item: PanelReply,
  card: HTMLElement,
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
      // Fire-and-forget: don't make Insert feel slow waiting on this.
      void chrome.runtime.sendMessage({ type: "RECORD_INSERT", historyId, kind });
    }
    // Deliberately doesn't close the panel — the other drafts are still
    // useful (e.g. insert this one as a reply, then quote a different one)
    // and the panel is already guarded against accidental outside-click/
    // Escape close while drafts are showing, so nothing gets lost.
    const used = item.usedKinds ?? new Set<"reply" | "quote">();
    used.add(kind);
    item.usedKinds = used;
    applyUsedBadge(card, used);
    showStatus(panel, kind === "reply" ? "Inserted into the reply box." : "Inserted into the Quote Tweet.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Composer insertion failed.";

    if (message === filledFailureMessage) {
      try {
        await navigator.clipboard.writeText(reply.text);
        showStatus(
          panel,
          "Composer opened, but X blocked auto-insert. Reply copied. Paste with Ctrl+V.",
        );
        return;
      } catch {
        showStatus(
          panel,
          "Composer opened, but X blocked auto-insert and clipboard copy failed.",
        );
        return;
      }
    }

    showStatus(panel, message);
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
        showStatus(panel, "Copy failed. Check browser permission.");
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
    quoteButton.addEventListener("click", () => void performInsert(panel, "quote", item, card));

    const insertButton = document.createElement("button");
    insertButton.type = "button";
    insertButton.textContent = "Insert";
    insertButton.addEventListener("click", () => void performInsert(panel, "reply", item, card));

    actions.append(copyButton, regenerateButton, quoteButton, insertButton);
    card.append(text, charCount, actions);
    if (item.usedKinds?.size) applyUsedBadge(card, item.usedKinds);
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
  card?.classList.add("eks-reply-option-loading");
  // Lock the whole panel for the duration of this request, same as a full
  // Generate — otherwise the user could start a second regenerate (or a full
  // Generate) before this one resolves, and whichever response lands last
  // would silently overwrite the other with a stale items[] snapshot.
  setControlsDisabled(panel, true);
  try {
    const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
    const tone = (toneSelect?.value || undefined) as Tone | "auto" | undefined;
    const useEmoji = readUseEmoji(panel);
    const maxLength = readMaxLength(panel);
    const readImages = readReadImages(panel);
    const extraInstruction = readExtraInstruction(panel);
    const response = await sendRuntimeMessage<{ ok: true; data: GenerateReplyResponse; historyId?: string }>({
      type: "GENERATE_REPLY",
      input: { ...context, tone, count: 1, useEmoji, maxLength, readImages, extraInstruction },
    });
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
    card?.classList.remove("eks-reply-option-loading");
    showStatus(panel, error instanceof Error ? error.message : "Regenerate failed.");
  } finally {
    setControlsDisabled(panel, false);
  }
}

export function closePanel(): void {
  closeToneList();
  activePanel?.remove();
  activePanel = null;
  activeAnchor = null;
  activePost = null;
  activePostKey = null;
}

// Outside clicks, Escape, and re-clicking the same post's AI Reply button
// all route through here instead of calling closePanel() directly, so a
// stray click elsewhere on the page can't silently discard drafts the user
// hasn't inserted or explicitly dismissed — the × button is the only way
// out while panel.dataset.hasDrafts is true (see renderReplies). Opening a
// *different* post's panel still closes this one unconditionally — that's
// a deliberate exception, not an oversight.
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
      if (activePanel) showStatus(activePanel, "Could not find the original post — it may have scrolled out of the timeline.");
      return;
    }
    activeAnchor = target.anchor;
    activePost = target.post;
  }
  activePost.scrollIntoView({ behavior: "smooth", block: "center" });
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

function closeToneList(): void {
  activeToneList?.remove();
  activeToneList = null;
  activePanel?.querySelector<HTMLButtonElement>("[data-tone-trigger]")?.setAttribute("aria-expanded", "false");
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
  list.setAttribute("role", "listbox");

  const autoItem = document.createElement("li");
  autoItem.setAttribute("role", "option");
  autoItem.dataset.value = "auto";
  autoItem.textContent = TONE_AUTO_LABEL;
  if (select.value === "auto") autoItem.setAttribute("aria-selected", "true");
  list.append(autoItem);

  for (const [value, label] of Object.entries(TONE_LABELS)) {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.dataset.value = value;
    item.textContent = label;
    if (value === select.value) item.setAttribute("aria-selected", "true");
    list.append(item);
  }

  list.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLLIElement>("li[data-value]");
    if (!item?.dataset.value) return;
    select.value = item.dataset.value;
    panel.dataset.controlsTouched = "true";
    syncToneTrigger(panel);
    closeToneList();
    trigger.focus();
  });

  document.body.append(list);
  positionToneList(list, trigger);
  trigger.setAttribute("aria-expanded", "true");
  activeToneList = list;
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

function setReadImagesGroup(panel: HTMLElement, value: boolean): void {
  panel.querySelectorAll<HTMLButtonElement>("[data-images-group] button").forEach((button) => {
    button.setAttribute("aria-pressed", String((button.dataset.images === "on") === value));
  });
}

function readReadImages(panel: HTMLElement): boolean | undefined {
  const active = panel.querySelector<HTMLButtonElement>('[data-images-group] button[aria-pressed="true"]');
  return active ? active.dataset.images === "on" : undefined;
}

function setLengthMode(panel: HTMLElement, mode: "auto" | "manual"): void {
  const input = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  const manualRow = panel.querySelector<HTMLElement>("[data-max-length-manual-row]");
  panel.querySelectorAll<HTMLButtonElement>("[data-length-mode-group] button[data-length-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lengthMode === mode));
  });
  if (input) input.disabled = mode === "auto";
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
  return input ? Number(input.value) : undefined;
}

function setMaxLength(panel: HTMLElement, value: number | "auto"): void {
  if (value === "auto") {
    setLengthMode(panel, "auto");
    return;
  }
  const input = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  const display = panel.querySelector<HTMLElement>("[data-max-length-value]");
  if (input) input.value = String(value);
  if (display) display.textContent = String(value);
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
    const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }) as {
      ok: boolean;
      settings?: {
        toneDefault?: Tone | "auto";
        draftCount?: number;
        maxReplyLength?: number | "auto";
        useEmoji?: boolean;
        readImages?: boolean;
        favoriteTones?: Tone[];
      };
    };
    if (!response.ok || !response.settings) return;

    // A fast user can click tone/draft-count/emoji/length/images before this
    // fetch resolves (e.g. right after opening the panel while the service
    // worker is still waking up). Don't silently revert a choice they already
    // made.
    if (panel.dataset.controlsTouched !== "true") {
      const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
      if (toneSelect && response.settings.toneDefault) {
        toneSelect.value = response.settings.toneDefault;
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
      if (typeof response.settings.readImages === "boolean") {
        setReadImagesGroup(panel, response.settings.readImages);
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
    const extraInstruction = readExtraInstruction(panel);
    const response = await sendRuntimeMessage<{ ok: true; data: GenerateReplyResponse; historyId?: string }>({
      type: "GENERATE_REPLY",
      input: { ...context, tone, count, useEmoji, maxLength, readImages, extraInstruction },
    });
    animatePanelHeight(panel, () => renderReplies(panel, toPanelReplies(response.data.replies, response.historyId), context));
    renderUsage(panel, response.data.usage, tone === "auto" ? response.data.replies[0]?.tone : undefined);
    showStatus(panel, "Replies generated.");
  } catch (error) {
    animatePanelHeight(panel, () => renderReplies(panel, [], context));
    showStatus(panel, error instanceof Error ? error.message : "Reply generation failed.");
  } finally {
    setPanelLoading(panel, false);
  }
}

export function openPanel(anchor: HTMLButtonElement, post: HTMLElement, input: PanelInput): void {
  if (activeAnchor === anchor && activePanel) {
    attemptClosePanel();
    return;
  }

  closePanel();
  const panel = document.createElement("section");
  panel.className = "eks-reply-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI reply drafts");
  panel.innerHTML = `
    <header>
      <strong>AI Reply</strong>
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
            <p class="eks-field-row-value eks-max-length-value-row"><span data-max-length-value>220</span> chars</p>
            <input type="range" data-max-length-input min="50" max="280" step="10" value="220" />
          </div>
        </div>
        <div class="eks-panel-config">
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
            Image
            <div class="eks-count-group" data-images-group role="group" aria-label="Read image in this post">
              <button type="button" data-images="off" aria-pressed="true">Off</button>
              <button type="button" data-images="on" aria-pressed="false">On</button>
            </div>
          </div>
        </div>
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
  panel.querySelector(".eks-panel-close")?.addEventListener("click", closePanel);

  const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
  const toneTrigger = panel.querySelector<HTMLButtonElement>("[data-tone-trigger]");
  if (toneSelect && toneTrigger) {
    populateToneSelect(toneSelect);
    syncToneTrigger(panel);
    toneTrigger.addEventListener("click", () => {
      if (activeToneList) {
        closeToneList();
      } else {
        openToneList(panel, toneTrigger, toneSelect);
      }
    });
    panel.querySelector("[data-quick-tones]")?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tone]");
      if (!button?.dataset.tone) return;
      toneSelect.value = button.dataset.tone;
      panel.dataset.controlsTouched = "true";
      syncToneTrigger(panel);
    });
  }

  const maxLengthInput = panel.querySelector<HTMLInputElement>("[data-max-length-input]");
  const maxLengthValue = panel.querySelector<HTMLElement>("[data-max-length-value]");
  maxLengthInput?.addEventListener("input", () => {
    panel.dataset.controlsTouched = "true";
    if (maxLengthValue) maxLengthValue.textContent = maxLengthInput.value;
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

  // Only show the image toggle when this specific post actually has an
  // image — nothing to switch on/off otherwise.
  if (!("error" in input) && input.context.imageUrl) {
    panel.querySelector<HTMLElement>("[data-images-label]")?.removeAttribute("hidden");
  }

  panel.querySelector("[data-images-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-images]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    setReadImagesGroup(panel, button.dataset.images === "on");
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
  renderUsage(panel);

  if (!("error" in input)) {
    panel.querySelector<HTMLButtonElement>("[data-generate-button]")?.addEventListener("click", () => {
      void generateRepliesForPanel(panel, input.context);
    });
  }
}

window.addEventListener("resize", () => {
  closeToneList();
  queuePanelPosition();
});
window.addEventListener(
  "scroll",
  (event) => {
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
  if (event.key !== "Escape") return;
  if (activeToneList) {
    closeToneList();
    return;
  }
  attemptClosePanel();
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;

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
  if (!activePanel.contains(target) && !activeAnchor.contains(target)) attemptClosePanel();
});
