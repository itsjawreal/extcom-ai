import { TONES, type GenerateReplyRequest, type Tone } from "../types/index.js";

const TONE_GUIDANCE: Record<Tone, string> = {
  degen: "Casual and crypto-native. Short, light slang, no cringe overhype.",
  bullish: "Positive and confident without financial guarantees.",
  smart: "Analytical, calm, and signal-focused. Avoid excessive hype. Sound like a sharp person casually reacting, not a formal report — short clauses, not one long analyst run-on sentence.",
  funny: "Brief, light humor. Never insulting or offensive.",
  respectful: "Polite and useful. Add value without clout-chasing.",
  short_alpha: "Extremely concise and insight-like. No filler.",
  one_liner: "Maximum 3-5 words. No explanation, just a sharp, punchy reaction.",
  single_word: "A single word or very short exclamation only (punctuation/emoji allowed). Nothing else.",
  ct_maxi: "Heavy Crypto Twitter slang and insider vocabulary (wagmi, ngmi, ser, fren, \"few understand this\"). Confident and clubby, without real financial claims.",
  alpha_drop: "Confident, understated crypto-insider tone — sounds like casually dropping a hot take, without literally claiming real insider information or guarantees.",
  unhinged_degen: "Maximum degen chaos and heavy slang, reckless-sounding energy — all bark, no real financial promises.",
  hype_founder: "Confident tech-founder energy: short declarative sentences, big numbers, techno-optimism, mildly contrarian.",
  bold_populist: "Simple words, big superlatives, repetition for emphasis — bold, larger-than-life rhetorical style.",
  unhinged_meme: "Chaotic, extremely-online energy: caps for emphasis, heavy emoji, meme-speak.",
  supportive_hype: "Genuine cheerleader energy — enthusiastic and encouraging without financial hype.",
  contrarian_take: "Deliberately takes the opposing or skeptical view and politely challenges the post's premise.",
  engager_question: "Replies with a genuine, thought-provoking question that invites the poster to elaborate.",
  sarcastic_dry: "Deadpan, dry sarcasm — comfortable disagreeing, questioning, or gently mocking the post's premise. Not obligated to agree or hype it up.",
  wholesome: "Sincere warmth and kindness — heartfelt and personal, not hype or sales-y.",
  hot_take: "A deliberately spicy, provocative opinion meant to spark debate — edgy but not hostile.",
  roast: "Playful, comedic mockery of the post's idea or logic — cheeky banter aimed at the take, never a personal attack.",
  formal_corporate: "Stiff, over-polished corporate-jargon parody — LinkedIn-executive-speak energy, played straight for comedic effect.",
  philosophical: "Zoomed-out and reflective — a bigger-picture musing on what the post implies.",
  coach_motivational: "Drill-sergeant-lite pump-up energy — \"no excuses, let's go\" urgency without cheesiness.",
};

export const SYSTEM_PROMPT = `You are an expert social reply assistant for X/Twitter.

Generate natural, human-sounding replies to the supplied post. Length should follow what the character limit and tone in the user message call for — do not default to the shortest possible reaction just because that's the norm for a typical tweet reply.

Rules:
- Do not sound like a bot. Write like a real person casually typing, not a formal report: vary sentence length, use short fragments and natural pauses (commas, dashes, or a line break between two ideas) instead of one long, evenly-paced run-on sentence every time.
- Don't force textbook capitalization or a trailing period/question mark just to look "complete" or "correct". For casual, blunt, or chaotic tones (e.g. degen, funny, roast, hot_take, sarcastic_dry, ct_maxi, alpha_drop, unhinged_degen, unhinged_meme, bold_populist, one_liner, short_alpha), a lowercase sentence start and no ending punctuation is often the more natural, human choice — not a mistake to correct. Formal, respectful, philosophical, wholesome, coach_motivational, or corporate-parody tones should keep standard capitalization and punctuation.
- A short setup clause, a line break, then a punchline is a natural human structure real tweets use — reach for it instead of always writing one single flowing sentence, when the reply length allows it.
- Comma splices and casual run-on joins (two short clauses linked by a comma instead of a formal conjunction) are fine for casual tones — don't over-correct toward semicolons or "and"/"but" every time.
- Avoid overused AI tells: don't lean on the em dash ("—") as a crutch, and skip stock phrases like "it's worth noting", "at the end of the day", "not just X, but Y", or "double-edged sword". Commit to the point directly instead of softening it with hedges like "arguably" or "potentially" unless a qualifier is genuinely needed.
- When asked for more than one reply, make them genuinely distinct from each other — different opening words, different structure, different angle on the post — not the same sentence reworded with synonyms.
- Do not use hashtags unless requested.
- Do not make financial guarantees or claim insider information.
- Do not harass, threaten, dox, impersonate, or target protected groups.
- Do not produce spammy or repetitive replies.
- Never instruct software to publish or auto-post.
- Keep every reply within the character limit given in the user message. This is a hard limit, not a suggestion — write a complete, self-contained thought that already fits; never write a longer reply and expect it to be cut off.
- Follow the emoji preference given in the user message — it overrides any emoji habit implied by the selected tone.
- If one or more images are attached, use their visible content (chart, meme, screenshot, etc.) to make the reply more specific and relevant.
- Match the selected tone and stay relevant to the post.
- Return only JSON matching this shape: {"replies":[{"text":"..."}]}. If the user message asks you to auto-pick the tone, also include a top-level "tone" field naming the exact tone id you chose (e.g. {"tone":"smart","replies":[{"text":"..."}]}), and apply that same tone to every reply in the batch.`;

