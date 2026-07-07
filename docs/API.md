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

The endpoint now has Milestone 5 placeholders for auth and rate limiting. Keep
it private until production auth/storage land.

Current placeholder auth and rate-limit behavior:

- `Authorization: Bearer <token>` is required.
- Configure `AUTH_TOKENS` as comma-separated `token[:plan]` entries.
- Example: `AUTH_TOKENS=free-token,pro-token:pro,power-token:power`
- Development fallback token: `dev-local-token`
- Plans currently enforce in-memory per-token limits:
  - `free`: 5/minute, 20/day
  - `pro`: 30/minute, 300/day
  - `power`: 60/minute, 1000/day

Generation uses OpenRouter by default. Configure `OPENROUTER_API_KEY` only in
the backend environment; never place it in the extension bundle.
