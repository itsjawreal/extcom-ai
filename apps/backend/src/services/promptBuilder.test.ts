import assert from "node:assert/strict";
import test from "node:test";
import { buildPostPrompt, buildUserPrompt, POST_SYSTEM_PROMPT, SYSTEM_PROMPT } from "./promptBuilder.js";

test("SYSTEM_PROMPT does not bias every reply toward being short", () => {
  // Regression: an unconditional "generate short replies" opening line
  // out-biased the per-request length guidance, so long-form maxLength
  // values (4000/25000) still produced ~150-220 char replies in practice.
  assert.doesNotMatch(SYSTEM_PROMPT, /Generate short/);
});

test("SYSTEM_PROMPT enforces the per-post language choice", () => {
  // Previously there was no language instruction at all, so a non-English
  // post (e.g. Indonesian) could still get an English reply — tone guidance
  // and examples in this file are all written in English, with nothing
  // steering the model toward matching the post's own language instead.
  assert.match(SYSTEM_PROMPT, /Follow the "Required reply language"/);
  assert.match(SYSTEM_PROMPT, /overrides.*conflicting extra instruction/);
});

test("buildUserPrompt uses X language metadata for any post language", () => {
  const prompt = buildUserPrompt({
    postText: "Pasar lagi ramai hari ini",
    sourceLanguage: "id",
    replyLanguage: "post",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /Required reply language:\nIndonesian \(id\)/);
  assert.match(prompt, /Write every reply in this language/);
  assert.match(prompt, /native Indonesian speaker on X/);
  assert.match(prompt, /not as translated English/);
  assert.match(prompt, /avoiding stiff translationese/);
});

test("buildUserPrompt can force English for a non-English post", () => {
  const prompt = buildUserPrompt({
    postText: "Pasar lagi ramai hari ini",
    sourceLanguage: "id",
    replyLanguage: "en",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /Required reply language:\nEnglish \(en\)/);
  assert.match(prompt, /explicit user override/);
});

test("buildUserPrompt falls back to post-text inference without X metadata", () => {
  const prompt = buildUserPrompt({
    postText: "bullish",
    replyLanguage: "post",
    tone: "degen",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /X supplied no language metadata/);
  assert.match(prompt, /infer it from Original post only/);
  assert.match(prompt, /directly as a native speaker/);
  assert.match(prompt, /never produce wording that feels translated from English/);
});

test("non-Indonesian post languages also receive native social-register guidance", () => {
  const prompt = buildUserPrompt({
    postText: "Qué locura",
    sourceLanguage: "es",
    replyLanguage: "post",
    tone: "funny",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /Spanish \(es\)/);
  assert.match(prompt, /native speaker composing for social media/);
  assert.match(prompt, /Avoid literal English sentence structure or textbook phrasing/);
});

test("emoji ON requires a relevant emoji in every reply", () => {
  const prompt = buildUserPrompt({
    postText: "This is huge",
    tone: "bullish",
    count: 3,
    maxLength: 220,
    useEmoji: true,
  });
  assert.match(prompt, /Include at least one relevant emoji in every reply/);
  assert.match(prompt, /Usually use exactly 1/);
  assert.match(prompt, /use at most 2/);
  assert.match(SYSTEM_PROMPT, /Emoji preference.*authoritative/);
  assert.match(SYSTEM_PROMPT, /overrides the selected tone, persona, and any conflicting extra instruction/);
});

test("emoji OFF prohibits emojis", () => {
  const prompt = buildUserPrompt({
    postText: "This is huge",
    tone: "bullish",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /Do not use any emojis in this reply/);
  assert.doesNotMatch(prompt, /Include at least one relevant emoji/);
});

test("never-mention rules are explicit and authoritative", () => {
  const prompt = buildUserPrompt({
    postText: "Bitcoin is pumping",
    tone: "ct_maxi",
    count: 1,
    maxLength: 220,
    useEmoji: false,
    blockedTerms: ["Bitcoin", "pump and dump"],
  });
  assert.match(prompt, /Never mention \(absolute output ban\):\n- "Bitcoin"\n- "pump and dump"/);
  assert.match(SYSTEM_PROMPT, /Never mention.*absolute/);
  assert.match(SYSTEM_PROMPT, /overrides tone, persona, source-post wording, and any conflicting extra instruction/);
});

test("short-form maxLength does not add the long-form paragraph instruction", () => {
  const prompt = buildUserPrompt({
    postText: "Post",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /220 characters, hard limit/);
  assert.doesNotMatch(prompt, /short paragraphs separated by a blank line/);
});

test("long-form maxLength adds the paragraph-structure instruction", () => {
  const prompt = buildUserPrompt({
    postText: "Post",
    tone: "smart",
    count: 1,
    maxLength: 4_000,
    useEmoji: false,
  });
  assert.match(prompt, /4000 characters, hard limit/);
  assert.match(prompt, /short paragraphs separated by a blank line/);
  // Regression: this instruction is what actually counteracts the general
  // brevity bias for long-form requests — without it the model kept
  // writing ~150-220 char replies even at maxLength 4000/25000.
  assert.match(prompt, /not restricted to typical short-tweet brevity/);
  // Regression 2: even after the above, live testing showed the model
  // still defaulted to ~200-260 char replies at maxLength 4000 — a bare
  // "you're allowed to go longer" permission gave it no concrete reason to
  // actually elaborate. This directive asks for real content structure
  // (multiple angles) so length grows from depth, not from padding.
  assert.match(prompt, /at least 2-3 distinct angles/);
  // Regression 3: prose permission alone still wasn't enough — LLMs follow
  // concrete numeric targets far more reliably than "use the room" language.
  // 4000 * 0.15 = 600, capped at 500; 4000 * 0.35 = 1400, capped at 1200.
  assert.match(prompt, /500-1200 range/);
  // Regression 4: even the earlier "as a rough guide, usually lands
  // around X-Y" phrasing under-delivered in practice (~300-315 char
  // replies against a 500 floor) — softer than the upper-bound wording.
  // Mirroring that same "firm" framing for the floor is the next attempt.
  assert.match(prompt, /firm minimum/);
});

test("the soft length target plateaus instead of scaling all the way to a very high maxLength", () => {
  // At maxLength 25000, a flat percentage would suggest a multi-thousand
  // character target — closer to a standalone essay than a reply. The
  // target should plateau at the same reasonable "developed reply" range
  // used for 4000, not balloon just because the ceiling is technically higher.
  const prompt = buildUserPrompt({
    postText: "Post",
    tone: "smart",
    count: 1,
    maxLength: 25_000,
    useEmoji: false,
  });
  assert.match(prompt, /25000 characters, hard limit/);
  assert.match(prompt, /500-1200 range/);
  // Regression 4: even the earlier "as a rough guide, usually lands
  // around X-Y" phrasing under-delivered in practice (~300-315 char
  // replies against a 500 floor) — softer than the upper-bound wording.
  // Mirroring that same "firm" framing for the floor is the next attempt.
  assert.match(prompt, /firm minimum/);
});

test("auto maxLength keeps the 280-char cap and no long-form instruction", () => {
  const prompt = buildUserPrompt({
    postText: "Post",
    tone: "smart",
    count: 1,
    maxLength: "auto",
    useEmoji: false,
  });
  assert.match(prompt, /capped at 280 characters/);
  assert.doesNotMatch(prompt, /short paragraphs separated by a blank line/);
});

test("buildUserPrompt omits the Persona section when no persona voice is given", () => {
  const prompt = buildUserPrompt({
    postText: "Post",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.doesNotMatch(prompt, /Persona — who you are replying as/);
  assert.match(prompt, /^Original post:/);
});

test("buildUserPrompt puts the Persona section first when a persona voice is given", () => {
  const prompt = buildUserPrompt(
    { postText: "Post", tone: "smart", count: 1, maxLength: 220, useEmoji: false },
    "A blunt crypto trader, skeptical of hype.",
  );
  assert.match(prompt, /^Persona — who you are replying as:\nA blunt crypto trader, skeptical of hype\.\n\nOriginal post:/);
});

test("buildPostPrompt creates standalone fresh-post instructions", () => {
  const prompt = buildPostPrompt({
    brief: "Open source AI is having a moment",
    mode: "fresh",
    language: "brief",
    tone: "smart",
    count: 3,
    maxLength: 280,
    useEmoji: false,
  });
  assert.match(POST_SYSTEM_PROMPT, /standalone post writer/);
  assert.match(POST_SYSTEM_PROMPT, /never address an unnamed author/);
  assert.match(prompt, /Writing mode:\nFresh post/);
  assert.match(prompt, /Required post language:\nSame language as the source/);
  assert.match(prompt, /Generate 3 complete standalone posts/);
  assert.doesNotMatch(prompt, /Original post:/);
});

test("fresh mode uses X composer text when the separate brief is empty", () => {
  const prompt = buildPostPrompt({
    brief: "",
    existingDraft: "Robotics hardware is converging; software is the moat.",
    mode: "fresh",
    language: "brief",
    tone: "smart",
    count: 1,
    maxLength: 280,
    useEmoji: false,
  });
  assert.match(prompt, /Brief \/ topic:\nNone — use the existing draft as source material\./);
  assert.match(prompt, /Existing composer draft:\nRobotics hardware is converging; software is the moat\./);
  assert.match(prompt, /Writing mode:\nFresh post/);
});

test("rewrite preserves source claims and supports English override", () => {
  const prompt = buildPostPrompt({
    brief: "Make this cleaner",
    existingDraft: "Pasar naik 20% hari ini",
    mode: "rewrite",
    language: "en",
    tone: "smart",
    count: 1,
    maxLength: 280,
    useEmoji: false,
  });
  assert.match(prompt, /Rewrite — preserve.*factual claims/);
  assert.match(prompt, /Required post language:\nEnglish \(en\)/);
  assert.match(prompt, /Pasar naik 20% hari ini/);
});

test("continue asks for a complete combined post without repetition", () => {
  const prompt = buildPostPrompt({
    brief: "Finish the thought",
    existingDraft: "Builders keep shipping through every cycle",
    mode: "continue",
    language: "brief",
    tone: "degen",
    count: 1,
    maxLength: 220,
    useEmoji: true,
    blockedTerms: ["wagmi"],
  });
  assert.match(prompt, /Continue — extend.*without restating its opening/);
  assert.match(prompt, /Return the complete combined post/);
  assert.match(prompt, /Never mention \(absolute output ban\):\n- "wagmi"/);
  assert.match(prompt, /Include at least one relevant emoji/);
});

test("prompts without an objective contain no engagement-goal section", () => {
  // Plan §19.8 inert-when-absent gate: the objective mechanism must leave
  // objective-less prompts byte-identical to the pre-objective output,
  // including section spacing around the tone block.
  const replyPrompt = buildUserPrompt({
    postText: "Post",
    replyLanguage: "post",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  const postPrompt = buildPostPrompt({
    brief: "topic",
    mode: "fresh",
    language: "brief",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  for (const prompt of [replyPrompt, postPrompt]) {
    assert.doesNotMatch(prompt, /Engagement goal/);
  }
  assert.match(replyPrompt, /short clauses, not one long analyst run-on sentence\.\n\nRequired reply language:/);
  assert.match(postPrompt, /short clauses, not one long analyst run-on sentence\.\n\nRequired post language:/);
});

test("each objective adds its guidance exactly once, after the tone section", () => {
  const base = {
    postText: "Post",
    replyLanguage: "post" as const,
    tone: "smart" as const,
    count: 1,
    maxLength: 220,
    useEmoji: false,
  };
  const expectations: Array<[string, RegExp]> = [
    ["viral", /viral — Maximize shareability .*first line must stand alone as a hook/],
    ["replies", /replies — Maximize direct replies\. .*exactly one genuine, low-barrier question/],
    ["debate", /debate — Provoke substantive disagreement\. .*one honest opening for pushback/],
    ["value", /value — Maximize bookmarks and saves\. .*immediately usable takeaway/],
  ];
  for (const [objective, pattern] of expectations) {
    const prompt = buildUserPrompt({ ...base, objective: objective as never });
    assert.match(prompt, pattern);
    assert.equal(prompt.match(/Engagement goal/g)?.length, 1);
    // Ordering: tone section first, then goal, then language.
    assert.match(prompt, /Selected tone:\n[\s\S]*\nEngagement goal for every reply:\n[\s\S]*Required reply language:/);
    // The override hierarchy stays stated inside the section.
    assert.match(prompt, /never overrides the safety rules, Never mention rules, emoji preference, required language, or character limit/);
  }
});

test("post prompts carry the objective with post wording", () => {
  const prompt = buildPostPrompt({
    brief: "topic",
    mode: "fresh",
    language: "brief",
    tone: "funny",
    objective: "value",
    count: 2,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /Engagement goal for every post:\nvalue — /);
  assert.match(prompt, /Selected tone:\n[\s\S]*\nEngagement goal for every post:\n[\s\S]*Required post language:/);
});

test("auto tone with an objective asks the model to pick a goal-serving tone", () => {
  const prompt = buildUserPrompt({
    postText: "Post",
    replyLanguage: "post",
    tone: "auto",
    objective: "viral",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.match(prompt, /If the selected tone is Auto, pick the tone that best serves this goal/);
});

test("both system prompts carry a hook-first rule that spares brevity tones", () => {
  // Plan §19 Phase A2: a deliberate Default-output change, separate from the
  // inert objective mechanism.
  assert.match(SYSTEM_PROMPT, /Lead with the reply's strongest, most specific element/);
  assert.match(POST_SYSTEM_PROMPT, /opening line must carry the post's strongest specific element/);
  assert.match(POST_SYSTEM_PROMPT, /timeline preview shows only the first couple of lines/);
  for (const prompt of [SYSTEM_PROMPT, POST_SYSTEM_PROMPT]) {
    assert.match(prompt, /one_liner, single_word, short_alpha/);
  }
});

test("post prompts without a quoted post contain no quote section", () => {
  const prompt = buildPostPrompt({
    brief: "topic",
    mode: "fresh",
    language: "brief",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
  });
  assert.doesNotMatch(prompt, /Quoted post/);
  assert.doesNotMatch(POST_SYSTEM_PROMPT, /undefined/);
});

test("a quoted post adds commentary context, quote-aware mode, and language fallback", () => {
  const prompt = buildPostPrompt({
    brief: "",
    mode: "fresh",
    language: "brief",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
    quotedPost: {
      text: "Nanweng River unfolds like a magnificent scroll",
      authorName: "China Says",
      authorHandle: "@China_says",
      imageUrls: [
        "https://pbs.twimg.com/media/a?format=jpg&name=small",
        "https://pbs.twimg.com/media/b?format=jpg&name=small",
      ],
      sourceLanguage: "en",
    },
  });
  assert.match(prompt, /Quoted post \(every draft will be published as a quote-tweet directly above it\):/);
  assert.match(prompt, /Author: China Says @China_says/);
  assert.match(prompt, /Nanweng River unfolds/);
  assert.match(prompt, /2 images from the quoted post are attached below/);
  assert.match(prompt, /Language detected by X on the quoted post: en/);
  assert.match(prompt, /compose the user's own quote-tweet commentary/);
  assert.match(prompt, /infer the language from the quoted post instead/);
  assert.match(prompt, /None — write the user's own take on the quoted post below\./);
  // Section order: quoted post before writing mode.
  assert.match(prompt, /Quoted post [\s\S]*Writing mode:/);
});

test("quote-aware rewrite and continue stay consistent with the quoted post", () => {
  const base = {
    brief: "",
    existingDraft: "my hot take on this",
    language: "brief" as const,
    tone: "smart" as const,
    count: 1,
    maxLength: 220,
    useEmoji: false,
    quotedPost: { text: "original tweet", authorHandle: "@x" },
  };
  const rewrite = buildPostPrompt({ ...base, mode: "rewrite" });
  assert.match(rewrite, /Keep the rewritten take consistent with the quoted post/);
  const cont = buildPostPrompt({ ...base, mode: "continue" });
  assert.match(cont, /continuation must stay consistent with the quoted post/);
});

test("an image-only quoted post is described as such", () => {
  const prompt = buildPostPrompt({
    brief: "",
    mode: "fresh",
    language: "brief",
    tone: "smart",
    count: 1,
    maxLength: 220,
    useEmoji: false,
    quotedPost: { text: "", authorHandle: "@x", imageUrls: ["https://pbs.twimg.com/media/a"] },
  });
  assert.match(prompt, /\(No caption text — an image-only post\.\)/);
  assert.match(prompt, /1 image from the quoted post is attached below/);
});

test("POST_SYSTEM_PROMPT defines quote-tweet commentary semantics", () => {
  assert.match(POST_SYSTEM_PROMPT, /quote-tweet commentary published directly above that post/);
  assert.match(POST_SYSTEM_PROMPT, /never merely paraphrase or summarize/);
  assert.match(POST_SYSTEM_PROMPT, /never address the quoted author as if replying/);
});
