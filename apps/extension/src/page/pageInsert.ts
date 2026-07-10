// This classic script can run more than once in the same main-world window \u2014
// e.g. X.com's speculation-rules prerendering activates a page that already
// executed this script once, then Chrome injects it again. A runtime flag
// alone doesn't help: `const`/`function` at the top level would already throw
// "Identifier has already been declared" on the second execution before any
// check runs. Keep every declaration inside this guarded block so a repeat
// execution only re-evaluates the `if` (always legal) and does nothing else.
if (!(window as typeof window & { __extcomAiPageInsertInstalled__?: boolean }).__extcomAiPageInsertInstalled__) {
  (window as typeof window & { __extcomAiPageInsertInstalled__?: boolean }).__extcomAiPageInsertInstalled__ = true;

  const REQUEST_EVENT = "extcom-ai:page-insert-request";
  const RESPONSE_EVENT = "extcom-ai:page-insert-response";

  type InsertRequest = {
    id: string;
    targetAttribute: string;
    text: string;
  };

  const getText = (element: HTMLElement): string =>
    element.textContent?.replace(/\u00a0/g, " ").trim() || "";

  const resolveEditableTarget = (composer: HTMLElement): HTMLElement => {
    if (composer.matches('[contenteditable="true"]')) return composer;
    const active = document.activeElement;
    if (active instanceof HTMLElement && composer.contains(active)) {
      const focusedEditable = active.closest<HTMLElement>('[contenteditable="true"], [role="textbox"]');
      if (focusedEditable && composer.contains(focusedEditable)) return focusedEditable;
    }
    return composer.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"]') || composer;
  };

  const setSelection = (editable: HTMLElement, mode: "all" | "end"): boolean => {
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
  };

  const insertIntoComposer = (composer: HTMLElement, text: string): boolean => {
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
  };

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
