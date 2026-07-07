# Ekskomen AI

Chrome MV3 extension for drafting human-reviewed X/Twitter replies. It injects
an **AI Reply** button, calls the backend for reply options, and can insert a
selected draft into X/Twitter's composer without publishing it.

## Development

```bash
npm install
npm run typecheck
npm run build
```

Load `apps/extension/dist` through `chrome://extensions` using **Load unpacked**.
Open `x.com` or `twitter.com`, then reload the tab after installing the extension.

## Backend

Copy `apps/backend/.env.example` to `.env`, configure `OPENROUTER_API_KEY`, then run:

```bash
npm run build
npm run start --workspace=@ekskomen/backend
```

The backend currently exposes `GET /health` and `POST /v1/generate-reply`.
`POST /v1/generate-reply` now requires `Authorization: Bearer <token>`, where
tokens come from `AUTH_TOKENS` in the backend env as comma-separated
`token[:plan]` entries.
OpenRouter is the default provider and uses `openrouter/auto`; both provider and
model remain configurable through environment variables.

## Railway deployment

The root `railway.toml` builds and starts only the backend workspace. Configure
these Railway variables before enabling generation:

```txt
OPENROUTER_API_KEY=...
AI_DEFAULT_PROVIDER=openrouter
AI_DEFAULT_MODEL=openrouter/auto
AUTH_TOKENS=your-prod-token:pro
APP_URL=https://your-app.up.railway.app
```

Railway supplies `PORT` automatically. The deployment health check uses
`GET /health`.

In development, the extension defaults to `http://localhost:3000` and
`dev-local-token`. Override both in the injected panel for localhost or Railway
hosts covered by the manifest host permissions.

## Current scope

- Detect visible X/Twitter post articles.
- Inject one AI Reply button per post.
- Extract the clicked post's visible text, author, timestamp, and canonical URL.
- Show extracted context in a collapsible debug section.
- Show a floating panel with backend URL, auth token, six tones, and optional
  extra instruction.
- Generate three backend replies, copy them, and insert one into the reply
  composer.
- Never click or trigger X/Twitter's final Post/Reply action.
