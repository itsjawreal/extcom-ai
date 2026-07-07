const REPLY_CONTROL_SELECTOR = '[data-testid="reply"]';
const COMPOSER_SELECTOR = [
  '[data-testid="tweetTextarea_0"]',
  '[data-testid="tweetTextarea_1"]',
  '[role="textbox"][contenteditable="true"]',
].join(", ");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function findComposer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(COMPOSER_SELECTOR);
}

function insertTextIntoComposer(composer: HTMLElement, text: string): boolean {
  composer.focus();
  const selection = window.getSelection();
  if (!selection) return false;

  const range = document.createRange();
  range.selectNodeContents(composer);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  if (document.execCommand("selectAll")) {
    document.execCommand("delete");
  } else {
    composer.textContent = "";
  }

  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    composer.textContent = text;
  }

  composer.dispatchEvent(new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text,
  }));
  composer.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: text,
  }));
  return true;
}

export async function insertReplyIntoComposer(post: HTMLElement, text: string): Promise<void> {
  const replyButton = post.querySelector<HTMLElement>(REPLY_CONTROL_SELECTOR);
  if (!replyButton) throw new Error("Reply composer button is not available on this post.");

  replyButton.click();

  let composer = findComposer();
  for (let attempt = 0; !composer && attempt < 12; attempt += 1) {
    await wait(150);
    composer = findComposer();
  }

  if (!composer) throw new Error("Reply composer did not open.");
  if (!insertTextIntoComposer(composer, text)) {
    throw new Error("Reply composer could not be filled.");
  }
}
