# Backend API

See [PROMPT.md](PROMPT.md) for the exact system prompt, user prompt
template, and tone guidance the backend sends to the AI provider on every
`/v1/generate-reply` and `/v1/generate-post` calls — including `PERSONA.md`, an operator-editable
file that gives every draft a consistent voice/identity (see PROMPT.md's
Persona section). It's server-side configuration, not a request field.

## `GET /health`

Returns `200` with `{ "ok": true }`.

## `POST /v1/generate-reply`

Request body:

```json
{
  "postText": "Visible post text",
  "authorHandle": "@example",
  "authorName": "Example",
  "postUrl": "https://x.com/example/status/1",
  "visibleThreadText": [],
  "tone": "smart",
  "extraInstruction": "Keep it concise",
  "count": 3,
  "maxLength": 220,
  "useEmoji": true,
  "imageUrls": ["https://pbs.twimg.com/media/example.jpg"],
  "model": "google/gemini-2.5-flash"
}
```

Response body:

```json
{
  "replies": [{ "id": "reply_1", "text": "...", "tone": "smart" }],
  "usage": { "remainingToday": 199, "plan": "pro" },
  "model": "google/gemini-2.5-flash",
  "tokenUsage": { "promptTokens": 512, "completionTokens": 84, "estimatedCostUsd": 0.000364 }
}
```

`model` is the model actually used to generate the response (the request's
`model` override, `AI_DEFAULT_MODEL`, or the provider's own fallback).
`tokenUsage` is present whenever the AI provider reports token counts in its
response — `estimatedCostUsd` within it is only present when the resolved
model's pricing is available from OpenRouter's live model catalog (the same
catalog `GET /v1/models` reads from, see `services/modelCatalog.ts`). In
practice that means an `AI_DEFAULT_PROVIDER=openai` response, or an
OpenRouter model without pricing metadata in its catalog entry, will have
`tokenUsage` with real token counts but no `estimatedCostUsd` — never a
fabricated/stale price.

Valid tones: `degen`, `bullish`, `smart`, `funny`, `respectful`, `short_alpha`,
`one_liner`, `single_word`, `ct_maxi`, `alpha_drop`, `unhinged_degen`,
`hype_founder`, `bold_populist`, `unhinged_meme`, `supportive_hype`,
`contrarian_take`, `engager_question`, `sarcastic_dry`, `wholesome`,
`hot_take`, `roast`, `formal_corporate`, `philosophical`, and
`coach_motivational` — or `"auto"`, which lets the AI pick whichever single
tone best fits the post and applies it consistently to every reply in the
batch. Each reply in the response echoes the tone actually used
(`GeneratedReply.tone`, always a concrete tone, never `"auto"`) — with a
manually-picked tone this just mirrors the request; with `"auto"` it tells
the caller which tone the AI chose.

`count` must be between 1 and 3 (default `3`). `maxLength` must be either an
integer between 50 and 25,000 characters (default `220`), or the string
`"auto"` — which drops the fixed character target and lets the AI pick
whatever length reads most natural for the tone/post, capped at 280. The
25,000 ceiling matches X Premium+'s own post limit (Free is 280, Premium is
4,000); the caller is responsible for picking a value that fits whichever
plan the X account posting the reply is actually on. Above 280 characters,
the AI is additionally instructed that it isn't restricted to typical
short-tweet brevity and to structure the reply as short paragraphs separated
by blank lines instead of one dense block of text. If a provider ignores the
limit anyway, the backend truncates the response server-side to the actual
requested `maxLength` (or the 280 ceiling in `"auto"` mode) — ending on a
complete sentence within that limit when one fits, otherwise a word boundary
with a trailing `…`. The extension additionally re-applies this same
safety net client-side.

