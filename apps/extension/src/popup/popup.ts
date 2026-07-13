import {
  clampReplyLength,
  DEFAULT_SETTINGS_PARTIAL,
  MAX_BLOCKED_TERMS,
  normalizeBlockedTerms,
  TONE_AUTO_LABEL,
  TONE_LABELS,
} from "../shared/constants";
import type {
  ConnectionStatus,
  ExtensionSettings,
  HistoryEntry,
  ModelOption,
  ModelsResponse,
  ReadImagesMode,
  Tone,
  UsageStats,
} from "../shared/types";

type RuntimeResponse = {
  ok: boolean;
  settings?: ExtensionSettings;
  connection?: ConnectionStatus;
  usageStats?: UsageStats;
  error?: string;
  models?: ModelsResponse;
};

type View = "home" | "history" | "tone" | "advanced";
type HistoryFilter = "all" | "reply" | "quote" | "not-inserted";

const viewPanels = {
  home: document.getElementById("view-home") as HTMLElement,
  history: document.getElementById("view-history") as HTMLElement,
  tone: document.getElementById("view-tone") as HTMLElement,
  advanced: document.getElementById("view-advanced") as HTMLElement,
} satisfies Record<View, HTMLElement>;
const bottomNav = document.getElementById("bottom-nav") as HTMLElement;
const viewContent = document.querySelector<HTMLElement>(".view-content")!;
const navButtons = Array.from(bottomNav.querySelectorAll<HTMLButtonElement>(".nav-button"));

const clearHistoryButton = document.getElementById("clear-history") as HTMLButtonElement;
const statGenerations = document.getElementById("stat-generations") as HTMLElement;
const statInserted = document.getElementById("stat-inserted") as HTMLElement;
const statTokens = document.getElementById("stat-tokens") as HTMLElement;
const statCost = document.getElementById("stat-cost") as HTMLElement;
const usageFeedback = document.getElementById("usage-feedback") as HTMLElement;
const historyList = document.getElementById("history-list") as HTMLElement;
const historyTabs = document.getElementById("history-tabs") as HTMLElement;

const onboardingCard = document.getElementById("onboarding-card") as HTMLElement;
const onboardingSetupButton = document.getElementById("onboarding-setup-button") as HTMLButtonElement;
const statusCard = document.getElementById("status-card") as HTMLElement;
const connectionTitle = document.getElementById("connection-title") as HTMLElement;
const connectionDetail = document.getElementById("connection-detail") as HTMLElement;
const testButton = document.getElementById("test-connection") as HTMLButtonElement;
const headerLinks = document.getElementById("header-links") as HTMLElement;
const headerConnectionFeedback = document.getElementById("header-connection-feedback") as HTMLElement;
const headerFeedbackText = document.getElementById("header-feedback-text") as HTMLElement;
const backendUrlInput = document.getElementById("backend-url") as HTMLInputElement;
const authTokenInput = document.getElementById("auth-token") as HTMLInputElement;
const authTokenToggle = document.getElementById("toggle-auth-token") as HTMLButtonElement;
const toneSelect = document.getElementById("tone-default") as HTMLSelectElement;
const instructionInput = document.getElementById("default-instruction") as HTMLTextAreaElement;
const blockedTermsInput = document.getElementById("blocked-terms") as HTMLTextAreaElement;
const blockedTermsCount = document.getElementById("blocked-terms-count") as HTMLElement;
const maxLengthInput = document.getElementById("max-length") as HTMLInputElement;
const maxLengthSlider = document.getElementById("max-length-slider") as HTMLInputElement;
const maxLengthManualRow = document.getElementById("max-length-manual-row") as HTMLElement;
const maxLengthModeGroup = document.getElementById("max-length-mode") as HTMLElement;
const maxLengthModeButtons = Array.from(maxLengthModeGroup.querySelectorAll<HTMLButtonElement>("button"));
const maxLengthPresetGroup = document.getElementById("max-length-preset") as HTMLElement;
const maxLengthPresetButtons = Array.from(maxLengthPresetGroup.querySelectorAll<HTMLButtonElement>("button"));
const draftCountGroup = document.getElementById("draft-count") as HTMLElement;
const draftCountButtons = Array.from(draftCountGroup.querySelectorAll<HTMLButtonElement>("button"));
const useEmojiGroup = document.getElementById("use-emoji") as HTMLElement;
const useEmojiButtons = Array.from(useEmojiGroup.querySelectorAll<HTMLButtonElement>("button"));
const readImagesGroup = document.getElementById("read-images") as HTMLElement;
const readImagesButtons = Array.from(readImagesGroup.querySelectorAll<HTMLButtonElement>("button"));
const saveAdvancedButton = document.getElementById("save-advanced") as HTMLButtonElement;
const statusToneNode = document.getElementById("status-tone") as HTMLParagraphElement;
const statusAdvancedNode = document.getElementById("status-advanced") as HTMLParagraphElement;
const aiModelSelect = document.getElementById("ai-model-select") as HTMLSelectElement;
const aiModelCustomRow = document.getElementById("ai-model-custom-row") as HTMLElement;
const aiModelCustomInput = document.getElementById("ai-model-custom") as HTMLInputElement;
const aiModelTestButton = document.getElementById("ai-model-test") as HTMLButtonElement;
const statusAiModelNode = document.getElementById("status-ai-model") as HTMLParagraphElement;
const quickTonesRow = document.getElementById("quick-tones-row") as HTMLElement;
const favoriteTonesGrid = document.getElementById("favorite-tones-grid") as HTMLElement;
const favoriteTonesCount = document.getElementById("favorite-tones-count") as HTMLElement;
const toneSubtabs = document.getElementById("tone-subtabs") as HTMLElement;
const toneSubpanels = {
  tone: document.getElementById("tone-subpanel-tone") as HTMLElement,
  defaults: document.getElementById("tone-subpanel-defaults") as HTMLElement,
  rules: document.getElementById("tone-subpanel-rules") as HTMLElement,
};
const advancedSubtabs = document.getElementById("advanced-subtabs") as HTMLElement;
const advancedSubpanels = {
  connection: document.getElementById("advanced-subpanel-connection") as HTMLElement,
  model: document.getElementById("advanced-subpanel-model") as HTMLElement,
};
const infoTooltip = document.getElementById("info-tooltip") as HTMLElement;
const infoIcons = Array.from(document.querySelectorAll<HTMLButtonElement>(".info-icon[data-tip]"));

