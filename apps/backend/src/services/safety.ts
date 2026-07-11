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

export function sanitizeReply(text: string): string {
  return text
    .replace(EXCESS_HASHTAGS, "")
    .replace(EXCESS_EMOJI, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}
