import { TONE_LABELS } from "../shared/constants";
import type { ExtensionSettings, Tone } from "../shared/types";

type SettingsResponse = {
  ok: boolean;
  settings?: ExtensionSettings;
  error?: string;
};

const backendUrlInput = document.getElementById("backend-url") as HTMLInputElement;
const authTokenInput = document.getElementById("auth-token") as HTMLInputElement;
const toneSelect = document.getElementById("tone-default") as HTMLSelectElement;
const saveButton = document.getElementById("save") as HTMLButtonElement;
const statusNode = document.getElementById("status") as HTMLParagraphElement;

function showStatus(message: string): void {
  statusNode.textContent = message;
  window.setTimeout(() => {
    if (statusNode.textContent === message) statusNode.textContent = "";
  }, 2400);
}

for (const [value, label] of Object.entries(TONE_LABELS)) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  toneSelect.append(option);
}

async function loadSettings(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }) as SettingsResponse;
  if (!response.ok || !response.settings) {
    showStatus(response.error || "Could not load settings.");
    return;
  }
  backendUrlInput.value = response.settings.backendBaseUrl;
  authTokenInput.value = response.settings.authToken;
  toneSelect.value = response.settings.toneDefault;
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
    };
    if (settings.backendBaseUrl) {
      await requestBackendPermission(settings.backendBaseUrl);
    }
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings,
    }) as SettingsResponse;
    showStatus(response.ok ? "Settings saved." : response.error || "Save failed.");
  } finally {
    saveButton.disabled = false;
  }
}

saveButton.addEventListener("click", () => void saveSettings());
void loadSettings();
