import { insertReplyIntoComposer } from "./replyComposer";
import { TONE_LABELS } from "../shared/constants";
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

function positionPanel(panel: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(380, window.innerWidth - 24);
  const left = Math.min(
    Math.max(12, rect.left),
    Math.max(12, window.innerWidth - width - 12),
  );
  const preferredTop = rect.bottom + 8;
  const top =
    preferredTop + 520 < window.innerHeight
      ? preferredTop
      : Math.max(12, rect.top - 528);

  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
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

function renderUsage(panel: HTMLElement, usage?: GenerateReplyResponse["usage"]): void {
  const usageNode = panel.querySelector<HTMLElement>("[data-usage]");
  if (!usageNode) return;
  if (!usage) {
    usageNode.textContent = "Token & backend live in the toolbar popup.";
    return;
  }
  const remaining = usage.remainingToday === null ? "?" : String(usage.remainingToday);
  usageNode.textContent = `Plan ${usage.plan} • ${remaining} left today`;
}

type PanelReply = { reply: GeneratedReply; historyId?: string };

function toPanelReplies(replies: GeneratedReply[], historyId?: string): PanelReply[] {
  return replies.map((reply) => ({ reply, historyId }));
}

function renderReplies(panel: HTMLElement, items: PanelReply[], context?: ExtractedPostContext): void {
  const list = panel.querySelector<HTMLElement>("[data-reply-list]");
  if (!list) return;
  list.replaceChildren();

  const maxLength = Number(panel.dataset.maxLength) || 220;

  items.forEach(({ reply, historyId }, index) => {
    const item = document.createElement("article");
    item.className = "eks-reply-option";

    const text = document.createElement("p");
    text.textContent = reply.text;

    const charCount = document.createElement("p");
    charCount.className = "eks-reply-char-count";
    charCount.textContent = `${reply.text.length}/${maxLength}`;

    const actions = document.createElement("div");
    actions.className = "eks-reply-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy";
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
    regenerateButton.textContent = "↻";
    regenerateButton.setAttribute("aria-label", "Regenerate this draft");
    regenerateButton.title = "Regenerate this draft";
    regenerateButton.addEventListener("click", () => {
      if (context) void regenerateSlot(panel, index, items, context);
    });

    const insertButton = document.createElement("button");
    insertButton.type = "button";
    insertButton.textContent = "Insert";
    insertButton.addEventListener("click", async () => {
      if (!activePost) return;
      try {
        await insertReplyIntoComposer(activePost, reply.text);
        if (historyId) {
          // Fire-and-forget: don't make Insert feel slow waiting on this.
          void chrome.runtime.sendMessage({ type: "RECORD_INSERT", historyId });
        }
        closePanel();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Composer insertion failed.";

        if (message === "Reply composer could not be filled.") {
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

        showStatus(
          panel,
          message,
        );
      }
    });

    actions.append(copyButton, regenerateButton, insertButton);
    item.append(text, charCount, actions);
    list.append(item);
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
    const tone = (toneSelect?.value || undefined) as Tone | undefined;
    const extraInstruction = readExtraInstruction(panel);
    const response = await sendRuntimeMessage<{ ok: true; data: GenerateReplyResponse; historyId?: string }>({
      type: "GENERATE_REPLY",
      input: { ...context, tone, count: 1, extraInstruction },
    });
    const newReply = response.data.replies[0];
    if (!newReply) throw new Error("No draft returned.");

    // This slot now belongs to a fresh generate call (its own history entry),
    // while the other slots still belong to whatever call produced them —
    // each card tracks its own historyId rather than sharing one for the list.
    const updated = items.slice();
    updated[index] = { reply: newReply, historyId: response.historyId };
    renderReplies(panel, updated, context);
    renderUsage(panel, response.data.usage);
    showStatus(panel, "Draft regenerated.");
  } catch (error) {
    card?.classList.remove("eks-reply-option-loading");
    showStatus(panel, error instanceof Error ? error.message : "Regenerate failed.");
  } finally {
    setControlsDisabled(panel, false);
  }
}

export function closePanel(): void {
  activePanel?.remove();
  activePanel = null;
  activeAnchor = null;
  activePost = null;
  activePostKey = null;
}

export function syncPanelPosition(): void {
  if (!activePanel || !activeAnchor) return;
  if (!activeAnchor.isConnected) {
    // X rerenders replace post nodes while the user reads drafts. Re-attach to
    // the same post's freshly injected button; close only when the post is gone.
    const target = findReanchorTarget();
    if (!target) {
      closePanel();
      return;
    }
    activeAnchor = target.anchor;
    activePost = target.post;
  }
  positionPanel(activePanel, activeAnchor);
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
    return;
  }

  const context = input.context;
  const details = document.createElement("details");
  details.className = "eks-context-details";
  const summary = document.createElement("summary");
  summary.textContent = "Extracted context";

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

  details.append(summary, list);
  container.append(details);
}

function populateToneSelect(select: HTMLSelectElement): void {
  for (const [value, label] of Object.entries(TONE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
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
      settings?: { toneDefault?: Tone; draftCount?: number; maxReplyLength?: number };
    };
    if (!response.ok || !response.settings) return;

    // A fast user can click tone/draft-count before this fetch resolves (e.g.
    // right after opening the panel while the service worker is still
    // waking up). Don't silently revert a choice they already made.
    if (panel.dataset.controlsTouched !== "true") {
      const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
      if (toneSelect && response.settings.toneDefault) {
        toneSelect.value = response.settings.toneDefault;
      }
      if (response.settings.draftCount) {
        setDraftCountGroup(panel, response.settings.draftCount);
      }
    }
    if (response.settings.maxReplyLength) {
      panel.dataset.maxLength = String(response.settings.maxReplyLength);
    }
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
  renderSkeleton(panel, readDraftCount(panel) ?? 3);
  try {
    // Max length comes from the popup settings; tone, draft count, and a
    // one-off extra instruction can be overridden per-generation via the
    // panel's own controls (fall back to the settings defaults when
    // untouched — the extra instruction is added on top of the standing
    // instruction, not a replacement for it, see serviceWorker.ts).
    const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
    const tone = (toneSelect?.value || undefined) as Tone | undefined;
    const count = readDraftCount(panel);
    const extraInstruction = readExtraInstruction(panel);
    const response = await sendRuntimeMessage<{ ok: true; data: GenerateReplyResponse; historyId?: string }>({
      type: "GENERATE_REPLY",
      input: { ...context, tone, count, extraInstruction },
    });
    renderReplies(panel, toPanelReplies(response.data.replies, response.historyId), context);
    renderUsage(panel, response.data.usage);
    showStatus(panel, "Replies generated.");
  } catch (error) {
    renderReplies(panel, [], context);
    showStatus(panel, error instanceof Error ? error.message : "Reply generation failed.");
  } finally {
    setPanelLoading(panel, false);
  }
}

export function openPanel(anchor: HTMLButtonElement, post: HTMLElement, input: PanelInput): void {
  if (activeAnchor === anchor && activePanel) {
    closePanel();
    return;
  }

  closePanel();
  const panel = document.createElement("section");
  panel.className = "eks-reply-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI reply drafts");
  panel.dataset.maxLength = "220";
  panel.innerHTML = `
    <header>
      <strong>AI Reply</strong>
      <button type="button" class="eks-panel-close" data-panel-close="true" aria-label="Close">×</button>
    </header>
    <div data-context></div>
    <div data-reply-controls>
      <div class="eks-panel-config">
        <label class="eks-tone-label">
          Tone
          <select data-tone-select></select>
        </label>
        <div class="eks-count-label">
          Drafts
          <div class="eks-count-group" data-count-group role="group" aria-label="Number of drafts">
            <button type="button" data-count="1" aria-pressed="false">1</button>
            <button type="button" data-count="2" aria-pressed="false">2</button>
            <button type="button" data-count="3" aria-pressed="true">3</button>
          </div>
        </div>
      </div>
      <details class="eks-extra-details">
        <summary>Add instruction for this reply</summary>
        <textarea data-extra-instruction rows="2" placeholder="e.g. mention the airdrop"></textarea>
      </details>
      <div class="eks-panel-toolbar">
        <button type="button" data-generate-button>Generate</button>
        <span class="eks-panel-usage" data-usage></span>
      </div>
      <div data-reply-list></div>
      <p class="eks-panel-note">Reply posting stays manual. Extension never clicks X/Twitter's final publish button.</p>
    </div>
    <p class="eks-panel-status" data-panel-status aria-live="polite"></p>
  `;

  renderContext(panel, input);
  panel.querySelector(".eks-panel-close")?.addEventListener("click", closePanel);

  const toneSelect = panel.querySelector<HTMLSelectElement>("[data-tone-select]");
  if (toneSelect) {
    populateToneSelect(toneSelect);
    toneSelect.addEventListener("change", () => {
      panel.dataset.controlsTouched = "true";
    });
  }

  panel.querySelector("[data-count-group]")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-count]");
    if (!button) return;
    panel.dataset.controlsTouched = "true";
    setDraftCountGroup(panel, Number(button.dataset.count));
  });

  void initPanelSettings(panel);

  document.body.append(panel);
  activePanel = panel;
  activeAnchor = anchor;
  activePost = post;
  activePostKey = getPostKey(post);
  positionPanel(panel, anchor);
  renderUsage(panel);

  if (!("error" in input)) {
    panel.querySelector<HTMLButtonElement>("[data-generate-button]")?.addEventListener("click", () => {
      void generateRepliesForPanel(panel, input.context);
    });
  }
}

window.addEventListener("resize", queuePanelPosition);
window.addEventListener("scroll", queuePanelPosition, { capture: true, passive: true });

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePanel();
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (!(target instanceof Node) || !activePanel || !activeAnchor) return;
  if (!activePanel.contains(target) && !activeAnchor.contains(target)) closePanel();
});
