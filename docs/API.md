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

The endpoint is intentionally unauthenticated until Milestone 5. Do not expose
it publicly before auth and rate limiting are implemented.

Generation uses OpenRouter by default. Configure `OPENROUTER_API_KEY` only in
the backend environment; never place it in the extension bundle.
