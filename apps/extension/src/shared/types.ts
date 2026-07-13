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
  // BCP 47 language tag exposed by X on the clicked post's tweetText node.
  // Undefined means X did not provide a usable language signal.
  sourceLanguage?: string;
  authorHandle?: string;
  authorName?: string;
  postUrl?: string;
  // Up to 4 images (X's own per-post max), in on-page display order.
  imageUrls?: string[];
  visibleThreadText?: string[];
  timestampText?: string;
};

export type GenerateReplyRequest = ExtractedPostContext & {
  // Per-panel language choice. "post" follows sourceLanguage (or lets the
  // model infer it when X supplied none); "en" is an explicit English override.
  replyLanguage?: "post" | "en";
  // "auto" means the AI picks whichever single tone best fits this post,
  // applied consistently across every reply in the batch — the resolved
  // tone (never "auto") is echoed back per-reply in GeneratedReply.tone.
  tone: Tone | "auto";
  extraInstruction?: string;
  blockedTerms?: string[];
  count: number;
  // "auto" means no fixed character target — the AI picks whatever length
  // reads most natural for the tone/post, capped only by a safety ceiling.
  maxLength: number | "auto";
  useEmoji: boolean;
  // Per-request override of the backend's AI_DEFAULT_MODEL. Omitted (or
  // empty) means "use whatever the backend has configured".
  model?: string;
};

export type ModelOption = {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
};

export type ModelsResponse = {
  models: ModelOption[];
  allowCustom: boolean;
};

export type GenerateReplyResponse = {
  replies: GeneratedReply[];
  usage: {
    remainingToday: number | null;
    plan: "free" | "pro" | "power";
  };
  // The model actually used to generate this response.
  model: string;
  // Absent when the provider didn't return usage data. estimatedCostUsd is
  // only present when the resolved model's pricing is available from
  // OpenRouter's live catalog (see backend services/modelCatalog.ts).
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd?: number;
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
  // Pinned tones shown as quick-pick chips in the popup and the on-page
  // panel, on top of the full tone dropdown. Capped at 5, "auto" excluded
  // (it's already always the first dropdown option).
  favoriteTones: Tone[];
  // Local-only rules sent transiently during generation. Never stored by
  // the backend or copied into history.
  blockedTerms: string[];
  // Empty string means "no override" — the backend's own AI_DEFAULT_MODEL
  // is used. Set from the Advanced tab's model dropdown/custom field.
  aiModel: string;
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
  // Absent for entries recorded before this field existed, or when the
  // provider didn't return usage data for that generation.
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
};

export type UsageStats = {
  totalGenerations: number;
  totalInserted: number;
  history: HistoryEntry[];
  // Tracks which history entries have been inserted (survives eviction from
  // history[] when cap is reached). Prevents insert count divergence.
  insertedIds?: Record<string, "reply" | "quote">;
  // Optional (like insertedIds above) so existing stored stats without these
  // fields don't need a migration — getUsageStats() normalizes them to 0.
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalEstimatedCostUsd?: number;
};
