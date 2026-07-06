import { FAKE_REPLIES, TONE_LABELS } from "../shared/constants";
import type { ExtractedPostContext, Tone } from "../shared/types";

type PanelInput =
  | { context: ExtractedPostContext }
  | { error: string };

let activePanel: HTMLElement | null = null;
let activeAnchor: HTMLButtonElement | null = null;
let positionQueued = false;

function positionPanel(panel: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(380, window.innerWidth - 24);
  const left = Math.min(
    Math.max(12, rect.left),
    Math.max(12, window.innerWidth - width - 12),
  );
  const preferredTop = rect.bottom + 8;
  const top =
    preferredTop + 440 < window.innerHeight
      ? preferredTop
      : Math.max(12, rect.top - 448);

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

function renderReplies(panel: HTMLElement, tone: Tone): void {
  const list = panel.querySelector<HTMLElement>("[data-reply-list]");
  if (!list) return;
  list.replaceChildren();

  for (const reply of FAKE_REPLIES[tone]) {
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
    insertButton.addEventListener("click", () => {
      showStatus(panel, "Composer insertion arrives in Milestone 4.");
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

export function openPanel(anchor: HTMLButtonElement, input: PanelInput): void {
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
      <button type="button" class="eks-panel-close" aria-label="Close">×</button>
    </header>
    <div data-context></div>
    <div data-reply-controls>
      <label class="eks-tone-label">
        Tone
        <select data-tone-selector></select>
      </label>
      <div data-reply-list></div>
      <p class="eks-panel-note">Prototype replies only. You remain in control of publishing.</p>
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
  selector.addEventListener("change", () => renderReplies(panel, selector.value as Tone));
  panel.querySelector(".eks-panel-close")?.addEventListener("click", closePanel);

  document.body.append(panel);
  activePanel = panel;
  activeAnchor = anchor;
  positionPanel(panel, anchor);
  renderReplies(panel, "degen");
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
