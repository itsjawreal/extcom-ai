import { TONE_LABELS } from "../shared/constants";
import type { ConnectionStatus, ExtensionSettings, Tone } from "../shared/types";

type RuntimeResponse = {
  ok: boolean;
  settings?: ExtensionSettings;
  connection?: ConnectionStatus;
  error?: string;
};

const statusCard = document.getElementById("status-card") as HTMLElement;
const connectionTitle = document.getElementById("connection-title") as HTMLElement;
const connectionDetail = document.getElementById("connection-detail") as HTMLElement;
const testButton = document.getElementById("test-connection") as HTMLButtonElement;
const backendUrlInput = document.getElementById("backend-url") as HTMLInputElement;
const authTokenInput = document.getElementById("auth-token") as HTMLInputElement;
const toneSelect = document.getElementById("tone-default") as HTMLSelectElement;
const instructionInput = document.getElementById("default-instruction") as HTMLTextAreaElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const statusNode = document.getElementById("status") as HTMLParagraphElement;

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
  testButton.disabled = true;
  renderConnection("unknown", "Checking…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "CHECK_CONNECTION" }) as RuntimeResponse;
    if (!response.ok || !response.connection) {
      throw new Error(response.error || "Connection failed.");
    }
    renderConnection(
      "connected",
      "Connected",
      `Plan ${response.connection.plan} • ${response.connection.remainingToday} replies left today`,
    );
  } catch (error) {
    renderConnection(
      "error",
      "Not connected",
      error instanceof Error ? error.message : "Connection failed.",
    );
  } finally {
    testButton.disabled = false;
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
    };
    if (settings.backendBaseUrl) {
      await requestBackendPermission(settings.backendBaseUrl);
    }
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings,
    }) as RuntimeResponse;
    showStatus(response.ok ? "Settings saved." : response.error || "Save failed.");
    if (response.ok) void checkConnection();
  } finally {
    saveButton.disabled = false;
  }
}

saveButton.addEventListener("click", () => void saveSettings());
testButton.addEventListener("click", () => void checkConnection());
void loadSettings().then(checkConnection);
