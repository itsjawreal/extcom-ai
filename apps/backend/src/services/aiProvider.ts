import { modelSupportsParameter } from "./modelCatalog.js";
import { getPersonaVoice } from "./persona.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./promptBuilder.js";
import { sanitizeReply } from "./safety.js";
import { TONES, type GenerateReplyRequest, type Tone } from "../types/index.js";

type ParsedReplies = { texts: string[]; tone: Tone };

type ResponsesApiContent = { type?: string; text?: string };
type ResponsesApiOutput = { type?: string; content?: ResponsesApiContent[] };
type ResponsesApiResult = {
  output?: ResponsesApiOutput[];
  error?: { message?: string };
};

type OpenRouterResult = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: { message?: string };
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// max_tokens/max_output_tokens has to scale with the requested reply length
// or long-form (X Premium) requests get cut off mid-reply — or mid-JSON,
// which breaks parsing entirely. 2.2 chars/token is a conservative floor
// (real English averages ~4) that leaves headroom for JSON structure
// overhead and less token-dense text. Capped well below what most providers
// support so a single request can't run away in cost; how far a very long
// maxLength × count combination actually gets still depends on the
// configured AI_DEFAULT_MODEL's own output-token limit.
const MAX_TOKENS_CEILING = 20_000;
const MIN_TOKENS_FLOOR = 800;

// OpenRouter's strict JSON schema maxLength is a real generation-time
// constraint for providers that grammar-constrain output to the schema —
// hitting it stops the string exactly there, mid-word, with no ellipsis.
// Requesting the schema's maxLength a bit above the real target gives the
// model room to finish its current sentence; sanitizeReply() still trims
// the result down to the true target afterward, using sentence/word-
// boundary-aware truncation instead of a raw schema cutoff.
const SCHEMA_LENGTH_BUFFER = 150;

function computeMaxTokens(input: GenerateReplyRequest): number {
  const perReplyChars = input.maxLength === "auto" ? 280 : input.maxLength;
  const estimated = Math.ceil((perReplyChars * input.count) / 2.2) + 300;
  return Math.min(MAX_TOKENS_CEILING, Math.max(MIN_TOKENS_FLOOR, estimated));
}

function extractOutputText(result: ResponsesApiResult): string {
  for (const item of result.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new ProviderError("AI provider returned no text output.");
}

// Matches promptBuilder.ts's own auto-mode ceiling and the extension's
// AUTO_REPLY_LENGTH_CEILING — "auto" has no user-picked numeric target, so
// this is the safety-net limit applied when sanitizing the response.
const AUTO_MAX_LENGTH_CEILING = 280;

function parseReplies(
  raw: string,
  expectedCount: number,
  requestedTone: GenerateReplyRequest["tone"],
  maxLength: GenerateReplyRequest["maxLength"],
): ParsedReplies {
  const lengthLimit = maxLength === "auto" ? AUTO_MAX_LENGTH_CEILING : maxLength;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderError("AI provider returned invalid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || !("replies" in parsed)) {
    throw new ProviderError("AI provider response is missing replies.");
  }

  const replies = (parsed as { replies?: unknown }).replies;
  if (!Array.isArray(replies)) {
    throw new ProviderError("AI provider replies must be an array.");
  }

  const texts = replies
    .map((reply) =>
      reply && typeof reply === "object" && "text" in reply
        ? sanitizeReply(String((reply as { text: unknown }).text), lengthLimit)
        : "",
    )
    .filter(Boolean)
    .slice(0, expectedCount);

  if (texts.length !== expectedCount || new Set(texts).size !== texts.length) {
    throw new ProviderError("AI provider returned incomplete or duplicate replies.");
  }

  // Manual tone: trust the request, no need for the model to echo it back.
  // Auto: the model was asked to pick and report one — fall back to a safe
  // default if it omitted the field or hallucinated something off-list.
  let tone: Tone;
  if (requestedTone === "auto") {
    const rawTone = (parsed as { tone?: unknown }).tone;
    tone = typeof rawTone === "string" && TONES.includes(rawTone as Tone) ? (rawTone as Tone) : "smart";
  } else {
    tone = requestedTone;
  }

  return { texts, tone };
}

export async function generateWithOpenAI(
  input: GenerateReplyRequest,
): Promise<ParsedReplies> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("OPENAI_API_KEY is not configured.", 503);
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const personaVoice = await getPersonaVoice();
  // Low detail keeps image cost/latency small (~85 flat tokens per image vs.
  // several hundred at high detail) — enough for a reply to reference what
  // an image shows without needing pixel-level precision. Cost scales
  // linearly with image count (up to 4, X's own per-post max). Requires a
  // vision-capable AI_DEFAULT_MODEL; if the configured model can't see
  // images, providers typically just ignore the block rather than erroring.
  const requestInput = input.imageUrls?.length
    ? [
        {
          role: "user" as const,
          content: [
            { type: "input_text" as const, text: buildUserPrompt(input, personaVoice) },
            ...input.imageUrls.map((url) => ({
              type: "input_image" as const,
              image_url: url,
              detail: "low" as const,
            })),
          ],
        },
      ]
    : buildUserPrompt(input, personaVoice);

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model || process.env.AI_DEFAULT_MODEL || "gpt-5.4-nano",
      instructions: SYSTEM_PROMPT,
      input: requestInput,
      max_output_tokens: computeMaxTokens(input),
      reasoning: { effort: "none" },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const result = (await response.json().catch(() => ({}))) as ResponsesApiResult;
  if (!response.ok) {
    throw new ProviderError(
      result.error?.message || `AI provider failed with HTTP ${response.status}.`,
    );
  }

  return parseReplies(extractOutputText(result), input.count, input.tone, input.maxLength);
}

