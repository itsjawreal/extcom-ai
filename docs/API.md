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
  "count": 3
}
```

Valid tones: `degen`, `bullish`, `smart`, `funny`, `respectful`, and
`short_alpha`. `count` must be between 1 and 3.

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
