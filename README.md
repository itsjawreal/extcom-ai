# Ekskomen AI

Chrome MV3 extension for drafting human-reviewed X/Twitter replies. The current
prototype injects an **AI Reply** button and displays local sample replies; it
never publishes a reply.

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
Authentication and rate limiting arrive in Milestone 5; keep it private until then.
OpenRouter is the default provider and uses `openrouter/auto`; both provider and
model remain configurable through environment variables.

## Railway deployment

The root `railway.toml` builds and starts only the backend workspace. Configure
these Railway variables before enabling generation:

```txt
OPENROUTER_API_KEY=...
AI_DEFAULT_PROVIDER=openrouter
AI_DEFAULT_MODEL=openrouter/auto
APP_URL=https://your-app.up.railway.app
```

Railway supplies `PORT` automatically. The deployment health check uses
`GET /health`.

Do not expose a funded provider key publicly until application authentication
and rate limiting are enabled (Milestone 5).

## Current scope

- Detect visible X/Twitter post articles.
- Inject one AI Reply button per post.
- Extract the clicked post's visible text, author, timestamp, and canonical URL.
- Show extracted context in a collapsible debug section.
- Show a floating panel with six tones and three local sample replies.
- Copy a sample reply.
- Keep insertion as an explicit placeholder for Milestone 4.
- Never click or trigger X/Twitter's final Post/Reply action.
