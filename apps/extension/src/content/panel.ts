import { DEFAULT_SETTINGS, TONE_LABELS } from "../shared/constants";
import { insertReplyIntoComposer } from "./replyComposer";
import type {
  ExtensionSettings,
  ExtractedPostContext,
  GenerateReplyRequest,
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
let positionQueued = false;

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as {
    ok: boolean;
    settings?: ExtensionSettings;
    data?: GenerateReplyResponse;
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

function renderUsage(panel: HTMLElement, usage?: GenerateReplyResponse["usage"]): void {
  const usageNode = panel.querySelector<HTMLElement>("[data-usage]");
  if (!usageNode) return;
  if (!usage) {
    usageNode.textContent = "Set backend URL + token, then generate.";
    return;
  }
  const remaining = usage.remainingToday === null ? "?" : String(usage.remainingToday);
  usageNode.textContent = `Plan ${usage.plan} • ${remaining} left today`;
}

function renderReplies(panel: HTMLElement, replies: GeneratedReply[]): void {
  const list = panel.querySelector<HTMLElement>("[data-reply-list]");
  if (!list) return;
  list.replaceChildren();

  for (const reply of replies) {
    const item = document.createElement("article");
    item.className = "eks-reply-option";

    const text = document.createElement("p");
    text.textContent = reply.text;

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

    const insertButton = document.createElement("button");
    insertButton.type = "button";
    insertButton.textContent = "Insert";
    insertButton.addEventListener("click", async () => {
      if (!activePost) return;
      try {
        await insertReplyIntoComposer(activePost, reply.text);
        showStatus(panel, "Reply inserted into composer.");
      } catch (error) {
        showStatus(
          panel,
          error instanceof Error ? error.message : "Composer insertion failed.",
        );
      }
    });

    actions.append(copyButton, insertButton);
    item.append(text, actions);
    list.append(item);
  }
}

export function closePanel(): void {
  activePanel?.remove();
  activePanel = null;
  activeAnchor = null;
  activePost = null;
}

export function syncPanelPosition(): void {
  if (!activePanel || !activeAnchor) return;
  if (!activeAnchor.isConnected) {
    closePanel();
    return;
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

async function hydrateSettings(panel: HTMLElement): Promise<void> {
  const response = await sendRuntimeMessage<{ ok: true; settings: ExtensionSettings }>({
    type: "GET_SETTINGS",
  });
  const settings = response.settings;
  panel.querySelector<HTMLInputElement>("[data-backend-url]")!.value = settings.backendBaseUrl;
  panel.querySelector<HTMLInputElement>("[data-auth-token]")!.value = settings.authToken;
  panel.querySelector<HTMLSelectElement>("[data-tone-selector]")!.value = settings.toneDefault;
  renderUsage(panel);
}

async function persistSettings(panel: HTMLElement): Promise<ExtensionSettings> {
  const settings: ExtensionSettings = {
    backendBaseUrl: panel.querySelector<HTMLInputElement>("[data-backend-url]")!.value.trim(),
    authToken: panel.querySelector<HTMLInputElement>("[data-auth-token]")!.value.trim(),
    toneDefault: panel.querySelector<HTMLSelectElement>("[data-tone-selector]")!.value as Tone,
  };
  const response = await sendRuntimeMessage<{ ok: true; settings: ExtensionSettings }>({
    type: "SAVE_SETTINGS",
    settings,
  });
  return response.settings;
}

async function generateRepliesForPanel(
  panel: HTMLElement,
  context: ExtractedPostContext,
): Promise<void> {
  setPanelLoading(panel, true);
  try {
    const settings = await persistSettings(panel);
    const input: GenerateReplyRequest = {
      ...context,
      tone: panel.querySelector<HTMLSelectElement>("[data-tone-selector]")!.value as Tone,
      extraInstruction: panel.querySelector<HTMLTextAreaElement>("[data-extra-instruction]")!.value.trim() || undefined,
      count: 3,
    };
    const response = await sendRuntimeMessage<{ ok: true; data: GenerateReplyResponse }>({
      type: "GENERATE_REPLY",
      input,
      settings,
    });
    renderReplies(panel, response.data.replies);
    renderUsage(panel, response.data.usage);
    showStatus(panel, "Replies generated.");
  } catch (error) {
    renderReplies(panel, []);
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
  panel.innerHTML = `
    <header>
      <strong>AI Reply</strong>
      <button type="button" class="eks-panel-close" data-panel-close="true" aria-label="Close">×</button>
    </header>
    <div data-context></div>
    <div data-reply-controls>
      <label class="eks-tone-label">
        Backend URL
        <input type="url" data-backend-url placeholder="${DEFAULT_SETTINGS.backendBaseUrl}" />
      </label>
      <label class="eks-tone-label">
        Auth token
        <input type="password" data-auth-token placeholder="${DEFAULT_SETTINGS.authToken}" />
      </label>
      <label class="eks-tone-label">
        Tone
        <select data-tone-selector></select>
      </label>
      <label class="eks-tone-label">
        Extra instruction
        <textarea rows="3" data-extra-instruction placeholder="Optional direction for this reply batch"></textarea>
      </label>
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

  const selector = panel.querySelector<HTMLSelectElement>("[data-tone-selector]");
  if (!selector) return;
  for (const [value, label] of Object.entries(TONE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    selector.append(option);
  }
  panel.querySelector(".eks-panel-close")?.addEventListener("click", closePanel);

  document.body.append(panel);
  activePanel = panel;
  activeAnchor = anchor;
  activePost = post;
  positionPanel(panel, anchor);
  renderUsage(panel);

  if (!("error" in input)) {
    panel.querySelector<HTMLButtonElement>("[data-generate-button]")?.addEventListener("click", () => {
      void generateRepliesForPanel(panel, input.context);
    });
    void hydrateSettings(panel);
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