const MAX_FAVORITE_TONES = 5;

let connectionCheckId = 0;
let headerFeedbackTimer: number | undefined;
let usageLoadId = 0;
let settingsLoadId = 0;
let modelLoadId = 0;
let draftCount = 3;
let useEmoji = true;
let readImages: ReadImagesMode = "auto";
let maxLengthMode: "auto" | "manual" = "manual";
let latestUsageStats: UsageStats = { totalGenerations: 0, totalInserted: 0, history: [] };
let historyFilter: HistoryFilter = "all";
let favoriteTones: Tone[] = [];
let pendingAiModelValue = "";
let modelOptions: ModelOption[] = [];
let allowCustomModel = true;
let modelsLoaded = false;
// Guards saveSettings() from firing before loadSettings() has populated the
// inputs at least once. Auto-save reads every input's current .value,
// including backendUrlInput/authTokenInput, which start out empty in the
// static HTML — a control clicked fast enough to race the initial
// GET_SETTINGS round-trip would otherwise save those as blank, clobbering
// the user's configured backend/token.
let settingsLoaded = false;

const TOOLTIP_GAP = 8;
const TOOLTIP_VIEWPORT_MARGIN = 8;
let activeTooltipIcon: HTMLButtonElement | null = null;
let keyboardNavigation = false;

function positionInfoTooltip(icon: HTMLButtonElement): void {
  const iconRect = icon.getBoundingClientRect();
  const tooltipRect = infoTooltip.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  // Prefer above so a field's tooltip does not cover the control directly
  // below its label. Fall back below when the tooltip would hit the top.
  const spaceAbove = iconRect.top - TOOLTIP_GAP - TOOLTIP_VIEWPORT_MARGIN;
  const top = spaceAbove >= tooltipRect.height
    ? iconRect.top - tooltipRect.height - TOOLTIP_GAP
    : Math.min(
      iconRect.bottom + TOOLTIP_GAP,
      viewportHeight - tooltipRect.height - TOOLTIP_VIEWPORT_MARGIN,
    );
  const centeredLeft = iconRect.left + (iconRect.width - tooltipRect.width) / 2;
  const left = Math.max(
    TOOLTIP_VIEWPORT_MARGIN,
    Math.min(centeredLeft, viewportWidth - tooltipRect.width - TOOLTIP_VIEWPORT_MARGIN),
  );

  infoTooltip.style.left = `${Math.round(left)}px`;
  infoTooltip.style.top = `${Math.round(Math.max(TOOLTIP_VIEWPORT_MARGIN, top))}px`;
}

function openInfoTooltip(icon: HTMLButtonElement): void {
  if (!icon.isConnected || icon.offsetParent === null) return;
  if (activeTooltipIcon !== icon) {
    activeTooltipIcon?.removeAttribute("aria-describedby");
    activeTooltipIcon?.removeAttribute("data-tooltip-active");
  }
  activeTooltipIcon = icon;
  infoTooltip.textContent = icon.dataset.tip || "";
  infoTooltip.dataset.open = "true";
  infoTooltip.setAttribute("aria-hidden", "false");
  icon.setAttribute("aria-describedby", "info-tooltip");
  icon.dataset.tooltipActive = "true";
  positionInfoTooltip(icon);
}

function closeInfoTooltip(): void {
  activeTooltipIcon?.removeAttribute("aria-describedby");
  activeTooltipIcon?.removeAttribute("data-tooltip-active");
  activeTooltipIcon = null;
  infoTooltip.dataset.open = "false";
  infoTooltip.setAttribute("aria-hidden", "true");
}

// CSS :hover can become active when a view is revealed under a stationary
// cursor, which made the warning appear before the user touched its icon.
// A real pointermove whose coordinates are inside the icon is required for
// mouse hover instead. Listening at document level also guarantees that
// moving from the icon into a label's input closes the tooltip immediately.
for (const icon of infoIcons) {
  icon.addEventListener("click", () => openInfoTooltip(icon));
  icon.addEventListener("focus", () => {
    if (keyboardNavigation) openInfoTooltip(icon);
  });
  icon.addEventListener("blur", () => {
    if (activeTooltipIcon === icon) closeInfoTooltip();
  });
}

