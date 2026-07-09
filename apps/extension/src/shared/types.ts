export type Tone =
  | "degen"
  | "bullish"
  | "smart"
  | "funny"
  | "respectful"
  | "short_alpha";

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
  visibleThreadText?: string[];
  timestampText?: string;
};

export type GenerateReplyRequest = ExtractedPostContext & {
  tone: Tone;
  extraInstruction?: string;
  count: number;
  maxLength: number;
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
