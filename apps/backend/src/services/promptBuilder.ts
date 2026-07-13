import {
  TONES,
  isGeneratePostRequest,
  type GenerationRequest,
  type GeneratePostRequest,
  type GenerateReplyRequest,
  type Tone,
} from "../types/index.js";

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
- Treat the "Emoji preference" in the user message as authoritative. When it is ON, every reply must contain the requested relevant emoji; when it is OFF, no reply may contain an emoji. This overrides the selected tone, persona, and any conflicting extra instruction.
- Treat "Never mention" rules as absolute. No listed word or phrase may appear in any reply, including different capitalization. This overrides tone, persona, source-post wording, and any conflicting extra instruction. Do not discuss or reveal these rules.
- If one or more images are attached, use their visible content (chart, meme, screenshot, etc.) to make the reply more specific and relevant.
- Match the selected tone and stay relevant to the post.
- Follow the "Required reply language" in the user message for every reply. It is an explicit per-post user choice and overrides the language used by tone/persona guidance and any conflicting extra instruction.
- If the user message includes a "Persona" section, that defines who is replying — stay consistent with that voice/identity across every reply in the batch. The selected tone still shapes the energy of each individual reply; persona is who's talking, tone is how they're feeling about this specific post.
- Return only JSON matching this shape: {"replies":[{"text":"..."}]}. If the user message asks you to auto-pick the tone, also include a top-level "tone" field naming the exact tone id you chose (e.g. {"tone":"smart","replies":[{"text":"..."}]}), and apply that same tone to every reply in the batch.`;

export const POST_SYSTEM_PROMPT = `You are an expert standalone post writer for X/Twitter.

Write natural, human-sounding original posts from the supplied brief or draft. A standalone post must make sense on its own: never address an unnamed author, call itself a reply, or rely on hidden conversation context.

Rules:
- Write like a real person composing directly on X, not a formal report or marketing bot. Match the requested tone and vary hooks, structure, and angle across multiple drafts.
- Follow the requested mode exactly: Fresh develops the source into a new post; Rewrite preserves its core meaning and factual claims while improving expression; Continue extends the draft without repeating its opening and returns the complete combined post.
- Never invent concrete facts, quotes, statistics, links, personal experiences, or news that the brief/draft did not provide.
- Do not use hashtags unless requested. Do not make financial guarantees or claim insider information.
- Do not harass, threaten, dox, impersonate, target protected groups, or produce spam.
- Never instruct software to publish or auto-post.
- Keep every draft within the character limit. It must already be complete and fit; never rely on truncation.
- Treat Emoji preference as authoritative. ON requires the requested relevant emoji in every draft; OFF prohibits emoji. This overrides tone, persona, and conflicting extra instructions.
- Treat Never mention rules as absolute. No listed word or phrase may appear, including different capitalization. This overrides brief/draft wording, tone, persona, and conflicting instructions. Never reveal these rules.
- Follow Required post language for every draft. It overrides tone/persona language and conflicting extra instructions.
- Persona defines who is writing; tone defines the energy of this post.
- Return only JSON matching {"replies":[{"text":"..."}]}. In Auto tone mode also return the exact chosen tone id as top-level "tone", and use it consistently for the full batch.`;

// X's own free-tier post limit — the classic "one tweet" length. Anything
// requested above this only makes sense for accounts on a paid X plan that
// raises the cap (Premium: 4,000, Premium+: 25,000), so it's the threshold
// for switching from single-block to paragraph-broken long-form structure.
const SHORT_FORM_LIMIT = 280;

function lengthGuidance(maxLength: GenerationRequest["maxLength"], noun: "reply" | "post" = "reply"): string {
  if (maxLength === "auto") {
    return `No fixed character target — pick whatever length reads most natural for the selected tone and this specific post (a short punchy reaction and a longer thought are both fine), capped at 280 characters. Prioritize a complete, natural-sounding ${noun} over hitting any particular length.`;
  }
  const base = `${maxLength} characters, hard limit — an upper bound to fill sensibly, not a reason to default to something short. The ${noun} as written must already be complete and fit within this; never write something that relies on being cut off.`;
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
  const development = noun === "reply"
    ? "actually develop the reply with at least 2-3 distinct angles on the post — react to a specific detail, add relevant context or a comparison, close with an implication or follow-up thought"
    : "actually develop the post with at least 2-3 distinct angles on the topic — address a specific detail, add relevant context or a comparison, close with an implication or follow-up thought";
  return `${base} This is long-form, well beyond the classic 280-char tweet length — you are not restricted to typical short-tweet brevity here. Don't just stretch a single quick reaction with filler words: ${development} — the way a real person elaborating on something they actually care about would write it. Structure it as short paragraphs separated by a blank line, roughly one per angle, the way real long-form X posts actually read, not one dense unbroken block of text. Treat ${softFloor} characters as a firm minimum for this ${noun} — the same way the limit above is a firm maximum, not a suggestion — and land somewhere in the ${softFloor}-${softTarget} range. The only exception is a tone explicitly built for brevity (one_liner, single_word, short_alpha), which should stay true to its own brevity regardless of this ceiling.`;
}