document.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse") return;
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>(".info-icon[data-tip]")
    : null;
  if (target) {
    const rect = target.getBoundingClientRect();
    const directlyInside = event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
    if (directlyInside) {
      openInfoTooltip(target);
      return;
    }
  }
  closeInfoTooltip();
});

// pointermove only fires while the cursor stays inside the document, so a
// mouse leaving the popup's viewport entirely (its own small window) without
// another move event never reaches the handler above and the tooltip would
// stay open forever. relatedTarget is null exactly when the pointer exits
// the document, which pointerout still reports.
document.addEventListener("pointerout", (event) => {
  if (event.pointerType === "mouse" && event.relatedTarget === null) closeInfoTooltip();
});

document.addEventListener("keydown", (event) => {
  keyboardNavigation = true;
  if (event.key === "Escape") closeInfoTooltip();
});
document.addEventListener("pointerdown", (event) => {
  keyboardNavigation = false;
  if (!(event.target as Element).closest(".info-icon")) closeInfoTooltip();
});
document.addEventListener("scroll", () => {
  if (activeTooltipIcon) positionInfoTooltip(activeTooltipIcon);
}, true);
window.addEventListener("resize", () => {
  if (activeTooltipIcon) positionInfoTooltip(activeTooltipIcon);
});

function switchView(view: View): void {
  if (view !== "advanced") setAuthTokenVisible(false);
  viewContent.dataset.activeView = view;
  for (const [name, panel] of Object.entries(viewPanels) as [View, HTMLElement][]) {
    panel.hidden = name !== view;
  }
  for (const button of navButtons) {
    button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false");
  }
  if (view === "home") {
    void checkConnection();
    void loadUsageStats("home");
  } else if (view === "history") {
    void loadUsageStats("history");
  } else if (view === "tone") {
    void loadSettings(statusToneNode);
  } else if (view === "advanced") {
    void loadSettings(statusAdvancedNode);
    void loadModelOptions();
  }
}

function spinNavIcon(button: HTMLButtonElement): void {
  button.classList.remove("spin");
  // Force a reflow so re-adding the class restarts the animation even on
  // rapid repeat clicks of the same tab.
  void button.offsetWidth;
  button.classList.add("spin");
}

bottomNav.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".nav-button");
  if (!button) return;
  spinNavIcon(button);
  switchView((button.dataset.view as View) || "home");
});

// Purely presentational grouping within a single view (e.g. Tone's
// "Tone" vs "Reply defaults", Advanced's "Connection" vs "AI Model") — all
// inputs stay mounted regardless of which sub-tab is active, so nothing
// here touches settings load/save.
function wireSubTabs(
  tabs: HTMLElement,
  panels: Record<string, HTMLElement>,
  getTarget: (button: HTMLButtonElement) => string | undefined,
): void {
  tabs.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".tab");
    const target = button ? getTarget(button) : undefined;
    if (!button || !target || !(target in panels)) return;
    tabs.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab === button));
      tab.tabIndex = tab === button ? 0 : -1;
    });
    for (const [name, panel] of Object.entries(panels)) {
      panel.hidden = name !== target;
    }
  });
}

wireSubTabs(toneSubtabs, toneSubpanels, (button) => button.dataset.toneSubtab);
wireSubTabs(advancedSubtabs, advancedSubpanels, (button) => button.dataset.advancedSubtab);

function setAuthTokenVisible(visible: boolean): void {
  authTokenInput.type = visible ? "text" : "password";
  authTokenToggle.setAttribute("aria-pressed", String(visible));
  authTokenToggle.setAttribute("aria-label", visible ? "Hide access token" : "Show access token");
}

authTokenToggle.addEventListener("click", () => {
  setAuthTokenVisible(authTokenInput.type === "password");
});

advancedSubtabs.addEventListener("click", (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-advanced-subtab]");
  if (tab?.dataset.advancedSubtab === "model") setAuthTokenVisible(false);
});

function wireTabKeyboard(tabs: HTMLElement): void {
  tabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (!current || buttons.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, buttons.indexOf(current));
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % buttons.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = buttons.length - 1;
    buttons[nextIndex]?.click();
    buttons[nextIndex]?.focus();
  });
}

wireTabKeyboard(historyTabs);
wireTabKeyboard(toneSubtabs);
wireTabKeyboard(advancedSubtabs);

function setDraftCount(count: number): void {
  draftCount = count;
  for (const button of draftCountButtons) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.count) === count));
  }
}

function setUseEmoji(value: boolean): void {
  useEmoji = value;
  for (const button of useEmojiButtons) {
    button.setAttribute("aria-pressed", String((button.dataset.emoji === "on") === value));
  }
}

function setReadImages(value: ReadImagesMode): void {
  readImages = value;
  for (const button of readImagesButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.images === value));
  }
}

function setMaxLengthMode(mode: "auto" | "manual"): void {
  maxLengthMode = mode;
  for (const button of maxLengthModeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.lengthMode === mode));
  }
  maxLengthInput.disabled = mode === "auto";
  maxLengthSlider.disabled = mode === "auto";
  // Auto has no numeric target to show — hide the slider/value row entirely
  // instead of leaving a disabled, dead control taking up space.
  maxLengthManualRow.hidden = mode === "auto";
}

draftCountGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-count]");
  if (!button) return;
  setDraftCount(Number(button.dataset.count));
  saveToneSettings();
});

useEmojiGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-emoji]");
  if (!button) return;
  setUseEmoji(button.dataset.emoji === "on");
  saveToneSettings();
});

readImagesGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-images]");
  if (!button) return;
  setReadImages(button.dataset.images === "on" ? "on" : button.dataset.images === "off" ? "off" : "auto");
  saveToneSettings();
});

maxLengthModeGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-length-mode]");
  if (!button) return;
  setMaxLengthMode(button.dataset.lengthMode === "auto" ? "auto" : "manual");
  saveToneSettings();
});

function syncMaxLengthPreset(): void {
  const current = Number(maxLengthInput.value);
  for (const button of maxLengthPresetButtons) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.lengthPreset) === current));
  }
}

maxLengthInput.addEventListener("input", () => {
  maxLengthSlider.value = String(clampReplyLength(Number(maxLengthInput.value)));
  syncMaxLengthPreset();
});

// "change" (fires once on blur/commit), not "input" (fires on every
// keystroke) — avoids clamping/saving mid-type on every digit (typing "4",
// then "40", then "400" toward 4000 would otherwise get snapped to 50 after
// the first keystroke).
maxLengthInput.addEventListener("change", () => {
  maxLengthInput.value = String(clampReplyLength(Number(maxLengthInput.value)));
  maxLengthSlider.value = maxLengthInput.value;
  syncMaxLengthPreset();
  saveToneSettings();
});

maxLengthSlider.addEventListener("input", () => {
  maxLengthInput.value = maxLengthSlider.value;
  syncMaxLengthPreset();
});
maxLengthSlider.addEventListener("change", saveToneSettings);

maxLengthPresetGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-length-preset]");
  if (!button?.dataset.lengthPreset) return;
  maxLengthInput.value = button.dataset.lengthPreset;
  maxLengthSlider.value = maxLengthInput.value;
  syncMaxLengthPreset();
  saveToneSettings();
});

toneSelect.addEventListener("change", () => {
  syncQuickTonesActive();
  saveToneSettings();
});
instructionInput.addEventListener("input", saveToneSettingsDebounced);

function readBlockedTerms(): string[] {
  return normalizeBlockedTerms(blockedTermsInput.value.split(/\r?\n/));
}

function syncBlockedTermsCount(): void {
  blockedTermsCount.textContent = `${readBlockedTerms().length}/${MAX_BLOCKED_TERMS}`;
}

blockedTermsInput.addEventListener("input", () => {
  syncBlockedTermsCount();
  saveToneSettingsDebounced();
});
blockedTermsInput.addEventListener("change", () => {
  blockedTermsInput.value = readBlockedTerms().join("\n");
  syncBlockedTermsCount();
});

function syncQuickTonesActive(): void {
  quickTonesRow.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.tone === toneSelect.value));
  });
}

function renderQuickTones(): void {
  quickTonesRow.replaceChildren();
  quickTonesRow.hidden = favoriteTones.length === 0;
  for (const tone of favoriteTones) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tone = tone;
    button.textContent = TONE_LABELS[tone] ?? tone;
    button.setAttribute("aria-pressed", String(tone === toneSelect.value));
    quickTonesRow.append(button);
  }
}

quickTonesRow.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tone]");
  if (!button?.dataset.tone) return;
  toneSelect.value = button.dataset.tone;
  syncQuickTonesActive();
  saveToneSettings();
});

function renderFavoriteTonesGrid(): void {
  favoriteTonesGrid.replaceChildren();
  favoriteTonesCount.textContent = `${favoriteTones.length}/${MAX_FAVORITE_TONES}`;
  const atCap = favoriteTones.length >= MAX_FAVORITE_TONES;
  for (const [value, label] of Object.entries(TONE_LABELS)) {
    const pinned = favoriteTones.includes(value as Tone);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tone = value;
    button.textContent = label;
    button.setAttribute("aria-pressed", String(pinned));
    button.disabled = !pinned && atCap;
    favoriteTonesGrid.append(button);
  }
}

favoriteTonesGrid.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tone]");
  if (!button?.dataset.tone) return;
  const tone = button.dataset.tone as Tone;
  if (favoriteTones.includes(tone)) {
    favoriteTones = favoriteTones.filter((item) => item !== tone);
  } else if (favoriteTones.length < MAX_FAVORITE_TONES) {
    favoriteTones = [...favoriteTones, tone];
  } else {
    return;
  }
  renderFavoriteTonesGrid();
  renderQuickTones();
  saveToneSettings();
});

const AI_MODEL_CUSTOM_VALUE = "__custom__";

function renderModelSelect(models: ModelOption[], allowCustom: boolean): void {
  aiModelSelect.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Use backend default";
  aiModelSelect.append(defaultOption);
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name || model.id;
    aiModelSelect.append(option);
  }
  if (allowCustom) {
    const customOption = document.createElement("option");
    customOption.value = AI_MODEL_CUSTOM_VALUE;
    customOption.textContent = "Custom…";
    aiModelSelect.append(customOption);
  }
}

