const UNSAFE_INSTRUCTION_PATTERNS = [
  /\b(auto[ -]?post|auto[ -]?reply|mass[ -]?reply)\b/i,
  /\b(doxx?|home address|private address)\b/i,
  /\b(go harass|threaten|kill)\b/i,
  /\b(guaranteed?\s+(?:returns?|profit|\d+x)|risk[ -]?free|insider info)\b/i,
];

const EXCESS_HASHTAGS = /(?:\s*#[\p{L}\p{N}_]+){3,}/gu;
// Match repeated emojis (including Extended_Pictographic, Emoji variants, and
// regional indicators). Allows one occurrence, removes repeats (e.g., "🔥🔥🔥" → "🔥").
const EXCESS_EMOJI = /([\p{Extended_Pictographic}\p{Emoji_Component}])(?:\s*\1){2,}/gu;

export function assertSafeRequest(extraInstruction?: string): void {
  if (!extraInstruction) return;
  if (UNSAFE_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(extraInstruction))) {
    throw new Error("Requested instruction is not allowed.");
  }
}

// Mirrors the client-side safety net in serviceWorker.ts's truncateReply():
// end on a complete sentence within the limit if one fits, otherwise fall
// back to a word boundary + ellipsis so a forced cut still reads as a cut,
// not a reply that just happens to trail off.
function lastSentenceEnd(window: string): number | null {
  let lastEnd = -1;
  for (const match of window.matchAll(/[.!?](?=\s|$)/g)) {
    lastEnd = match.index ?? lastEnd;
  }
  return lastEnd >= 0 ? lastEnd : null;
}

function truncateToLimit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const sentenceEnd = lastSentenceEnd(text.slice(0, limit));
  if (sentenceEnd !== null) return text.slice(0, sentenceEnd + 1).trimEnd();
  const cut = text.slice(0, Math.max(0, limit - 1));
  const lastBoundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  const trimmed = lastBoundary > limit * 0.5 ? cut.slice(0, lastBoundary) : cut;
  return `${trimmed.trimEnd()}…`;
}

// maxLength must be the actual request's character limit (or the "auto"
// mode's own ceiling) — this used to be a hardcoded 220-char slice
// regardless of what was requested, silently chopping long-form replies
// (maxLength up to 25,000) off mid-sentence server-side, before the
// smarter client-side safety net in the extension ever got a chance to run.
export function sanitizeReply(text: string, maxLength: number): string {
  const cleaned = text
    .replace(EXCESS_HASHTAGS, "")
    .replace(EXCESS_EMOJI, "$1")
    .replace(/\r\n?/g, "\n")
    // Normalize horizontal whitespace without destroying intentional X post
    // paragraphs. More than one blank line adds height but rarely meaning.
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncateToLimit(cleaned, maxLength);
}
