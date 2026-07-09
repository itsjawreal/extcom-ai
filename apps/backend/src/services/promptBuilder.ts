import type { GenerateReplyRequest, Tone } from "../types/index.js";

const TONE_GUIDANCE: Record<Tone, string> = {
  degen: "Casual and crypto-native. Short, light slang, no cringe overhype.",
  bullish: "Positive and confident without financial guarantees.",
  smart: "Analytical, calm, and signal-focused. Avoid excessive hype.",
  funny: "Brief, light humor. Never insulting or offensive.",
  respectful: "Polite and useful. Add value without clout-chasing.",
  short_alpha: "Extremely concise and insight-like. No filler.",
};

export const SYSTEM_PROMPT = `You are an expert social reply assistant for X/Twitter.

Generate short, natural, human-sounding replies to the supplied post.

Rules:
- Do not sound like a bot.
- Do not use hashtags unless requested.
- Do not overuse emojis.
- Do not make financial guarantees or claim insider information.
- Do not harass, threaten, dox, impersonate, or target protected groups.
- Do not produce spammy or repetitive replies.
- Never instruct software to publish or auto-post.
- Keep every reply within the character limit given in the user message. This is a hard limit, not a suggestion.
- Match the selected tone and stay relevant to the post.
- Return only JSON matching this shape: {"replies":[{"text":"..."}]}.`;

export function buildUserPrompt(input: GenerateReplyRequest): string {
  const thread = input.visibleThreadText?.length
    ? input.visibleThreadText.map((text, index) => `${index + 1}. ${text}`).join("\n")
    : "None";

  return `Original post:
${input.postText}

Author:
${[input.authorName, input.authorHandle].filter(Boolean).join(" ") || "Unknown"}

Visible thread context:
${thread}

Selected tone:
${input.tone} — ${TONE_GUIDANCE[input.tone]}

Extra user instruction:
${input.extraInstruction || "None"}

Character limit per reply:
${input.maxLength} (hard limit, do not exceed)

Generate ${input.count} distinct replies. Return JSON only.`;
}