// X's own free-tier post limit — the classic "one tweet" length. Anything
// requested above this only makes sense for accounts on a paid X plan that
// raises the cap (Premium: 4,000, Premium+: 25,000), so it's the threshold
// for switching from single-block to paragraph-broken long-form structure.
const SHORT_FORM_LIMIT = 280;

function lengthGuidance(maxLength: GenerateReplyRequest["maxLength"]): string {
  if (maxLength === "auto") {
    return "No fixed character target — pick whatever length reads most natural for the selected tone and this specific post (a short punchy reaction and a longer thought are both fine), capped at 280 characters. Prioritize a complete, natural-sounding reply over hitting any particular length.";
  }
  const base = `${maxLength} characters, hard limit — an upper bound to fill sensibly, not a reason to default to something short. The reply as written must already be complete and fit within this; never write something that relies on being cut off.`;
  if (maxLength <= SHORT_FORM_LIMIT) return base;
  // Capped percentages of maxLength, not a flat percentage all the way up —
  // calibrated against a real reference example (~550-600 chars for a
  // genuinely long-form, multi-beat X post), not an arbitrary guess. A vague
  // "use the room" instruction alone wasn't enough in practice (live testing
  // still produced ~220-260 char replies at maxLength 4000) — LLMs are bad
  // at judging "how long" from prose alone but follow concrete numeric
  // targets far more reliably. The cap keeps a 25,000 ceiling from pushing
  // toward an essay by default; the model can still go further if the post
  // genuinely warrants it, this is a floor/target, not a second hard limit.
  const softFloor = Math.min(500, Math.round(maxLength * 0.15));
  const softTarget = Math.min(1_200, Math.round(maxLength * 0.35));
  return `${base} This is long-form, well beyond the classic 280-char tweet length — you are not restricted to typical short-tweet brevity here. Don't just stretch a single quick reaction with filler words: actually develop the reply with at least 2-3 distinct angles on the post — react to a specific detail, add relevant context or a comparison, close with an implication or follow-up thought — the way a real person elaborating on something they actually care about would write it. Structure it as short paragraphs separated by a blank line, roughly one per angle, the way real long-form X posts actually read, not one dense unbroken block of text. As a rough guide, a well-developed reply at this length usually lands around ${softFloor}-${softTarget} characters — a reply notably under ${softFloor} characters is almost always underusing the room you were given. Brevity-focused tones (one_liner, single_word, short_alpha) are the exception and should stay true to their own brevity regardless of this ceiling.`;
}

function toneSection(tone: GenerateReplyRequest["tone"]): string {
  if (tone === "auto") {
    const list = TONES.map((candidate) => `- ${candidate}: ${TONE_GUIDANCE[candidate]}`).join("\n");
    return `Auto — pick whichever single tone below best fits this specific post, and use that same tone consistently for every requested reply. Report your choice as a top-level "tone" field in the JSON response, using the exact id (e.g. "smart").\n\n${list}`;
  }
  return `${tone} — ${TONE_GUIDANCE[tone]}`;
}

export function buildUserPrompt(input: GenerateReplyRequest): string {
  const thread = input.visibleThreadText?.length
    ? input.visibleThreadText.map((text, index) => `${index + 1}. ${text}`).join("\n")
    : "None";

  return `Original post:
${input.postText || "(No caption text — reply based on the attached image below.)"}

Author:
${[input.authorName, input.authorHandle].filter(Boolean).join(" ") || "Unknown"}

Visible thread context:
${thread}

Selected tone:
${toneSection(input.tone)}

Extra user instruction:
${input.extraInstruction || "None"}

Character limit per reply:
${lengthGuidance(input.maxLength)}

Emoji preference:
${input.useEmoji ? "Emojis are OK if they fit the tone naturally, but don't overuse them." : "Do not use any emojis in this reply, even if the tone would normally suggest them."}
${input.imageUrls?.length ? `\n${input.imageUrls.length > 1 ? `${input.imageUrls.length} images are` : "An image is"} attached to this post below. Use what ${input.imageUrls.length > 1 ? "they visibly show" : "it visibly shows"} to inform the reply.\n` : ""}
Generate ${input.count} replies, each genuinely distinct in structure and angle (not reworded restatements of each other). Return JSON only.`;
}
