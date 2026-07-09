# Deploy to Render

## Build method

Create a new **Web Service** from this repo and choose **Docker** as the
runtime. Render builds from the root `Dockerfile`.

## Environment variables

Set the same variables documented in `.env.example`, at minimum:

```env
AI_DEFAULT_PROVIDER=openrouter
OPENROUTER_API_KEY=your-openrouter-key
AUTH_TOKENS=your-long-random-token:pro
DATABASE_PATH=/data/ekskomen.db
```

## Persistent disk

Add a Render Persistent Disk and mount it to:

```txt
/data
```

Without it, the SQLite database does not survive redeploys or restarts.

## Healthcheck

Set the health check path to:

```txt
/health
```
