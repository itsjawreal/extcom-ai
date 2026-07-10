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
  tone: Tone;
  extraInstruction?: string;
  count: number;
  maxLength: number;
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
  toneDefault: Tone;
  defaultInstruction: string;
  maxReplyLength: number;
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
};

export type UsageStats = {
  totalGenerations: number;
  totalInserted: number;
  history: HistoryEntry[];
};
