export const TONES = [
  "degen",
  "bullish",
  "smart",
  "funny",
  "respectful",
  "short_alpha",
  "one_liner",
  "single_word",
  "ct_maxi",
  "alpha_drop",
  "unhinged_degen",
  "hype_founder",
  "bold_populist",
  "unhinged_meme",
  "supportive_hype",
  "contrarian_take",
  "engager_question",
  "sarcastic_dry",
  "wholesome",
  "hot_take",
  "roast",
  "formal_corporate",
  "philosophical",
  "coach_motivational",
] as const;

export type Tone = (typeof TONES)[number];

export type GenerateReplyRequest = {
  postText: string;
  authorHandle?: string;
  authorName?: string;
  postUrl?: string;
  visibleThreadText?: string[];
  imageUrl?: string;
  // "auto" means the AI picks whichever single tone best fits this post,
  // applied consistently across every reply in the batch — the resolved
  // tone (never "auto") is echoed back per-reply in GeneratedReply.tone.
  tone: Tone | "auto";
  extraInstruction?: string;
  count: number;
  // "auto" means no fixed character target — the AI picks whatever length
  // reads most natural for the tone/post, capped only by a safety ceiling.
  maxLength: number | "auto";
  useEmoji: boolean;
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
