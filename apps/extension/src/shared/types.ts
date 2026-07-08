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
};

export type ConnectionStatus = {
  plan: "free" | "pro" | "power";
  remainingToday: number;
};
