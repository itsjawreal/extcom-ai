import assert from "node:assert/strict";
import test from "node:test";
import { buildUserPrompt, SYSTEM_PROMPT } from "./promptBuilder.js";

test("SYSTEM_PROMPT does not bias every reply toward being short", () => {
  // Regression: an unconditional "generate short replies" opening line
  // out-biased the per-request length guidance, so long-form maxLength
  // values (4000/25000) still produced ~150-220 char replies in practice.
  assert.doesNotMatch(SYSTEM_PROMPT, /Generate short/);
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
