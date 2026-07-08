import type { Tone } from "./types";

export const TONE_LABELS: Record<Tone, string> = {
  degen: "Degen",
  bullish: "Bullish",
  smart: "Smart Money",
  funny: "Funny",
  respectful: "Respectful",
  short_alpha: "Short Alpha",
};

export const DEFAULT_SETTINGS = {
  backendBaseUrl: "http://localhost:3000",
  authToken: "dev-local-token",
  toneDefault: "degen",
  defaultInstruction: "",
} as const;
