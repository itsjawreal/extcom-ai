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

  type InsertResult = {
    ok: boolean;
    reason?: string;
  };

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => window.setTimeout(resolve, ms));

  const getText = (element: HTMLElement): string => {
    const authoredText = element.textContent?.replace(/\u00a0/g, " ").trim() || "";
    if (!authoredText) return "";
    return (element.innerText || authoredText)
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .trim();
  };

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

  const selectionIsInside = (editable: HTMLElement): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const isInside = (node: Node | null): boolean => {
      if (!node) return false;
      return node === editable || editable.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode);
    };
    return isInside(selection.anchorNode) && isInside(selection.focusNode);
  };

  const normalizeText = (value: string): string =>
    value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const textIsEquivalent = (actual: string, expected: string): boolean =>
    normalizeText(actual) === normalizeText(expected);

  const selectionCoversText = (editable: HTMLElement, expected: string): boolean => {
    if (!selectionIsInside(editable)) return false;
    return normalizeText(window.getSelection()?.toString() || "") === normalizeText(expected);
  };

  const selectAllEditableText = (editable: HTMLElement, expected: string): boolean => {
    // Unlike a Range created by an extension isolated world, selectAll updates
    // the active editable region through Chromium's native editing command.
    // Never fall back to a DOM Range for replacement: Draft.js may paint that
    // range without accepting it into its controlled EditorState.
    try {
      document.execCommand("selectAll", false);
    } catch {
      return false;
    }
    return selectionCoversText(editable, expected);
  };

  const pasteIntoEditor = (editable: HTMLElement, text: string): boolean => {
    if (typeof DataTransfer === "undefined" || typeof ClipboardEvent === "undefined") {
      return false;
    }

    try {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      editable.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }));
      return true;
    } catch {
      return false;
    }
  };

  const insertIntoComposer = async (composer: HTMLElement, text: string): Promise<InsertResult> => {
    const editable = resolveEditableTarget(composer);
    const currentText = getText(editable);

    editable.focus({ preventScroll: true });
    // X uses Draft.js. Its controlled SelectionState trails DOM focus changes;
    // proven X automation waits before selecting and again before insertion.
    await wait(300);
    if (document.activeElement !== editable && !editable.contains(document.activeElement)) {
      return { ok: false, reason: "composer-did-not-keep-focus" };
    }

    const selectionReady = currentText
      ? selectAllEditableText(editable, currentText)
      : setSelection(editable, "end");
    if (!selectionReady) return { ok: false, reason: "full-draft-selection-not-established" };

    await wait(200);
    if (currentText && !selectionCoversText(editable, currentText)) {
      return { ok: false, reason: "full-draft-selection-was-lost" };
    }

    // Let Draft.js own the mutation. Its paste handler converts multiline text
    // into ContentBlocks and updates EditorState before React renders the DOM.
    // Native insertText mutates the DOM first; on X that can leave stale nodes
    // which duplicate on the user's next edit, and multiline input may update
    // only the final block in Draft's state.
    if (!pasteIntoEditor(editable, text)) {
      return { ok: false, reason: "editor-paste-event-failed" };
    }

    await wait(250);
    const expectedText = text.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
    const actualText = getText(editable);
    // Draft.js represents line breaks as separate content blocks. Chromium's
    // innerText can expose those block boundaries as an extra newline even
    // though Draft's EditorState contains the exact inserted text. Compare
    // semantic text here; duplicated or missing words still fail closed.
    if (!textIsEquivalent(actualText, expectedText)) {
      return {
        ok: false,
        reason: `exact-text-check-failed(before=${currentText.length}, expected=${expectedText.length}, actual=${actualText.length})`,
      };
    }

    return { ok: true };
  };

  document.addEventListener(REQUEST_EVENT, (event) => {
    const customEvent = event as CustomEvent<InsertRequest>;
    const detail = customEvent.detail;
    if (!detail?.id || !detail.targetAttribute) return;

    const composer = document.querySelector<HTMLElement>(
      `[${detail.targetAttribute}="${detail.id}"]`,
    );

    void (async () => {
      const result = composer
        ? await insertIntoComposer(composer, detail.text)
        : { ok: false, reason: "composer-target-not-found" };
      document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
        detail: { id: detail.id, ...result },
      }));
    })();
  });
}
