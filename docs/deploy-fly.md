# Deploy to Fly.io

## Requirements

- Fly CLI installed and authenticated
- Dockerfile in repo root (already present)

## Launch

```bash
fly launch
```

Choose Dockerfile-based deployment when prompted, and skip Fly's Postgres/Redis
offers unless you need them.

## Create and mount a volume

```bash
fly volumes create extcom_ai_data --size 1
```

In `fly.toml`:

```toml
[mounts]
source = "extcom_ai_data"
destination = "/data"
```

## Environment variables

```bash
fly secrets set AI_DEFAULT_PROVIDER=openrouter
fly secrets set OPENROUTER_API_KEY=your-openrouter-key
fly secrets set AUTH_TOKENS=your-long-random-token:power
fly secrets set DATABASE_PATH=/data/extcom-ai.db
```

## Deploy

```bash
fly deploy
```

## Healthcheck

```bash
curl https://your-app.fly.dev/health
```
