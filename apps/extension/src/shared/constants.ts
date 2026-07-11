import type { Tone } from "./types";

export const TONE_LABELS: Record<Tone, string> = {
  degen: "Degen",
  bullish: "Bullish",
  smart: "Smart Money",
  funny: "Funny",
  respectful: "Respectful",
  short_alpha: "Short Alpha",
  one_liner: "One-Liner",
  single_word: "Single Word",
  ct_maxi: "CT Maxi",
  alpha_drop: "Alpha Drop",
  unhinged_degen: "Unhinged Degen",
  hype_founder: "Hype Founder",
  bold_populist: "Bold Populist",
  unhinged_meme: "Unhinged Meme",
  supportive_hype: "Supportive Hype",
  contrarian_take: "Contrarian Take",
  engager_question: "Engager Question",
  sarcastic_dry: "Sarcastic & Dry",
  wholesome: "Wholesome",
  hot_take: "Hot Take",
  roast: "Roast",
  formal_corporate: "Formal Corporate",
  philosophical: "Philosophical",
  coach_motivational: "Coach Motivational",
};

export const TONE_AUTO_LABEL = "Auto (AI picks)";

// Tone/label lookup that also covers the "auto" sentinel — TONE_LABELS
// itself stays keyed by the 24 real tones only, matching the backend.
export function toneLabel(value: Tone | "auto" | string): string {
  if (value === "auto") return TONE_AUTO_LABEL;
  return TONE_LABELS[value as Tone] ?? value;
}

// Partial defaults for reference only — the authoritative DEFAULT_SETTINGS
// (with all 8 fields) lives in serviceWorker.ts to keep the source of truth
// in one place and prevent divergence.
export const DEFAULT_SETTINGS_PARTIAL = {
  backendBaseUrl: "http://localhost:3000",
  authToken: "dev-local-token",
  toneDefault: "degen",
  defaultInstruction: "",
} as const;
