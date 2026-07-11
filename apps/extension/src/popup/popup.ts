import { clampReplyLength, TONE_AUTO_LABEL, TONE_LABELS } from "../shared/constants";
import type { ConnectionStatus, ExtensionSettings, HistoryEntry, Tone, UsageStats } from "../shared/types";

type RuntimeResponse = {
  ok: boolean;
  settings?: ExtensionSettings;
  connection?: ConnectionStatus;
  usageStats?: UsageStats;
  error?: string;
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
const navButtons = Array.from(bottomNav.querySelectorAll<HTMLButtonElement>(".nav-button"));

const clearHistoryButton = document.getElementById("clear-history") as HTMLButtonElement;
const statGenerations = document.getElementById("stat-generations") as HTMLElement;
const statInserted = document.getElementById("stat-inserted") as HTMLElement;
const historyList = document.getElementById("history-list") as HTMLElement;
const historyTabs = document.getElementById("history-tabs") as HTMLElement;

const statusCard = document.getElementById("status-card") as HTMLElement;
const connectionTitle = document.getElementById("connection-title") as HTMLElement;
const connectionDetail = document.getElementById("connection-detail") as HTMLElement;
const testButton = document.getElementById("test-connection") as HTMLButtonElement;
const backendUrlInput = document.getElementById("backend-url") as HTMLInputElement;
const authTokenInput = document.getElementById("auth-token") as HTMLInputElement;
const toneSelect = document.getElementById("tone-default") as HTMLSelectElement;
const instructionInput = document.getElementById("default-instruction") as HTMLTextAreaElement;
const maxLengthInput = document.getElementById("max-length") as HTMLInputElement;
const maxLengthValue = document.getElementById("max-length-value") as HTMLElement;
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
const quickTonesRow = document.getElementById("quick-tones-row") as HTMLElement;
const favoriteTonesGrid = document.getElementById("favorite-tones-grid") as HTMLElement;
const favoriteTonesCount = document.getElementById("favorite-tones-count") as HTMLElement;

const MAX_FAVORITE_TONES = 5;

let connectionCheckId = 0;
let draftCount = 3;
let useEmoji = true;
let readImages = false;
let maxLengthMode: "auto" | "manual" = "manual";
let latestUsageStats: UsageStats = { totalGenerations: 0, totalInserted: 0, history: [] };
let historyFilter: HistoryFilter = "all";
let favoriteTones: Tone[] = [];
// Guards saveSettings() from firing before loadSettings() has populated the
// inputs at least once. Auto-save reads every input's current .value,
// including backendUrlInput/authTokenInput, which start out empty in the
// static HTML — a control clicked fast enough to race the initial
// GET_SETTINGS round-trip would otherwise save those as blank, clobbering
// the user's configured backend/token.
let settingsLoaded = false;

function switchView(view: View): void {
  for (const [name, panel] of Object.entries(viewPanels) as [View, HTMLElement][]) {
    panel.hidden = name !== view;
  }
  for (const button of navButtons) {
    button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false");
  }
  if (view === "home") {
    void checkConnection();
    void loadUsageStats();
  } else if (view === "history") {
    void loadUsageStats();
  } else if (view === "tone" || view === "advanced") {
    void loadSettings();
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

function setReadImages(value: boolean): void {
  readImages = value;
  for (const button of readImagesButtons) {
    button.setAttribute("aria-pressed", String((button.dataset.images === "on") === value));
  }
}

function setMaxLengthMode(mode: "auto" | "manual"): void {
  maxLengthMode = mode;
  for (const button of maxLengthModeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.lengthMode === mode));
  }
  maxLengthInput.disabled = mode === "auto";
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
  setReadImages(button.dataset.images === "on");
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
  maxLengthValue.textContent = maxLengthInput.value;
  syncMaxLengthPreset();
});

// "change" (fires once on blur/commit), not "input" (fires on every
// keystroke) — avoids clamping/saving mid-type on every digit (typing "4",
// then "40", then "400" toward 4000 would otherwise get snapped to 50 after
// the first keystroke).
maxLengthInput.addEventListener("change", () => {
  maxLengthInput.value = String(clampReplyLength(Number(maxLengthInput.value)));
  maxLengthValue.textContent = maxLengthInput.value;
  syncMaxLengthPreset();
  saveToneSettings();
});

maxLengthPresetGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-length-preset]");
  if (!button?.dataset.lengthPreset) return;
  maxLengthInput.value = button.dataset.lengthPreset;
  maxLengthValue.textContent = maxLengthInput.value;
  syncMaxLengthPreset();
  saveToneSettings();
});

toneSelect.addEventListener("change", () => {
  syncQuickTonesActive();
  saveToneSettings();
});
instructionInput.addEventListener("input", saveToneSettingsDebounced);

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

historyTabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-history-filter]");
  if (!button) return;
  historyFilter = (button.dataset.historyFilter as HistoryFilter) || "all";
  historyTabs.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab === button));
  });
  renderHistoryList(latestUsageStats.history);
});

function showStatus(node: HTMLElement, message: string): void {
  node.textContent = message;
  window.setTimeout(() => {
    if (node.textContent === message) node.textContent = "";
  }, 2400);
}

function renderConnection(state: "unknown" | "connected" | "error", title: string, detail = ""): void {
  statusCard.dataset.state = state;
  connectionTitle.textContent = title;
  connectionDetail.textContent = detail;
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

async function checkConnection(): Promise<void> {
  const checkId = ++connectionCheckId;
  testButton.disabled = true;
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
  } catch (error) {
    if (checkId !== connectionCheckId) return;
    renderConnection(
      "error",
      "Not connected",
      error instanceof Error ? error.message : "Connection failed.",
    );
  } finally {
    if (checkId === connectionCheckId) testButton.disabled = false;
  }
}

async function loadSettings(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }) as RuntimeResponse;
  if (!response.ok || !response.settings) {
    showStatus(statusAdvancedNode, response.error || "Could not load settings.");
    return;
  }
  settingsLoaded = true;
  backendUrlInput.value = response.settings.backendBaseUrl;
  authTokenInput.value = response.settings.authToken;
  toneSelect.value = response.settings.toneDefault;
  instructionInput.value = response.settings.defaultInstruction;
  // The input always needs a numeric value to fall back to if the user
  // switches from Auto back to Manual, so it keeps the last-known number (or
  // its own default) even while Auto is active and the input is disabled.
  if (response.settings.maxReplyLength !== "auto") {
    maxLengthInput.value = String(response.settings.maxReplyLength);
    maxLengthValue.textContent = maxLengthInput.value;
    syncMaxLengthPreset();
  }
  setMaxLengthMode(response.settings.maxReplyLength === "auto" ? "auto" : "manual");
  setDraftCount(response.settings.draftCount);
  setUseEmoji(response.settings.useEmoji);
  setReadImages(response.settings.readImages);
  favoriteTones = response.settings.favoriteTones ?? [];
  renderFavoriteTonesGrid();
  renderQuickTones();
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
    showStatus(statusNode, response.ok ? "Settings saved." : response.error || "Save failed.");
    if (response.ok && checkConnectionAfter) void checkConnection();
  } catch (error) {
    showStatus(statusNode, error instanceof Error ? error.message : "Save failed.");
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
    left.textContent = `${relativeTime(entry.createdAt)} · ${TONE_LABELS[entry.tone] ?? entry.tone}`;
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

function renderUsageStats(stats: UsageStats): void {
  latestUsageStats = stats;
  statGenerations.textContent = String(stats.totalGenerations);
  statInserted.textContent = String(stats.totalInserted);
  renderHistoryList(stats.history);
}

async function loadUsageStats(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "GET_USAGE_STATS" }) as RuntimeResponse;
  if (!response.ok || !response.usageStats) return;
  renderUsageStats(response.usageStats);
}

async function clearHistory(): Promise<void> {
  clearHistoryButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_USAGE_STATS" }) as RuntimeResponse;
    if (response.ok && response.usageStats) renderUsageStats(response.usageStats);
    showStatus(statusAdvancedNode, response.ok ? "History cleared." : response.error || "Clear failed.");
  } finally {
    clearHistoryButton.disabled = false;
  }
}

clearHistoryButton.addEventListener("click", () => void clearHistory());
saveAdvancedButton.addEventListener("click", () => void saveSettings(statusAdvancedNode, saveAdvancedButton));
testButton.addEventListener("click", () => void checkConnection());

async function initializePopup(): Promise<void> {
  try {
    await checkConnection();
    await loadUsageStats();
  } catch (error) {
    renderConnection(
      "error",
      "Not connected",
      error instanceof Error ? error.message : "Could not load data.",
    );
  }
}

void initializePopup();