The long-form instructions above are only a prompt-level nudge — how
closely the model actually reaches for the requested length depends a lot
on `AI_DEFAULT_MODEL`. Smaller/cheaper models tuned for concise chat
responses (e.g. `google/gemini-2.5-flash-lite`) tend to undershoot even
with the length guidance; a step up within the same family (e.g.
`google/gemini-2.5-flash`) has followed it far more reliably in testing.
Also note: this backend relies on OpenRouter's `response_format: json_schema`
(strict mode) for reliable parsing, combined with `provider.
require_parameters: true` (only route to a provider that supports the exact
parameters sent). Both `anthropic/claude-haiku-4.5` and
`anthropic/claude-sonnet-4.6` failed with a generic `"Provider returned
error"` in testing — consistently across two different tiers, not a
one-off flake — even though OpenRouter's own model catalog lists both as
supporting `structured_outputs`. The exact cause was never confirmed, but
two-for-two across the Anthropic family was enough to exclude Anthropic
models from the popup's default model list (`AI_ALLOWED_MODELS` or the
custom model field can still target one directly). Separately: a
reasoning-capable model (anything whose catalog entry lists `reasoning` in
`supported_parameters`, e.g. `google/gemini-2.5-pro`) gets
`reasoning: { effort: "none" }` added to the OpenRouter request
automatically — without it, a model can spend its `max_tokens` budget on
invisible internal reasoning before ever writing the JSON reply, which
surfaced live as `"AI provider returned invalid JSON"` for
`gemini-2.5-pro` specifically. Check a model's `supported_parameters` on
[OpenRouter's models page](https://openrouter.ai/models) before picking
`AI_DEFAULT_MODEL`, and don't assume an error means the model itself can
never work here.

Provider reliability is bounded rather than open-ended. Requests to the
official OpenRouter API use strict structured output plus its
`response-healing` plugin; direct OpenAI Responses requests use a strict
portable JSON schema. If a provider still returns malformed JSON, no/partial
output, duplicate/missing drafts, a network failure, or a transient
`408`/`409`/`429`/`5xx`, the backend waits briefly and tries once more (two
total attempts). A short provider `Retry-After` value is honored; a long one
is returned to the caller instead of holding the request open. Authentication,
payment, validation, refusal, and content-policy errors are never retried. A
successful internal retry consumes one Extcom rate-limit unit, while provider
token usage from both paid attempts is combined in the response.

`useEmoji` is a boolean (default
`true`); when `false` it's a hard override that beats any emoji habit implied
by the selected tone. `imageUrls` is optional (array of `http(s)://` URLs,
max 2000 chars each, at most 4 items — X's own per-post max) — when present,
each is sent to the AI provider as a low-detail image input alongside the
text. Cost/latency scale linearly with image count. This **requires
`AI_DEFAULT_MODEL` to be a vision-capable model** (e.g. an OpenRouter
multimodal model, or `gpt-4o`/`gpt-4.1`-class models on OpenAI); non-vision
models typically just ignore the images rather than erroring.

`model` is optional (string, max 200 chars) — overrides `AI_DEFAULT_MODEL`
for this request only. Rejected with a 400 if `AI_ALLOW_CUSTOM_MODEL=false`
and the model isn't in the resolved allowlist (see `GET /v1/models` below).
The extension only ever sends this from the popup's Advanced tab setting,
never per-generation from the on-page panel.

Authentication and rate-limit behavior:

- `Authorization: Bearer <token>` is required.
- Configure `AUTH_TOKENS` as comma-separated `token[:plan]` entries.
- Example: `AUTH_TOKENS=free-token,pro-token:pro,power-token:power`
- Development fallback token: `dev-local-token`
- Plans enforce persistent per-token limits stored in SQLite:
  - `free`: 5/minute, 20/day
  - `pro`: 30/minute, 300/day
  - `power`: 60/minute, 1000/day

Failed provider requests release their reserved quota. Successful generations
consume one request regardless of the requested draft count.

## `POST /v1/generate-post`

Generates complete standalone X posts rather than replies.

```json
{
  "brief": "Why shipping small improvements compounds",
  "existingDraft": "optional text already in X's composer",
  "mode": "fresh",
  "language": "brief",
  "tone": "auto",
  "extraInstruction": "End with a useful question",
  "blockedTerms": ["game-changer"],
  "count": 3,
  "maxLength": 280,
  "useEmoji": false,
  "model": "google/gemini-2.5-flash"
}
```

`mode` is `fresh`, `rewrite`, or `continue`; rewrite/continue require a
non-empty `existingDraft`. `language` is `brief` (follow the brief/draft) or
`en`. `brief` accepts up to 5,000 characters, `existingDraft` up to 25,000,
and at least one must be non-empty — unless `mode` is `fresh` and
`attachedImages` contains at least one valid entry (image-only generation).
Tone, count, length, emoji, model, authentication, quota, token usage, and
cost behave exactly like `/v1/generate-reply`.

### `attachedImages` (optional)

Images the user attached to X's composer, sent as visual context for the
generated post:

```json
{
  "attachedImages": [
    { "dataUrl": "data:image/png;base64,...", "mimeType": "image/png", "width": 1280, "height": 720 }
  ]
}
```

- Up to 4 entries; JPEG, PNG, or WebP only.
- `dataUrl` must be a canonical base64 data URL whose MIME matches
  `mimeType`; decoded bytes are verified against the format's file signature.
- Limits: 1.25 MiB decoded bytes per image, 4 MiB per request. This route
  alone accepts request bodies up to 8 MiB; every other route keeps the
  32 KiB ceiling.
- Image bytes are forwarded to the configured AI provider and never stored,
  logged, or persisted anywhere on the backend.
- Requests with attachments fail fast with `MODEL_VISION_UNSUPPORTED` when
  the selected model is confirmed text-only.

Attachment-specific error codes: `UNSUPPORTED_IMAGE_TYPE`,
`INVALID_IMAGE_DATA`, `IMAGE_TOO_LARGE`, `IMAGE_PAYLOAD_TOO_LARGE` (HTTP
413), and `MODEL_VISION_UNSUPPORTED`.

```json
{
  "posts": [{ "id": "post_1", "text": "...", "tone": "smart" }],
  "usage": { "remainingToday": 199, "plan": "pro" },
  "model": "google/gemini-2.5-flash",
  "tokenUsage": { "promptTokens": 420, "completionTokens": 110, "estimatedCostUsd": 0.00031 },
  "attachedImageCount": 1
}
```

`attachedImageCount` echoes how many validated attachments were part of the
generation (absent for text-only requests). Only the count is ever returned
or recorded — never image bytes.

## `GET /v1/me`

Requires `Authorization: Bearer <token>`. Returns the token plan and remaining
daily quota without consuming it.

## `GET /v1/models`

Requires `Authorization: Bearer <token>`. Powers the popup's model dropdown.
Live-fetches OpenRouter's `/api/v1/models` catalog (cached in-memory for 1
hour; serves a stale cache rather than failing outright if OpenRouter is
briefly unreachable), intersects it with `AI_ALLOWED_MODELS` (or a small
built-in starter list if that's unset), and filters to models that declare
`structured_outputs` support. An ID that's gone stale in OpenRouter's catalog
since being added to the list is silently dropped, not shown as broken.

```json
{
  "models": [
    { "id": "google/gemini-2.5-flash", "name": "Gemini 2.5 Flash", "pricing": { "prompt": "0.0000003", "completion": "0.0000025" } }
  ],
  "allowCustom": true
}
```

Catalog metadata isn't a guarantee a model will actually work here — see the
`anthropic/claude-haiku-4.5` note above. Use `POST /v1/test-model` for that.

## `POST /v1/test-model`

Requires `Authorization: Bearer <token>`, consumes rate-limit quota exactly
like `/v1/generate-reply` (a free-to-spam test button would be a rate-limit
bypass). Body: `{ "model": "moonshotai/kimi-k2.6" }`. Runs one real, minimal
generate call against that model and returns `{ "ok": true }` on success or
the provider's actual error message on failure — this is what the popup's
"Test" button (next to the custom model field) calls, since a model's
catalog metadata alone doesn't prove a live generate call will succeed.
Rejected with a 400 if `AI_ALLOW_CUSTOM_MODEL=false` and the model isn't in
the resolved allowlist.

## `GET|POST /v1/admin/tokens`

Available only when `ADMIN_SECRET` is configured. Send it in
`X-Admin-Secret`. `POST` issues a persistent token; `GET` lists issued tokens.

Generation uses OpenRouter by default. Configure `OPENROUTER_API_KEY` only in
the backend environment; never place it in the extension bundle.
