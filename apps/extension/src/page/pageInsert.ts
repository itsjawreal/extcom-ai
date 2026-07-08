const REQUEST_EVENT = "ekskomen:page-insert-request";
const RESPONSE_EVENT = "ekskomen:page-insert-response";

type InsertRequest = {
  id: string;
  targetAttribute: string;
  text: string;
};

function getText(element: HTMLElement): string {
  return element.textContent?.replace(/\u00a0/g, " ").trim() || "";
}

function resolveEditableTarget(composer: HTMLElement): HTMLElement {
  if (composer.matches('[contenteditable="true"]')) return composer;
  const active = document.activeElement;
  if (active instanceof HTMLElement && composer.contains(active)) {
    const focusedEditable = active.closest<HTMLElement>('[contenteditable="true"], [role="textbox"]');
    if (focusedEditable && composer.contains(focusedEditable)) return focusedEditable;
  }
  return composer.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"]') || composer;
}

function setSelection(editable: HTMLElement, mode: "all" | "end"): boolean {
  const selection = window.getSelection();
  if (!selection || !editable.isConnected) return false;

  try {
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(mode === "end");
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function insertIntoComposer(composer: HTMLElement, text: string): boolean {
  const editable = resolveEditableTarget(composer);
  editable.focus();
  editable.click();

  const currentText = getText(editable);
  setSelection(editable, currentText ? "all" : "end");

  let inserted = false;
  try {
    if (currentText) {
      document.execCommand("delete");
      setSelection(editable, "end");
    }
    inserted = document.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    try {
      inserted = document.execCommand("insertHTML", false, text);
    } catch {
      inserted = false;
    }
  }

  if (!inserted) return false;

  editable.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text,
  }));
  editable.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: text,
  }));

  return getText(editable).length > 0;
}

// This script can be registered twice on the same main-world window: once as a
// MAIN-world content script and once via the fallback <script> injection in
// pageBridge.ts. Guard so only one listener ever handles insert requests.
const INSTALL_FLAG = "__ekskomenPageInsertInstalled__";
const pageWindow = window as typeof window & { [INSTALL_FLAG]?: boolean };

if (!pageWindow[INSTALL_FLAG]) {
  pageWindow[INSTALL_FLAG] = true;

  document.addEventListener(REQUEST_EVENT, (event) => {
    const customEvent = event as CustomEvent<InsertRequest>;
    const detail = customEvent.detail;
    if (!detail?.id || !detail.targetAttribute) return;

    const composer = document.querySelector<HTMLElement>(
      `[${detail.targetAttribute}="${detail.id}"]`,
    );

    const response = {
      id: detail.id,
      ok: composer ? insertIntoComposer(composer, detail.text) : false,
    };

    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: response }));
  });
}
