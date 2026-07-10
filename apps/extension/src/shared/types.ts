export type Tone =
  | "degen"
  | "bullish"
  | "smart"
  | "funny"
  | "respectful"
  | "short_alpha"
  | "one_liner"
  | "single_word"
  | "ct_maxi"
  | "alpha_drop"
  | "unhinged_degen"
  | "hype_founder"
  | "bold_populist"
  | "unhinged_meme"
  | "supportive_hype"
  | "contrarian_take"
  | "engager_question"
  | "sarcastic_dry"
  | "wholesome"
  | "hot_take"
  | "roast"
  | "formal_corporate"
  | "philosophical"
  | "coach_motivational";

export type GeneratedReply = {
  id: string;
  text: string;
  tone: Tone;
};

export type ExtractedPostContext = {
  postText: string;
  authorHandle?: string;
  authorName?: string;
  postUrl?: string;
  imageUrl?: string;
  visibleThreadText?: string[];
  timestampText?: string;
};

export type GenerateReplyRequest = ExtractedPostContext & {
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

export type GenerateReplyResponse = {
  replies: GeneratedReply[];
  usage: {
    remainingToday: number | null;
    plan: "free" | "pro" | "power";
  };
};

export type ExtensionSettings = {
  backendBaseUrl: string;
  authToken: string;
  toneDefault: Tone | "auto";
  defaultInstruction: string;
  maxReplyLength: number | "auto";
  draftCount: number;
  useEmoji: boolean;
  readImages: boolean;
};

export type ConnectionStatus = {
  plan: "free" | "pro" | "power";
  remainingToday: number;
};

export type HistoryEntry = {
  id: string;
  createdAt: string;
  postText: string;
  postUrl?: string;
  tone: Tone;
  drafts: string[];
  inserted: boolean;
  // Only set once inserted — which composer the draft was inserted into.
  insertKind?: "reply" | "quote";
};

export type UsageStats = {
  totalGenerations: number;
  totalInserted: number;
  history: HistoryEntry[];
};