export async function generateWithOpenRouter(
  input: GenerateReplyRequest,
): Promise<ParsedReplies> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new ProviderError("OPENROUTER_API_KEY is not configured.", 503);
  }

  const baseUrl = (
    process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
  ).replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": "Extcom AI",
  };
  if (process.env.APP_URL) headers["HTTP-Referer"] = process.env.APP_URL;

  const personaVoice = await getPersonaVoice();
  const model = input.model || process.env.AI_DEFAULT_MODEL || "openrouter/auto";
  // Without this, a reasoning-capable model (e.g. google/gemini-2.5-pro) can
  // spend most of max_tokens on invisible internal reasoning before ever
  // writing the actual JSON reply, leaving too little budget to finish it —
  // confirmed live: this produced "AI provider returned invalid JSON" for
  // gemini-2.5-pro specifically, while non-reasoning and lighter
  // (flash-tier) models were unaffected. This task is a direct
  // reply-generation job, not multi-step reasoning, so there's nothing to
  // gain from letting a model "think" here. Only sent when the model
  // actually declares support for it — provider.require_parameters: true
  // below means sending an unsupported parameter makes the whole request
  // unroutable, not just ignored, so this has to be conditional.
  const supportsReasoningControl = await modelSupportsParameter(model, "reasoning");
  const schemaTextMaxLength =
    (input.maxLength === "auto" ? 280 : input.maxLength) + SCHEMA_LENGTH_BUFFER;
  // Low detail keeps image cost/latency small (~85 flat tokens per image vs.
  // several hundred at high detail) — enough for a reply to reference what
  // an image shows without needing pixel-level precision. Cost scales
  // linearly with image count (up to 4, X's own per-post max). Requires a
  // vision-capable AI_DEFAULT_MODEL; if the configured model can't see
  // images, providers typically just ignore the block rather than erroring.
  const userContent = input.imageUrls?.length
    ? [
        { type: "text" as const, text: buildUserPrompt(input, personaVoice) },
        ...input.imageUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url, detail: "low" as const },
        })),
      ]
    : buildUserPrompt(input, personaVoice);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: computeMaxTokens(input),
      temperature: 0.8,
      ...(supportsReasoningControl ? { reasoning: { effort: "none" } } : {}),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "reply_options",
          strict: true,
          schema: {
            type: "object",
            properties: {
              // Only present (and required) when the caller asked for
              // tone: "auto" — a manually-picked tone doesn't need the
              // model to echo it back, so the schema for that path stays
              // exactly as it was before this feature existed.
              ...(input.tone === "auto" ? { tone: { type: "string", enum: TONES } } : {}),
              replies: {
                type: "array",
                minItems: input.count,
                maxItems: input.count,
                items: {
                  type: "object",
                  properties: {
                    // Padded above the real target (sanitizeReply() below
                    // still trims to the true limit). Some providers
                    // grammar-constrain generation to a strict schema's
                    // maxLength and cut the string exactly there — mid-word,
                    // with no ellipsis — confirmed live at 1000/1000 chars
                    // ending on ".. backst". Since our own truncation only
                    // fires when text.length exceeds the target, a string
                    // arriving pre-cut exactly at the target slips through
                    // untouched. The buffer gives room to finish the
                    // sentence naturally so our own sentence/word-boundary
                    // truncation is what actually decides where it ends.
                    text: { type: "string", maxLength: schemaTextMaxLength },
                  },
                  required: ["text"],
                  additionalProperties: false,
                },
              },
            },
            required: input.tone === "auto" ? ["tone", "replies"] : ["replies"],
            additionalProperties: false,
          },
        },
      },
      provider: { require_parameters: true },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const result = (await response.json().catch(() => ({}))) as OpenRouterResult;
  if (!response.ok) {
    throw new ProviderError(
      result.error?.message || `OpenRouter failed with HTTP ${response.status}.`,
    );
  }

  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError("OpenRouter returned no text output.");
  return parseReplies(content, input.count, input.tone, input.maxLength);
}

export async function generateReplies(input: GenerateReplyRequest): Promise<ParsedReplies> {
  const provider = process.env.AI_DEFAULT_PROVIDER || "openrouter";
  if (provider === "openrouter") return generateWithOpenRouter(input);
  if (provider === "openai") return generateWithOpenAI(input);
  throw new ProviderError(`Unsupported AI provider: ${provider}.`, 503);
}

export const providerInternals = { extractOutputText, parseReplies, computeMaxTokens };
