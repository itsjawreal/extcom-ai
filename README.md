# Ekskomen AI Reply

A self-hosted, human-in-the-loop AI reply copilot for X/Twitter. A Chrome
extension adds an **✦ AI Reply** button to posts; your own backend generates
reply drafts with the AI provider key **you** control; you pick a draft, it is
inserted into the reply composer, and **you always press Post yourself**.

- No SaaS, no signup, no telemetry: deploy the backend on your own VPS/PaaS.
- Your AI API key (OpenRouter or OpenAI) never leaves your server.
- Free and open source (MIT).

```txt
Chrome extension ──(your access token)──▶ your backend ──(your API key)──▶ AI provider
```

## What it deliberately does NOT do

This is a copilot, not a bot:

- Never auto-clicks X's Post/Reply button.
- No mass replies, timeline scraping, or background auto-commenting.
- Automated posting may violate X's Terms of Service — the human-in-the-loop
  design is intentional. Use responsibly.

## 1. Deploy the backend

### Option A — Docker (recommended for a VPS)

```bash
git clone <this repo>
cd ekskomen.ai
cp .env.example .env       # fill in OPENROUTER_API_KEY and AUTH_TOKENS
docker compose up -d --build
curl http://localhost:3000/health
```

Put a reverse proxy with HTTPS in front (Caddy, nginx + certbot, Cloudflare
Tunnel, …). The extension talks to the URL you expose.

### Option B — Node directly

Requires Node.js ≥ 22.

```bash
npm ci
npm run build --workspace=@ekskomen/backend
cd apps/backend
cp ../../.env.example .env  # fill it in
npm start
```

### Option C — Railway

The root `railway.toml` builds and starts only the backend workspace. Set the
same variables as in `.env.example` in the Railway dashboard; Railway supplies
`PORT` automatically and the health check uses `GET /health`. Attach a volume
and point `DATABASE_PATH` at it if you use admin-issued tokens.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes* | API key when `AI_DEFAULT_PROVIDER=openrouter` (default). |
| `OPENAI_API_KEY` | yes* | API key when `AI_DEFAULT_PROVIDER=openai`. |
| `AI_DEFAULT_PROVIDER` | no | `openrouter` (default) or `openai`. |
| `AI_DEFAULT_MODEL` | no | e.g. `openrouter/auto`, `anthropic/claude-haiku-4.5`. |
| `AUTH_TOKENS` | yes | Comma-separated `token:plan` pairs. Invent a long random token and paste the same value into the extension popup. Plans `free`/`pro`/`power` only differ in rate limits. |
| `ADMIN_SECRET` | no | Enables `/v1/admin/tokens` for issuing extra tokens stored in SQLite (for sharing your server). Off when empty. |
| `DATABASE_PATH` | no | SQLite file (default `data/ekskomen.db`; the Docker image uses `/data/ekskomen.db` on a volume). |
| `EXTENSION_ORIGIN` | no | Extra allowed CORS origin. Extension origins (`chrome-extension://…`) are always allowed; authorization is the bearer token. |
| `APP_URL` | no | Sent to OpenRouter as `HTTP-Referer`. |
| `PORT` | no | Default `3000`. |

The backend exposes `GET /health`, `POST /v1/generate-reply` (bearer token),
and `POST|GET /v1/admin/tokens` (admin secret, optional).

## 2. Build & install the extension

```bash
npm ci
npm run build --workspace=@ekskomen/extension
```

Then in Chrome (or any Chromium browser):

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `apps/extension/dist`.

## 3. Connect them

1. Click the **Ekskomen AI Reply** icon in the toolbar.
2. Enter your backend URL (e.g. `https://ekskomen.example.com`) and the access
   token you put in `AUTH_TOKENS`, pick a default tone, **Save**. Chrome will
   ask to allow access to your backend's domain — accept it.
3. Open [x.com](https://x.com), find a post, click **✦ AI Reply** → Generate →
   Insert. Edit the draft if you like, then press Post yourself.

## Sharing your server (optional)

Set `ADMIN_SECRET`, then issue tokens without touching env vars:

```bash
curl -X POST https://your-backend/v1/admin/tokens \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"plan":"pro","label":"my friend"}'
```

Tokens are stored in SQLite (keep the Docker volume, or set `DATABASE_PATH`
somewhere persistent). `GET /v1/admin/tokens` lists them.

Rate limits per token: free 5/min & 20/day, pro 30/min & 300/day,
power 60/min & 1000/day (see `apps/backend/src/services/rateLimit.ts`).

## Development

```bash
npm ci
npm run dev --workspace=@ekskomen/backend    # tsx watch on :3000
npm run dev --workspace=@ekskomen/extension  # vite build --watch
npm run typecheck                            # all workspaces
npm test                                     # backend node:test suite
```

Without any configuration the extension defaults to `http://localhost:3000`
with the dev token `dev-local-token` (accepted only when `NODE_ENV` is not
`production`).

Repo layout: `apps/extension` (MV3, TypeScript + Vite; content script UI,
MAIN-world insert bridge, settings popup) and `apps/backend` (zero-dependency
Node `http` server; SQLite via `node:sqlite`).

## License

[MIT](LICENSE)
