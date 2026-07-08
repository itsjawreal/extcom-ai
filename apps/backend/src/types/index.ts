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
    plan: "free" | "pro" | "power";
  };
};

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_TOKEN"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "UNSAFE_REQUEST"
  | "ADMIN_DISABLED"
  | "INTERNAL_ERROR";
