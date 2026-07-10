# Backend API

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
  "imageUrl": "https://pbs.twimg.com/media/example.jpg"
}
```

Valid tones: `degen`, `bullish`, `smart`, `funny`, `respectful`, `short_alpha`,
`one_liner`, `single_word`, `ct_maxi`, `alpha_drop`, `unhinged_degen`,
`hype_founder`, `bold_populist`, `unhinged_meme`, `supportive_hype`,
`contrarian_take`, `engager_question`, `sarcastic_dry`, `wholesome`,
`hot_take`, `roast`, `formal_corporate`, `philosophical`, and
`coach_motivational`.

`count` must be between 1 and 3 (default `3`). `maxLength` must be between 50
and 280 characters (default `220`) — replies are also hard-truncated
client-side if a provider ignores it. `useEmoji` is a boolean (default
`true`); when `false` it's a hard override that beats any emoji habit implied
by the selected tone. `imageUrl` is optional (must be `http(s)://`, max 2000
chars) — when present, it's sent to the AI provider as a low-detail image
input alongside the text. This **requires `AI_DEFAULT_MODEL` to be a
vision-capable model** (e.g. an OpenRouter multimodal model, or `gpt-4o`/
`gpt-4.1`-class models on OpenAI); non-vision models typically just ignore
the image rather than erroring.

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
