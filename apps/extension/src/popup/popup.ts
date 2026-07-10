import { TONE_LABELS } from "../shared/constants";
import type { ConnectionStatus, ExtensionSettings, Tone, UsageStats } from "../shared/types";

type RuntimeResponse = {
  ok: boolean;
  settings?: ExtensionSettings;
  connection?: ConnectionStatus;
  usageStats?: UsageStats;
  error?: string;
};

const viewStats = document.getElementById("view-stats") as HTMLElement;
const viewSettings = document.getElementById("view-settings") as HTMLElement;
const openSettingsButton = document.getElementById("open-settings") as HTMLButtonElement;
const backButton = document.getElementById("back-to-stats") as HTMLButtonElement;
const clearHistoryButton = document.getElementById("clear-history") as HTMLButtonElement;
const statGenerations = document.getElementById("stat-generations") as HTMLElement;
const statInserted = document.getElementById("stat-inserted") as HTMLElement;
const historyList = document.getElementById("history-list") as HTMLElement;

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
const draftCountGroup = document.getElementById("draft-count") as HTMLElement;
const draftCountButtons = Array.from(draftCountGroup.querySelectorAll<HTMLButtonElement>("button"));
const useEmojiGroup = document.getElementById("use-emoji") as HTMLElement;
const useEmojiButtons = Array.from(useEmojiGroup.querySelectorAll<HTMLButtonElement>("button"));
const readImagesGroup = document.getElementById("read-images") as HTMLElement;
const readImagesButtons = Array.from(readImagesGroup.querySelectorAll<HTMLButtonElement>("button"));
const saveButton = document.getElementById("save") as HTMLButtonElement;
const statusNode = document.getElementById("status") as HTMLParagraphElement;
const settingsTabs = document.getElementById("settings-tabs") as HTMLElement;
const tabPanelDefault = document.getElementById("tab-panel-default") as HTMLElement;
const tabPanelAdvanced = document.getElementById("tab-panel-advanced") as HTMLElement;
let connectionCheckId = 0;
let draftCount = 3;
let useEmoji = true;
let readImages = false;
let maxLengthMode: "auto" | "manual" = "manual";

function switchSettingsTab(tab: "default" | "advanced"): void {
  tabPanelDefault.hidden = tab !== "default";
  tabPanelAdvanced.hidden = tab !== "advanced";
  settingsTabs.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  });
}

settingsTabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".tab");
  if (!button) return;
  switchSettingsTab(button.dataset.tab === "advanced" ? "advanced" : "default");
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
});

useEmojiGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-emoji]");
  if (!button) return;
  setUseEmoji(button.dataset.emoji === "on");
});

readImagesGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-images]");
  if (!button) return;
  setReadImages(button.dataset.images === "on");
});

maxLengthModeGroup.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-length-mode]");
  if (!button) return;
  setMaxLengthMode(button.dataset.lengthMode === "auto" ? "auto" : "manual");
});

maxLengthInput.addEventListener("input", () => {
  maxLengthValue.textContent = maxLengthInput.value;
});

function showStatus(message: string): void {
  statusNode.textContent = message;
  window.setTimeout(() => {
    if (statusNode.textContent === message) statusNode.textContent = "";
  }, 2400);
}

function renderConnection(state: "unknown" | "connected" | "error", title: string, detail = ""): void {
  statusCard.dataset.state = state;
  connectionTitle.textContent = title;
  connectionDetail.textContent = detail;
}

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
    showStatus(response.error || "Could not load settings.");
    return;
  }
  backendUrlInput.value = response.settings.backendBaseUrl;
  authTokenInput.value = response.settings.authToken;
  toneSelect.value = response.settings.toneDefault;
  instructionInput.value = response.settings.defaultInstruction;
  // The slider always needs a numeric value to fall back to if the user
  // switches from Auto back to Manual, so it keeps the last-known number (or
  // its own default) even while Auto is active and the slider is disabled.
  if (response.settings.maxReplyLength !== "auto") {
    maxLengthInput.value = String(response.settings.maxReplyLength);
    maxLengthValue.textContent = maxLengthInput.value;
  }
  setMaxLengthMode(response.settings.maxReplyLength === "auto" ? "auto" : "manual");
  setDraftCount(response.settings.draftCount);
  setUseEmoji(response.settings.useEmoji);
  setReadImages(response.settings.readImages);
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

async function saveSettings(): Promise<void> {
  saveButton.disabled = true;
  try {
    const settings: ExtensionSettings = {
      backendBaseUrl: backendUrlInput.value.trim(),
      authToken: authTokenInput.value.trim(),
      toneDefault: toneSelect.value as Tone,
      defaultInstruction: instructionInput.value.trim(),
      maxReplyLength: maxLengthMode === "auto" ? "auto" : Number(maxLengthInput.value),
      draftCount,
      useEmoji,
      readImages,
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
    if (settings.backendBaseUrl) {
      await requestBackendPermission(settings.backendBaseUrl);
    }
    showStatus(response.ok ? "Settings saved." : response.error || "Save failed.");
    if (response.ok) void checkConnection();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Save failed.");
  } finally {
    saveButton.disabled = false;
  }
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

function renderUsageStats(stats: UsageStats): void {
  statGenerations.textContent = String(stats.totalGenerations);
  statInserted.textContent = String(stats.totalInserted);

  historyList.replaceChildren();
  if (stats.history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No generations yet.";
    historyList.append(empty);
    return;
  }

  for (const entry of stats.history) {
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
      link.textContent = "✓ Inserted ↗";
      right = link;
    } else {
      right = document.createElement("span");
      right.textContent = entry.inserted ? "✓ Inserted" : "Not inserted";
    }
    right.className = "inserted-tag";
    meta.append(left, right);

    item.append(text, meta);
    historyList.append(item);
  }
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
    showStatus(response.ok ? "History cleared." : response.error || "Clear failed.");
  } finally {
    clearHistoryButton.disabled = false;
  }
}

function switchView(view: "stats" | "settings"): void {
  viewStats.hidden = view !== "stats";
  viewSettings.hidden = view !== "settings";
  if (view === "settings") {
    switchSettingsTab("default");
    void loadSettings();
  } else {
    void checkConnection();
    void loadUsageStats();
  }
}

openSettingsButton.addEventListener("click", () => switchView("settings"));
backButton.addEventListener("click", () => switchView("stats"));
clearHistoryButton.addEventListener("click", () => void clearHistory());
saveButton.addEventListener("click", () => void saveSettings());
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
