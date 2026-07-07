import type { FakeReply, Tone } from "./types";

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
} as const;

export const FAKE_REPLIES: Record<Tone, FakeReply[]> = {
  degen: [
    { id: "degen-1", text: "ngl this is the kind of setup CT sleeps on until it is everywhere" },
    { id: "degen-2", text: "timeline is still early on this one" },
    { id: "degen-3", text: "clean setup, the timeline will catch up eventually" },
  ],
  bullish: [
    { id: "bullish-1", text: "the narrative is clean and the timing looks stronger than people think" },
    { id: "bullish-2", text: "early attention plus solid execution can get interesting fast" },
    { id: "bullish-3", text: "momentum is building without the usual noise" },
  ],
  smart: [
    { id: "smart-1", text: "attention is still early here, which is usually where the asymmetry appears" },
    { id: "smart-2", text: "distribution and timing matter more than raw hype at this stage" },
    { id: "smart-3", text: "the signal is the steady attention before broader consensus" },
  ],
  funny: [
    { id: "funny-1", text: "timeline is about to pretend it saw this coming" },
    { id: "funny-2", text: "bookmarking this before everyone becomes an expert tomorrow" },
    { id: "funny-3", text: "the group chat will discover this three days late" },
  ],
  respectful: [
    { id: "respectful-1", text: "solid take. the point about timing is what many people are missing" },
    { id: "respectful-2", text: "well explained, especially the distinction between attention and conviction" },
    { id: "respectful-3", text: "useful perspective. the execution details make the thesis much clearer" },
  ],
  short_alpha: [
    { id: "alpha-1", text: "attention before consensus is the edge" },
    { id: "alpha-2", text: "distribution is the signal" },
    { id: "alpha-3", text: "watch momentum, not noise" },
  ],
};
