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

export type ReadImagesMode = "auto" | "off" | "on";

// Visibility of the floating ✦ button on X's right rail (plan §21):
// "always" also acts as a quick-actions launcher when no panel is open,
// "minimized" shows it only while a panel is minimized, and "off" hides
// the idle launcher. A minimized panel always keeps its temporary restore
// control so live drafts can never become trapped off-screen.
export type FloatingButtonMode = "always" | "minimized" | "off";

// Engagement goal — what the output should achieve, orthogonal to tone.
// Mirrors the backend's EngagementObjective; absent means no goal section
// in the prompt (today's behavior).
export type EngagementObjective = "viral" | "replies" | "debate" | "value";

export type ContentKind = "reply" | "quote" | "post";

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
  objective?: EngagementObjective;
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

export type GeneratePostMode = "fresh" | "rewrite" | "continue";

// A composer attachment prepared for upload: bounded, re-encoded when needed,
// stripped of filename/EXIF. Mirrors the backend contract in
// apps/backend/src/types/index.ts — keep the two in sync.
export type AttachedImageInput = {
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
};

// The tweet being quoted in X's quote composer, extracted from the preview
// card at Generate time (plan §20). Mirrors the backend contract — keep in
// sync with apps/backend/src/types/index.ts.
export type QuotedPostInput = {
  // May be "" for an image-only quoted tweet.
  text: string;
  authorHandle?: string;
  authorName?: string;
  // Up to 4 https X CDN URLs of the quoted tweet's own media.
  imageUrls?: string[];
  sourceLanguage?: string;
};

export type GeneratePostRequest = {
  brief: string;
  existingDraft?: string;
  mode: GeneratePostMode;
  language: "brief" | "en";
  tone: Tone | "auto";
  objective?: EngagementObjective;
  extraInstruction?: string;
  blockedTerms?: string[];
  count: number;
  maxLength: number | "auto";
  useEmoji: boolean;
  model?: string;
  // Up to 4 prepared composer attachments; bytes are read only after the
  // user selects Generate and are never persisted anywhere.
  attachedImages?: AttachedImageInput[];
  // Present only when generating inside a quote composer (plan §20).
  quotedPost?: QuotedPostInput;
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

export type GeneratePostResponse = Omit<GenerateReplyResponse, "replies"> & {
  posts: GeneratedReply[];
};

export type ExtensionSettings = {
  backendBaseUrl: string;
  authToken: string;
  toneDefault: Tone | "auto";
  defaultInstruction: string;
  maxReplyLength: number | "auto";
  draftCount: number;
  useEmoji: boolean;
  readImages: ReadImagesMode;
  // Saved default engagement goal; "none" keeps today's behavior. The
  // panels open with this value and can override it per-session.
  objectiveDefault: EngagementObjective | "none";
  floatingButton: FloatingButtonMode;
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
  // Optional for backward compatibility with history written before the
  // standalone post generator existed. Old entries are treated as replies.
  contentKind?: ContentKind;
  // Neutral source field for new consumers. postText remains required so old
  // popup builds can still render history produced by a newer service worker.
  sourceText?: string;
  postText: string;
  postUrl?: string;
  tone: Tone;
  // Engagement goal used for this generation, when one was set.
  objective?: EngagementObjective;
  drafts: string[];
  inserted: boolean;
  // Only set once inserted — which composer the draft was inserted into.
  insertKind?: ContentKind;
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
  insertedIds?: Record<string, ContentKind>;
  // Optional (like insertedIds above) so existing stored stats without these
  // fields don't need a migration — getUsageStats() normalizes them to 0.
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalEstimatedCostUsd?: number;
};
