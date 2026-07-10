# Deploy to a VPS

## Requirements

- Linux VPS with Docker and Docker Compose
- A domain name
- A reverse proxy for HTTPS (Caddy, nginx + certbot, Cloudflare Tunnel, …)

## Clone and configure

```bash
git clone https://github.com/itsjawreal/extcom-ai.git
cd extcom-ai
cp .env.example .env
nano .env   # fill in OPENROUTER_API_KEY and AUTH_TOKENS at minimum
```

## Run

```bash
docker compose up -d --build
```

`docker-compose.yml` already mounts a named volume (`extcom-ai-data`) at
`/data`, so the SQLite database survives container restarts and rebuilds.

## Check health

```bash
curl http://localhost:3000/health
```

## Logs

```bash
docker compose logs -f
```

## Update

```bash
git pull
docker compose up -d --build
```

## Reverse proxy

Point your HTTPS reverse proxy at `http://127.0.0.1:3000` and expose that
public URL to the Chrome extension.
