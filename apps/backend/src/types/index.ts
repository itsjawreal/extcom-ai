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

// What the output should achieve, orthogonal to tone (how it should sound).
// Absent means no engagement goal: the prompt gains no goal section at all.
export const ENGAGEMENT_OBJECTIVES = ["viral", "replies", "debate", "value"] as const;

export type EngagementObjective = (typeof ENGAGEMENT_OBJECTIVES)[number];

export type GenerateReplyRequest = {
  postText: string;
  // BCP 47 language tag captured from X's tweetText element, when available.
  sourceLanguage?: string;
  // "post" follows sourceLanguage/original text; "en" forces English.
  replyLanguage?: "post" | "en";
  authorHandle?: string;
  authorName?: string;
  postUrl?: string;
  visibleThreadText?: string[];
  // Up to 4 images (X's own per-post max).
  imageUrls?: string[];
  // "auto" means the AI picks whichever single tone best fits this post,
  // applied consistently across every reply in the batch — the resolved
  // tone (never "auto") is echoed back per-reply in GeneratedReply.tone.
  tone: Tone | "auto";
  // Engagement goal for this batch; combines freely with any tone.
  objective?: EngagementObjective;
  extraInstruction?: string;
  // User-defined words/phrases that must not appear in generated output.
  // Transient request data: never persisted by the backend.
  blockedTerms?: string[];
  count: number;
  // "auto" means no fixed character target — the AI picks whatever length
  // reads most natural for the tone/post, capped only by a safety ceiling.
  maxLength: number | "auto";
  useEmoji: boolean;
  // Per-request override of AI_DEFAULT_MODEL. Validated against the backend's
  // allowlist unless AI_ALLOW_CUSTOM_MODEL permits arbitrary values — see
  // services/modelCatalog.ts.
  model?: string;
};

export type GeneratePostMode = "fresh" | "rewrite" | "continue";

// An image the user attached to X's standalone composer, prepared by the
// extension (resized/re-encoded/bounded) and sent as a base64 data URL.
// Deliberately separate from GenerateReplyRequest.imageUrls: those are
// X-hosted HTTPS URLs from an existing post, these are user-local bytes and
// carry stricter validation (see services/attachedImages.ts).
export type AttachedImageInput = {
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  // Informational; the backend validates bytes, not these dimensions.
  width: number;
  height: number;
};

export type GeneratePostRequest = {
  // A topic/instruction supplied by the user. It may be empty only when an
  // existing composer draft supplies the source material.
  brief: string;
  existingDraft?: string;
  mode: GeneratePostMode;
  // "brief" means infer the output language from brief/existingDraft.
  language: "brief" | "en";
  tone: Tone | "auto";
  // Engagement goal for this batch; combines freely with any tone.
  objective?: EngagementObjective;
  extraInstruction?: string;
  blockedTerms?: string[];
  count: number;
  maxLength: number | "auto";
  useEmoji: boolean;
  model?: string;
  // Up to 4 composer attachments (X's own per-post max). Only valid for
  // Create Post; image-only fresh mode is allowed when at least one entry
  // passes validation. Never persisted or logged.
  attachedImages?: AttachedImageInput[];
};

export type GenerationRequest = GenerateReplyRequest | GeneratePostRequest;

export function isGeneratePostRequest(input: GenerationRequest): input is GeneratePostRequest {
  return "brief" in input;
}

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
  // The model actually used to generate this response (resolved from the
  // request's model override, AI_DEFAULT_MODEL, or the provider's own
  // fallback — never "unset").
  model: string;
  // Absent when the provider didn't return usage data. estimatedCostUsd is
  // only present when the resolved model's pricing is available from
  // OpenRouter's live catalog (see services/modelCatalog.ts) — an
  // OpenAI-provider response, or an OpenRouter model without pricing
  // metadata, will have token counts but no cost estimate.
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd?: number;
  };
};

export type GeneratedPost = GeneratedReply;

export type GeneratePostResponse = Omit<GenerateReplyResponse, "replies"> & {
  posts: GeneratedPost[];
  // How many validated composer attachments were part of this generation.
  // Only the count is ever echoed or recorded — never bytes or data URLs.
  attachedImageCount?: number;
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
  | "INTERNAL_ERROR"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_PAYLOAD_TOO_LARGE"
  | "INVALID_IMAGE_DATA"
  | "MODEL_VISION_UNSUPPORTED";
