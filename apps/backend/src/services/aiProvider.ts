import { buildUserPrompt, SYSTEM_PROMPT } from "./promptBuilder.js";
import { sanitizeReply } from "./safety.js";
import type { GenerateReplyRequest } from "../types/index.js";

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

function parseReplies(raw: string, expectedCount: number): string[] {
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
  return texts;
}

export async function generateWithOpenAI(
  input: GenerateReplyRequest,
): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("OPENAI_API_KEY is not configured.", 503);
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.AI_DEFAULT_MODEL || "gpt-5.4-nano",
      instructions: SYSTEM_PROMPT,
      input: buildUserPrompt(input),
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

  return parseReplies(extractOutputText(result), input.count);
}

export async function generateWithOpenRouter(
  input: GenerateReplyRequest,
): Promise<string[]> {
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
    "X-Title": "Ekskomen AI",
  };
  if (process.env.APP_URL) headers["HTTP-Referer"] = process.env.APP_URL;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: process.env.AI_DEFAULT_MODEL || "openrouter/auto",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
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
              replies: {
                type: "array",
                minItems: input.count,
                maxItems: input.count,
                items: {
                  type: "object",
                  properties: { text: { type: "string", maxLength: 220 } },
                  required: ["text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["replies"],
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
  return parseReplies(content, input.count);
}

export async function generateReplies(input: GenerateReplyRequest): Promise<string[]> {
  const provider = process.env.AI_DEFAULT_PROVIDER || "openrouter";
  if (provider === "openrouter") return generateWithOpenRouter(input);
  if (provider === "openai") return generateWithOpenAI(input);
  throw new ProviderError(`Unsupported AI provider: ${provider}.`, 503);
}

export const providerInternals = { extractOutputText, parseReplies };