// Reconciles the dropdown/custom-input UI with pendingAiModelValue —
// called after either the saved settings or the model list (fetched
// independently, in either order) finishes loading.
function syncAiModelUi(): void {
  const isKnown = pendingAiModelValue === "" || modelOptions.some((model) => model.id === pendingAiModelValue);
  if (isKnown) {
    aiModelSelect.value = pendingAiModelValue;
    aiModelCustomRow.hidden = true;
    return;
  }
  if (allowCustomModel) {
    aiModelSelect.value = AI_MODEL_CUSTOM_VALUE;
    aiModelCustomInput.value = pendingAiModelValue;
    aiModelCustomRow.hidden = false;
    return;
  }
  // Saved value isn't in the allowlist and custom models are disabled
  // (e.g. the operator tightened AI_ALLOWED_MODELS after this was saved) —
  // fall back to the default rather than showing a selection that can't
  // actually be chosen anymore.
  aiModelSelect.value = "";
  aiModelCustomRow.hidden = true;
}

async function loadModelOptions(): Promise<void> {
  if (modelsLoaded) return;
  const loadId = ++modelLoadId;
  const loadingMessage = "Loading models…";
  showStatus(statusAiModelNode, loadingMessage, "loading");
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_MODELS" }) as RuntimeResponse;
    // A newer request was started after the backend URL/token changed (or a
    // second load superseded this one). Never let the old backend overwrite
    // the newer catalog, selection, or status message.
    if (loadId !== modelLoadId) return;
    if (!response.ok || !response.models) {
      showStatus(statusAiModelNode, response.error || "Could not load model list.", "error");
      return;
    }
    modelOptions = response.models.models;
    allowCustomModel = response.models.allowCustom;
    modelsLoaded = true;
    renderModelSelect(modelOptions, allowCustomModel);
    syncAiModelUi();
    if (statusAiModelNode.textContent === loadingMessage) clearStatus(statusAiModelNode);
  } catch (error) {
    if (loadId !== modelLoadId) return;
    showStatus(statusAiModelNode, error instanceof Error ? error.message : "Could not load model list.", "error");
  }
}

aiModelSelect.addEventListener("change", () => {
  if (aiModelSelect.value === AI_MODEL_CUSTOM_VALUE) {
    aiModelCustomRow.hidden = false;
    pendingAiModelValue = aiModelCustomInput.value.trim();
  } else {
    aiModelCustomRow.hidden = true;
    pendingAiModelValue = aiModelSelect.value;
  }
});

aiModelCustomInput.addEventListener("input", () => {
  pendingAiModelValue = aiModelCustomInput.value.trim();
});

async function testAiModel(): Promise<void> {
  const model = aiModelCustomInput.value.trim();
  if (!model) {
    showStatus(statusAiModelNode, "Type a model ID to test.", "error");
    return;
  }
  aiModelTestButton.disabled = true;
  showStatus(statusAiModelNode, "Testing…", "loading");
  try {
    const response = await chrome.runtime.sendMessage({ type: "TEST_MODEL", model }) as RuntimeResponse;
    showStatus(
      statusAiModelNode,
      response.ok ? "✓ Model works." : response.error || "Test failed.",
      response.ok ? "info" : "error",
    );
  } catch (error) {
    showStatus(statusAiModelNode, error instanceof Error ? error.message : "Test failed.", "error");
  } finally {
    aiModelTestButton.disabled = false;
  }
}

aiModelTestButton.addEventListener("click", () => void testAiModel());

historyTabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-history-filter]");
  if (!button) return;
  historyFilter = (button.dataset.historyFilter as HistoryFilter) || "all";
  historyTabs.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab === button));
    tab.tabIndex = tab === button ? 0 : -1;
  });
  historyList.setAttribute("aria-labelledby", button.id);
  renderHistoryList(latestUsageStats.history);
});

const statusTimers = new WeakMap<HTMLElement, number>();

function showStatus(
  node: HTMLElement,
  message: string,
  state: "info" | "error" | "loading" = "info",
): void {
  const existingTimer = statusTimers.get(node);
  if (existingTimer) window.clearTimeout(existingTimer);
  node.textContent = message;
  node.dataset.state = state;
  if (state === "error" || state === "loading") return;
  const timer = window.setTimeout(() => {
    if (node.textContent === message) node.textContent = "";
    node.removeAttribute("data-state");
    statusTimers.delete(node);
  }, 3500);
  statusTimers.set(node, timer);
}

function clearStatus(node: HTMLElement): void {
  const existingTimer = statusTimers.get(node);
  if (existingTimer) window.clearTimeout(existingTimer);
  statusTimers.delete(node);
  node.textContent = "";
  node.removeAttribute("data-state");
}

function renderConnection(state: "unknown" | "connected" | "error", title: string, detail = ""): void {
  statusCard.dataset.state = state;
  connectionTitle.textContent = title;
  connectionDetail.textContent = detail;
}

function hideHeaderConnectionFeedback(): void {
  window.clearTimeout(headerFeedbackTimer);
  headerFeedbackTimer = undefined;
  headerConnectionFeedback.hidden = true;
  headerConnectionFeedback.removeAttribute("title");
  headerLinks.hidden = false;
}

function showHeaderConnectionFeedback(
  state: "testing" | "connected" | "error",
  text: string,
  { duration, detail }: { duration?: number; detail?: string } = {},
): void {
  window.clearTimeout(headerFeedbackTimer);
  headerLinks.hidden = true;
  headerConnectionFeedback.hidden = false;
  headerConnectionFeedback.dataset.state = state;
  headerFeedbackText.textContent = text;
  if (detail) headerConnectionFeedback.title = detail;
  else headerConnectionFeedback.removeAttribute("title");
  if (duration) headerFeedbackTimer = window.setTimeout(hideHeaderConnectionFeedback, duration);
}

