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

function extractOutputText(result: ResponsesApiResult): string {
  for (const item of result.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new ProviderError("AI provider returned no text output.");
}

function parseReplies(
  raw: string,
  expectedCount: number,
  requestedTone: GenerateReplyRequest["tone"],
): ParsedReplies {
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
        ? sanitizeReply(String((reply as { text: unknown }).text))
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
            { type: "input_text" as const, text: buildUserPrompt(input) },
            ...input.imageUrls.map((url) => ({
              type: "input_image" as const,
              image_url: url,
              detail: "low" as const,
            })),
          ],
        },
      ]
    : buildUserPrompt(input);

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_DEFAULT_MODEL || "gpt-5.4-nano",
      instructions: SYSTEM_PROMPT,
      input: requestInput,
      max_output_tokens: 800,
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

  return parseReplies(extractOutputText(result), input.count, input.tone);
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

  // Low detail keeps image cost/latency small (~85 flat tokens per image vs.
  // several hundred at high detail) — enough for a reply to reference what
  // an image shows without needing pixel-level precision. Cost scales
  // linearly with image count (up to 4, X's own per-post max). Requires a
  // vision-capable AI_DEFAULT_MODEL; if the configured model can't see
  // images, providers typically just ignore the block rather than erroring.
  const userContent = input.imageUrls?.length
    ? [
        { type: "text" as const, text: buildUserPrompt(input) },
        ...input.imageUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url, detail: "low" as const },
        })),
      ]
    : buildUserPrompt(input);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.AI_DEFAULT_MODEL || "openrouter/auto",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 800,
      temperature: 0.8,
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
                    text:
                      input.maxLength === "auto"
                        ? { type: "string", maxLength: 280 }
                        : { type: "string", maxLength: input.maxLength },
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
  return parseReplies(content, input.count, input.tone);
}

export async function generateReplies(input: GenerateReplyRequest): Promise<ParsedReplies> {
  const provider = process.env.AI_DEFAULT_PROVIDER || "openrouter";
  if (provider === "openrouter") return generateWithOpenRouter(input);
  if (provider === "openai") return generateWithOpenAI(input);
  throw new ProviderError(`Unsupported AI provider: ${provider}.`, 503);
}

export const providerInternals = { extractOutputText, parseReplies };
