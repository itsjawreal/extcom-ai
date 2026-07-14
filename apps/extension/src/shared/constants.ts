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

// Reply-length landmarks shown above the slider, matching X's own post
// limits per plan: Free (280), Premium (4,000), Premium+ (25,000).
export const REPLY_LENGTH_PRESETS = [280, 4_000, 25_000] as const;

// The custom-length input has no native min/max enforcement like the range
// slider it replaced did, so popup/panel must clamp a typed value back into
// this range themselves before persisting it or sending a generation
// request — otherwise an out-of-bounds value either gets silently
// re-clamped on next read (popup settings) or rejected outright by the
// backend's own 50-25000 validation (panel, which sends it straight
// through), surfacing as a confusing generation error instead of just
// being corrected up front.
export const MIN_REPLY_LENGTH = 50;
export const MAX_REPLY_LENGTH = 25_000;
export const REPLY_LENGTH_SLIDER_MAX = 10_000;
export const MAX_BLOCKED_TERMS = 50;
export const MAX_BLOCKED_TERM_LENGTH = 80;

export function clampReplyLength(value: number): number {
  if (!Number.isFinite(value)) return MIN_REPLY_LENGTH;
  return Math.min(MAX_REPLY_LENGTH, Math.max(MIN_REPLY_LENGTH, Math.round(value)));
}

export function replyLengthToSliderPosition(value: number): number {
  const length = clampReplyLength(value);
  const progress = Math.log(length / MIN_REPLY_LENGTH) / Math.log(MAX_REPLY_LENGTH / MIN_REPLY_LENGTH);
  return Math.round(progress * REPLY_LENGTH_SLIDER_MAX);
}

export function sliderPositionToReplyLength(value: number): number {
  const position = Math.min(REPLY_LENGTH_SLIDER_MAX, Math.max(0, Math.round(value)));
  // Snap within 2% of a landmark. Outside those small zones the logarithmic
  // track stays continuous, with 10-character granularity.
  for (const preset of REPLY_LENGTH_PRESETS) {
    if (Math.abs(position - replyLengthToSliderPosition(preset)) <= REPLY_LENGTH_SLIDER_MAX * 0.02) return preset;
  }
  const progress = position / REPLY_LENGTH_SLIDER_MAX;
  const raw = MIN_REPLY_LENGTH * Math.pow(MAX_REPLY_LENGTH / MIN_REPLY_LENGTH, progress);
  return clampReplyLength(Math.round(raw / 10) * 10);
}

export function normalizeBlockedTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const term = item.trim().slice(0, MAX_BLOCKED_TERM_LENGTH);
    const key = term.normalize("NFKC").toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    normalized.push(term);
    if (normalized.length === MAX_BLOCKED_TERMS) break;
  }
  return normalized;
}

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

// Shared Auto heuristic for image reading (replies and post attachments):
// include images when they are the only content, the text is short enough
// that media likely carries the context, or the text explicitly points at
// visual/media content.
const VISUAL_CONTENT_PATTERN = /\b(?:image|images|photo|picture|pic|screenshot|screen shot|chart|graph|meme|video|visual|gambar|foto|tangkapan layar|grafik|bagan|imagen|captura|gr[aá]fico|capture|graphique|bild|diagramm|immagine|schermata|grafico|imagem)\b/iu;

export function autoIncludeImages(text: string, hasImages: boolean): boolean {
  if (!hasImages) return false;
  const trimmed = text.trim();
  return !trimmed || trimmed.length <= 120 || VISUAL_CONTENT_PATTERN.test(trimmed);
}