const autoToneOption = document.createElement("option");
autoToneOption.value = "auto";
autoToneOption.textContent = TONE_AUTO_LABEL;
toneSelect.append(autoToneOption);

for (const [value, label] of Object.entries(TONE_LABELS)) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  toneSelect.append(option);
}

// Comparing against the shipped dev placeholders (localhost + a fake token)
// is only a SECONDARY signal, checked after a real connection attempt has
// already failed — it can't be trusted on its own to mean "never configured".
// README.md documents that exact pair as a legitimate, working zero-config
// local-dev setup ("just works" against a locally-run backend), so treating
// it as "unconfigured" unconditionally would leave the onboarding card
// stuck on-screen forever for anyone using that documented setup verbatim.
function isBackendConfigured(settings: ExtensionSettings): boolean {
  return settings.backendBaseUrl.trim() !== DEFAULT_SETTINGS_PARTIAL.backendBaseUrl
    || settings.authToken.trim() !== DEFAULT_SETTINGS_PARTIAL.authToken;
}

function renderOnboardingCard(show: boolean): void {
  onboardingCard.hidden = !show;
  statusCard.hidden = show;
}

onboardingSetupButton.addEventListener("click", () => {
  document.querySelector<HTMLButtonElement>("#advanced-tab-connection")?.click();
  switchView("advanced");
  window.setTimeout(() => backendUrlInput.focus(), 0);
});

async function checkConnection(
  { showHeaderFeedback = false }: { showHeaderFeedback?: boolean } = {},
): Promise<void> {
  const checkId = ++connectionCheckId;
  testButton.disabled = true;
  if (showHeaderFeedback) {
    testButton.textContent = "Testing…";
    showHeaderConnectionFeedback("testing", "Testing…");
  }
  renderOnboardingCard(false);
  renderConnection("unknown", "Checking…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "CHECK_CONNECTION" }) as RuntimeResponse;
    if (!response.ok || !response.connection) {
      throw new Error(response.error || "Connection failed.");
    }
    if (checkId !== connectionCheckId) return;
    renderConnection(
      "connected",
      "Connected",
      `Plan ${response.connection.plan} • ${response.connection.remainingToday} replies left today`,
    );
    if (showHeaderFeedback) showHeaderConnectionFeedback("connected", "Connected", { duration: 2500 });
  } catch (error) {
    if (checkId !== connectionCheckId) return;
    // A manual "Test connection" click always shows the real error — the
    // user deliberately asked for this specific test. Passive checks (popup
    // open, switching to Home) instead check whether this looks like a
    // truly untouched install before showing a confusing generic fetch
    // error, since the connection attempt above already ruled out the
    // documented zero-config local-dev setup actually working.
    if (!showHeaderFeedback) {
      const settingsResponse = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }) as RuntimeResponse;
      if (checkId !== connectionCheckId) return;
      if (settingsResponse.ok && settingsResponse.settings && !isBackendConfigured(settingsResponse.settings)) {
        renderOnboardingCard(true);
        return;
      }
    }
    const message = error instanceof Error ? error.message : "Connection failed.";
    renderConnection(
      "error",
      "Not connected",
      message,
    );
    if (showHeaderFeedback) {
      showHeaderConnectionFeedback("error", "Failed", { duration: 5000, detail: message });
    }
  } finally {
    // A stale call's finally must not touch UI state a newer, still-running
    // call owns — otherwise it can reset the button text or hide the header
    // feedback banner while the newer check is still in flight.
    if (checkId === connectionCheckId) {
      testButton.disabled = false;
      if (showHeaderFeedback) testButton.textContent = "Test connection";
    }
  }
}

async function loadSettings(statusNode: HTMLElement): Promise<void> {
  const loadId = ++settingsLoadId;
  const loadingMessage = "Loading settings…";
  if (!settingsLoaded) showStatus(statusNode, loadingMessage, "loading");
  let response: RuntimeResponse;
  try {
    response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }) as RuntimeResponse;
  } catch (error) {
    if (loadId !== settingsLoadId) return;
    showStatus(statusNode, error instanceof Error ? error.message : "Could not load settings.", "error");
    return;
  }
  // A stale response (an older call resolving after a newer one already
  // populated the inputs, or after the user started editing them) must not
  // overwrite what's currently in the form.
  if (loadId !== settingsLoadId) return;
  if (!response.ok || !response.settings) {
    showStatus(statusNode, response.error || "Could not load settings.", "error");
    return;
  }
  settingsLoaded = true;
  backendUrlInput.value = response.settings.backendBaseUrl;
  authTokenInput.value = response.settings.authToken;
  toneSelect.value = response.settings.toneDefault;
  instructionInput.value = response.settings.defaultInstruction;
  blockedTermsInput.value = (response.settings.blockedTerms ?? []).join("\n");
  syncBlockedTermsCount();
  // The input always needs a numeric value to fall back to if the user
  // switches from Auto back to Manual, so it keeps the last-known number (or
  // its own default) even while Auto is active and the input is disabled.
  if (response.settings.maxReplyLength !== "auto") {
    maxLengthInput.value = String(response.settings.maxReplyLength);
    maxLengthSlider.value = maxLengthInput.value;
    syncMaxLengthPreset();
  }
  setMaxLengthMode(response.settings.maxReplyLength === "auto" ? "auto" : "manual");
  setDraftCount(response.settings.draftCount);
  setUseEmoji(response.settings.useEmoji);
  setReadImages(response.settings.readImages);
  favoriteTones = response.settings.favoriteTones ?? [];
  renderFavoriteTonesGrid();
  renderQuickTones();
  pendingAiModelValue = response.settings.aiModel;
  syncAiModelUi();
  if (statusNode.textContent === loadingMessage) clearStatus(statusNode);
}