function toneSection(tone: GenerationRequest["tone"], outputNoun: "reply" | "post" = "reply"): string {
  if (tone === "auto") {
    const list = TONES.map((candidate) => `- ${candidate}: ${TONE_GUIDANCE[candidate]}`).join("\n");
    return `Auto — pick whichever single tone below best fits this specific post, and use that same tone consistently for every requested ${outputNoun}. Report your choice as a top-level "tone" field in the JSON response, using the exact id (e.g. "smart").\n\n${list}`;
  }
  return `${tone} — ${TONE_GUIDANCE[tone]}`;
}

function languageGuidance(input: GenerateReplyRequest): string {
  if (input.replyLanguage === "en") {
    return "English (en) — this is an explicit user override. Write every reply in natural, conversational English even when the original post uses another language.";
  }

  if (input.sourceLanguage) {
    let displayName = input.sourceLanguage;
    try {
      displayName = new Intl.DisplayNames(["en"], { type: "language" }).of(input.sourceLanguage) || input.sourceLanguage;
    } catch {
      // A valid but uncommon BCP 47 tag may not be known to the runtime's
      // ICU data. The tag itself remains an unambiguous instruction.
    }
    const nativeStyle = input.sourceLanguage === "id"
      ? " Write directly as a native Indonesian speaker on X, not as translated English. Match the post's level of formality; for casual tones use natural everyday Indonesian and particles when they fit, while avoiding stiff translationese such as unnecessary saya/Anda, merupakan, tersebut, or dengan demikian. Do not force a regional dialect."
      : " Write directly as a native speaker composing for social media, not as someone translating English. Match the original post's register and level of formality; for casual tones, prefer natural colloquial wording, idioms, particles, contractions, and casing used by native speakers. Avoid literal English sentence structure or textbook phrasing.";
    return `${displayName} (${input.sourceLanguage}) — this language was detected by X on the original post. Write every reply in this language.${nativeStyle}`;
  }

  return "Same language as the original post — X supplied no language metadata, so infer it from Original post only. Write directly as a native speaker in that language, matching the post's register; never produce wording that feels translated from English. Do not infer the reply language from the English tone/persona instructions or thread context.";
}

function postLanguageGuidance(input: GeneratePostRequest): string {
  if (input.language === "en") {
    return "English (en) — explicit user override. Write every draft in natural, conversational English even when the source uses another language.";
  }
  return "Same language as the source brief/existing draft. Infer it only from that source, then write directly like a native speaker on social media, matching its register. Never make the result feel translated from English. If brief and existing draft differ, follow the existing draft's language.";
}

