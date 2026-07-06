export const TONES = [
  "degen",
  "bullish",
  "smart",
  "funny",
  "respectful",
  "short_alpha",
] as const;

export type Tone = (typeof TONES)[number];

export type GenerateReplyRequest = {
  postText: string;
  authorHandle?: string;
  authorName?: string;
  postUrl?: string;
  visibleThreadText?: string[];
  tone: Tone;
  extraInstruction?: string;
  count: number;
};

export type GeneratedReply = {
  id: string;
  text: string;
  tone: Tone;
};

export type GenerateReplyResponse = {
  replies: GeneratedReply[];
  usage: {
    remainingToday: number | null;
    plan: "development";
  };
};

export type ApiErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "UNSAFE_REQUEST"
  | "INTERNAL_ERROR";