async function requestBackendPermission(backendBaseUrl: string): Promise<void> {
  // Ask for host access to the user's own backend so requests work even when
  // the server sits behind a proxy that mangles CORS headers. A denial is not
  // fatal: the backend also answers CORS for extension origins.
  try {
    const origin = new URL(backendBaseUrl).origin;
    await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    // Invalid URL or permission denied — the save itself still proceeds.
  }
}

async function saveSettings(
  statusNode: HTMLElement,
  triggerButton?: HTMLButtonElement,
  // Tone/Default fields never touch backendBaseUrl/authToken, so
  // auto-save from that view skips the permission request and connection
  // re-check — they're only meaningful after an Advanced save.
  { checkConnectionAfter = true }: { checkConnectionAfter?: boolean } = {},
): Promise<void> {
  // Inputs haven't been populated from storage yet — saving now would
  // persist their blank/default markup values over whatever's actually
  // stored (see the settingsLoaded comment at its declaration).
  if (!settingsLoaded) return;
  if (triggerButton) triggerButton.disabled = true;
  try {
    const settings: ExtensionSettings = {
      backendBaseUrl: backendUrlInput.value.trim(),
      authToken: authTokenInput.value.trim(),
      toneDefault: toneSelect.value as Tone | "auto",
      defaultInstruction: instructionInput.value.trim(),
      maxReplyLength: maxLengthMode === "auto" ? "auto" : clampReplyLength(Number(maxLengthInput.value)),
      draftCount,
      useEmoji,
      readImages,
      favoriteTones,
      blockedTerms: readBlockedTerms(),
      aiModel: pendingAiModelValue,
    };
    // Persist first: chrome.permissions.request() below can pop a native
    // "allow access" prompt that backgrounds/closes this popup, killing its
    // JS execution before anything after it runs. Saving before that request
    // means a first-time permission prompt can no longer wipe out what the
    // user just typed.
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings,
    }) as RuntimeResponse;
    if (checkConnectionAfter && settings.backendBaseUrl) {
      await requestBackendPermission(settings.backendBaseUrl);
    }
    showStatus(
      statusNode,
      response.ok ? "Settings saved." : response.error || "Save failed.",
      response.ok ? "info" : "error",
    );
    if (response.ok && checkConnectionAfter) {
      void checkConnection();
      // The model list is fetched from whatever backend URL/token was
      // active at load time — an Advanced save can change either, so the
      // cached list would otherwise keep showing the old backend's models
      // until the popup is closed and reopened.
      modelsLoaded = false;
      void loadModelOptions();
    }
  } catch (error) {
    showStatus(statusNode, error instanceof Error ? error.message : "Save failed.", "error");
  } finally {
    if (triggerButton) triggerButton.disabled = false;
  }
}

function saveToneSettings(): void {
  void saveSettings(statusToneNode, undefined, { checkConnectionAfter: false });
}

let instructionSaveTimer: number | undefined;
function saveToneSettingsDebounced(): void {
  window.clearTimeout(instructionSaveTimer);
  instructionSaveTimer = window.setTimeout(saveToneSettings, 600);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function relativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${Math.floor(diffHour / 24)}d ago`;
}

function filterHistory(history: HistoryEntry[], filter: HistoryFilter): HistoryEntry[] {
  switch (filter) {
    case "reply":
      return history.filter((entry) => entry.inserted && entry.insertKind === "reply");
    case "quote":
      return history.filter((entry) => entry.inserted && entry.insertKind === "quote");
    case "not-inserted":
      return history.filter((entry) => !entry.inserted);
    default:
      return history;
  }
}

function insertedLabel(entry: HistoryEntry): string {
  if (entry.insertKind === "quote") return "✓ Inserted as Quote";
  if (entry.insertKind === "reply") return "✓ Inserted as Reply";
  return "✓ Inserted";
}

function renderHistoryList(history: HistoryEntry[]): void {
  const filtered = filterHistory(history, historyFilter);
  historyList.replaceChildren();
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = history.length === 0 ? "No generations yet." : "Nothing here yet.";
    historyList.append(empty);
    return;
  }

  for (const entry of filtered) {
    const item = document.createElement("div");
    item.className = "history-item";

    const text = document.createElement("p");
    text.textContent = `"${truncate(entry.postText, 80)}"`;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const left = document.createElement("span");
    let leftText = `${relativeTime(entry.createdAt)} · ${TONE_LABELS[entry.tone] ?? entry.tone}`;
    if (entry.promptTokens !== undefined && entry.completionTokens !== undefined) {
      leftText += ` · ${(entry.promptTokens + entry.completionTokens).toLocaleString()} tok`;
    }
    left.textContent = leftText;
    let right: HTMLElement;
    if (entry.inserted && entry.postUrl) {
      // We only ever know the URL of the post being replied to, not the
      // resulting reply's own URL — posting stays manual, so the extension
      // never learns what tweet X creates from an insert.
      const link = document.createElement("a");
      link.href = entry.postUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${insertedLabel(entry)} ↗`;
      right = link;
    } else {
      right = document.createElement("span");
      right.textContent = entry.inserted ? insertedLabel(entry) : "Not inserted";
    }
    right.className = "inserted-tag";
    meta.append(left, right);

    item.append(text, meta);
    historyList.append(item);
  }
}