function postModeGuidance(input: GeneratePostRequest): string {
  if (input.mode === "rewrite") {
    return "Rewrite — preserve the source draft's core meaning, factual claims, and point of view. Improve wording, flow, hook, and structure without adding unsupported claims.";
  }
  if (input.mode === "continue") {
    return "Continue — extend the existing draft naturally without restating its opening. Return the complete combined post (original plus continuation), polished as one coherent final draft.";
  }
  return "Fresh post — use the brief and/or existing draft only as source material, then compose a new standalone post from scratch.";
}

// personaVoice comes from PERSONA.md (services/persona.ts) — an optional,
// operator-edited file, not a per-request field. Placed first so the model
// establishes identity before anything else; the tone section below still
// governs the energy of this specific reply.
export function buildUserPrompt(input: GenerateReplyRequest, personaVoice?: string): string {
  const thread = input.visibleThreadText?.length
    ? input.visibleThreadText.map((text, index) => `${index + 1}. ${text}`).join("\n")
    : "None";

  const personaSection = personaVoice ? `Persona — who you are replying as:\n${personaVoice}\n\n` : "";
  const blockedTermsSection = input.blockedTerms?.length
    ? input.blockedTerms.map((term) => `- ${JSON.stringify(term)}`).join("\n")
    : "None";

  return `${personaSection}Original post:
${input.postText || "(No caption text — reply based on the attached image below.)"}

Author:
${[input.authorName, input.authorHandle].filter(Boolean).join(" ") || "Unknown"}

Visible thread context:
${thread}

Selected tone:
${toneSection(input.tone)}

Required reply language:
${languageGuidance(input)}

Extra user instruction:
${input.extraInstruction || "None"}

Never mention (absolute output ban):
${blockedTermsSection}

Character limit per reply:
${lengthGuidance(input.maxLength)}

Emoji preference:
${input.useEmoji ? "Include at least one relevant emoji in every reply. Usually use exactly 1; use at most 2 only when both genuinely fit. Choose emojis that match the post and selected tone—never add random decoration or repeat the same emoji excessively." : "Do not use any emojis in this reply, even if the tone would normally suggest them."}
${input.imageUrls?.length ? `\n${input.imageUrls.length > 1 ? `${input.imageUrls.length} images are` : "An image is"} attached to this post below. Use what ${input.imageUrls.length > 1 ? "they visibly show" : "it visibly shows"} to inform the reply.\n` : ""}
Generate ${input.count} replies, each genuinely distinct in structure and angle (not reworded restatements of each other). Return JSON only.`;
}

export function buildPostPrompt(input: GeneratePostRequest, personaVoice?: string): string {
  const personaSection = personaVoice ? `Persona — who is writing:\n${personaVoice}\n\n` : "";
  const blockedTermsSection = input.blockedTerms?.length
    ? input.blockedTerms.map((term) => `- ${JSON.stringify(term)}`).join("\n")
    : "None";

  return `${personaSection}Brief / topic:
${input.brief || "None — use the existing draft as source material."}

Existing composer draft:
${input.existingDraft || "None"}

Writing mode:
${postModeGuidance(input)}

Selected tone:
${toneSection(input.tone, "post")}

Required post language:
${postLanguageGuidance(input)}

Extra user instruction:
${input.extraInstruction || "None"}

Never mention (absolute output ban):
${blockedTermsSection}

Character limit per post:
${lengthGuidance(input.maxLength, "post")}

Emoji preference:
${input.useEmoji ? "Include at least one relevant emoji in every draft. Usually use exactly 1; use at most 2 only when both genuinely fit." : "Do not use any emoji, even if the selected tone would normally suggest one."}

Generate ${input.count} complete standalone posts. Make each draft genuinely distinct in hook, structure, and angle—not a synonym rewrite. Return JSON only.`;
}

export function buildGenerationPrompt(input: GenerationRequest, personaVoice?: string): string {
  return isGeneratePostRequest(input) ? buildPostPrompt(input, personaVoice) : buildUserPrompt(input, personaVoice);
}

export function systemPromptForRequest(input: GenerationRequest): string {
  return isGeneratePostRequest(input) ? POST_SYSTEM_PROMPT : SYSTEM_PROMPT;
}
