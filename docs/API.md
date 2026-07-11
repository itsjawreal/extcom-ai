# Backend API

See [PROMPT.md](PROMPT.md) for the exact system prompt, user prompt
template, and tone guidance the backend sends to the AI provider on every
`/v1/generate-reply` call.

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
  "imageUrls": ["https://pbs.twimg.com/media/example.jpg"]
}
```

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
Also note: OpenRouter's `response_format: json_schema` (strict mode) this
backend relies on for reliable parsing isn't supported by every model —
Anthropic Claude models in particular have failed with a generic
`"Provider returned error"` in testing, most likely due to the combination
of strict schema mode and `provider.require_parameters: true`.

`useEmoji` is a boolean (default
`true`); when `false` it's a hard override that beats any emoji habit implied
by the selected tone. `imageUrls` is optional (array of `http(s)://` URLs,
max 2000 chars each, at most 4 items — X's own per-post max) — when present,
each is sent to the AI provider as a low-detail image input alongside the
text. Cost/latency scale linearly with image count. This **requires
`AI_DEFAULT_MODEL` to be a vision-capable model** (e.g. an OpenRouter
multimodal model, or `gpt-4o`/`gpt-4.1`-class models on OpenAI); non-vision
models typically just ignore the images rather than erroring.

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
consume one request regardless of the requested reply count.

## `GET /v1/me`

Requires `Authorization: Bearer <token>`. Returns the token plan and remaining
daily quota without consuming it.

## `GET|POST /v1/admin/tokens`

Available only when `ADMIN_SECRET` is configured. Send it in
`X-Admin-Secret`. `POST` issues a persistent token; `GET` lists issued tokens.

Generation uses OpenRouter by default. Configure `OPENROUTER_API_KEY` only in
the backend environment; never place it in the extension bundle.