// Typical per-call costs are fractions of a cent — 2 decimals would round
// almost everything to "$0.00", so small amounts get more precision.
function formatCostUsd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function renderUsageStats(stats: UsageStats): void {
  usageFeedback.hidden = true;
  usageFeedback.replaceChildren();
  latestUsageStats = stats;
  statGenerations.textContent = String(stats.totalGenerations);
  statInserted.textContent = String(stats.totalInserted);

  const promptTokens = stats.totalPromptTokens ?? 0;
  const completionTokens = stats.totalCompletionTokens ?? 0;
  const totalTokens = promptTokens + completionTokens;
  // "—" distinguishes "no generation has reported token data yet" from a
  // genuine 0/$0.00, which would otherwise look broken on a fresh install.
  statTokens.textContent = totalTokens > 0 ? totalTokens.toLocaleString() : "—";
  statCost.textContent =
    stats.totalEstimatedCostUsd !== undefined && stats.totalEstimatedCostUsd > 0
      ? formatCostUsd(stats.totalEstimatedCostUsd)
      : "—";

  renderHistoryList(stats.history);
}

type UsageLoadSurface = "home" | "history";

function renderDataFeedback(
  container: HTMLElement,
  state: "loading" | "error",
  message: string,
  retry?: () => void,
): void {
  container.replaceChildren();
  container.hidden = false;
  const feedback = container === usageFeedback ? container : document.createElement("div");
  feedback.className = "data-feedback";
  feedback.dataset.state = state;
  feedback.setAttribute("role", state === "error" ? "alert" : "status");
  if (state === "loading") {
    const spinner = document.createElement("span");
    spinner.className = "data-feedback-spinner";
    spinner.setAttribute("aria-hidden", "true");
    feedback.append(spinner);
  }
  const text = document.createElement("span");
  text.textContent = message;
  feedback.append(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", retry);
    feedback.append(button);
  }
  if (feedback !== container) container.append(feedback);
}

async function loadUsageStats(surface: UsageLoadSurface): Promise<void> {
  const loadId = ++usageLoadId;
  const feedbackContainer = surface === "home" ? usageFeedback : historyList;
  renderDataFeedback(
    feedbackContainer,
    "loading",
    surface === "home" ? "Loading usage…" : "Loading history…",
  );
  if (surface === "home") {
    statGenerations.textContent = "…";
    statInserted.textContent = "…";
    statTokens.textContent = "…";
    statCost.textContent = "…";
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_USAGE_STATS" }) as RuntimeResponse;
    if (!response.ok || !response.usageStats) throw new Error(response.error || "Could not load usage data.");
    if (loadId !== usageLoadId) return;
    renderUsageStats(response.usageStats);
  } catch (error) {
    if (loadId !== usageLoadId) return;
    if (surface === "home") {
      statGenerations.textContent = "—";
      statInserted.textContent = "—";
      statTokens.textContent = "—";
      statCost.textContent = "—";
    }
    renderDataFeedback(
      feedbackContainer,
      "error",
      error instanceof Error ? error.message : "Could not load usage data.",
      () => void loadUsageStats(surface),
    );
  }
}

async function clearHistory(): Promise<void> {
  clearHistoryButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_USAGE_STATS" }) as RuntimeResponse;
    if (response.ok && response.usageStats) renderUsageStats(response.usageStats);
    showStatus(
      statusAdvancedNode,
      response.ok ? "History cleared." : response.error || "Clear failed.",
      response.ok ? "info" : "error",
    );
  } catch (error) {
    showStatus(statusAdvancedNode, error instanceof Error ? error.message : "Clear failed.", "error");
  } finally {
    clearHistoryButton.disabled = false;
  }
}

let clearHistoryArmed = false;
let clearHistoryConfirmTimer: number | undefined;

function resetClearHistoryConfirmation(): void {
  clearHistoryArmed = false;
  window.clearTimeout(clearHistoryConfirmTimer);
  clearHistoryButton.textContent = "Clear history";
}

clearHistoryButton.addEventListener("click", () => {
  if (!clearHistoryArmed) {
    clearHistoryArmed = true;
    clearHistoryButton.textContent = "Click again to clear";
    showStatus(statusAdvancedNode, "This permanently clears local generation history.");
    clearHistoryConfirmTimer = window.setTimeout(resetClearHistoryConfirmation, 5000);
    return;
  }
  resetClearHistoryConfirmation();
  void clearHistory();
});
saveAdvancedButton.addEventListener("click", () => void saveSettings(statusAdvancedNode, saveAdvancedButton));
testButton.addEventListener("click", () => void checkConnection({ showHeaderFeedback: true }));

async function initializePopup(): Promise<void> {
  try {
    await Promise.all([checkConnection(), loadUsageStats("home")]);
  } catch (error) {
    renderConnection(
      "error",
      "Not connected",
      error instanceof Error ? error.message : "Could not load data.",
    );
  }
}

void initializePopup();
