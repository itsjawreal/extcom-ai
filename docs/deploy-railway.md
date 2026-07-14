# Deploy the backend to Railway

Railway only hosts the Extcom AI backend. The Chrome extension runs in the
browser and must not be deployed as a Railway service.

This guide uses the repository's root [`Dockerfile`](../Dockerfile) and
[`railway.toml`](../railway.toml). Keep the repository root as the build
context: this is an npm workspace, so setting Railway's Root Directory to
`/apps/backend` breaks the root Dockerfile and workspace lockfile setup.

## Requirements

- A Railway account with GitHub access
- A fork of this repository, or permission to deploy it directly
- An OpenRouter or OpenAI API key
- A Railway Volume for persistent SQLite data

## 1. Import the repository

1. In Railway, create a project and choose **Deploy from GitHub repo**.
2. Select your Extcom AI repository or fork.
3. Railway may detect the npm workspaces and stage two services:
   `@extcom-ai/backend` and `@extcom-ai/extension`.
4. Remove the `@extcom-ai/extension` service. Keep only
   `@extcom-ai/backend`.

The extension service is not a web application. Its production artifact is a
ZIP installed in Chrome, so deploying it on Railway wastes resources and does
not make the extension usable.

## 2. Verify the backend build settings

Open the backend service and check **Settings**. The expected values are:

| Setting | Value |
| --- | --- |
| Root Directory | empty |
| Builder | Dockerfile |
| Dockerfile Path | `/Dockerfile` |
| Custom Build Command | empty |
| Start Command | `node dist/server.js` |
| Healthcheck Path | `/health` |

The root [`railway.toml`](../railway.toml) supplies the builder, start command,
and healthcheck:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node dist/server.js"
healthcheckPath = "/health"
healthcheckTimeout = 300
```

Railway's UI may label these values as **set in `/railway.toml`**. That is
expected. Clear any automatically generated npm build or start command that
conflicts with this configuration.

The explicit start command is important. The final Docker image intentionally
contains `/app/dist` but not `/app/package.json`; an auto-generated command
such as `npm run start --workspace=@extcom-ai/backend` therefore crashes at
runtime.

## 3. Configure Watch Paths

Under **Settings → Build → Watch Paths**, use:

```txt
/apps/backend/**
/apps/extension/package.json
/Dockerfile
/railway.toml
/package.json
/package-lock.json
```

The backend source is the main trigger. The extension package manifest and
root files are also included because npm workspace resolution and the Docker
build depend on them. Do not add `/apps/extension/**`; ordinary extension-only
changes do not require a backend redeploy.

If Railway already skipped a commit with **No changes to watched files**, the
new Watch Paths do not redeploy that old commit retroactively. Select the
latest commit in Railway and use **Deploy Commit** once.

## 4. Add environment variables

Open **Variables** on the backend service and add at least:

```env
AI_DEFAULT_PROVIDER=openrouter
AI_DEFAULT_MODEL=openrouter/auto
OPENROUTER_API_KEY=your-openrouter-key
AUTH_TOKENS=your-long-random-token:power
DATABASE_PATH=/data/extcom-ai.db
```

For OpenAI instead:

```env
AI_DEFAULT_PROVIDER=openai
AI_DEFAULT_MODEL=gpt-5.4-nano
OPENAI_API_KEY=your-openai-key
AUTH_TOKENS=your-long-random-token:power
DATABASE_PATH=/data/extcom-ai.db
```

Generate a private access token rather than using the example value:

```bash
openssl rand -hex 32
```

Append `:power` to that value in `AUTH_TOKENS`, then enter only the token
portion before `:power` in the extension. The available plans are `free`,
`pro`, and `power`; they control rate limits, not billing subscriptions.

Railway injects `PORT` automatically. The Docker image defaults to port `3000`,
so a manual `PORT` variable is normally unnecessary. See [`.env.example`](../.env.example)
for model allowlists, admin tokens, provider proxies, and other optional values.

## 5. Attach persistent storage

From the project canvas:

1. Right-click the `@extcom-ai/backend` service and choose
   **Attach Volume**.
2. Set the mount path to:

   ```txt
   /data
   ```

3. Apply the staged change and redeploy.

If **Attach Volume** is not shown in the context menu, open Railway's command
palette with `Ctrl+K`/`Cmd+K`, choose **New Volume**, select the backend
service, and use the same `/data` mount path.

Afterward, the project canvas should show a volume connected beneath the
backend service. Click that volume to verify its mount path.

The SQLite database stores admin-issued tokens and backend rate-limit usage.
Without the volume, those values are lost when the deployment is replaced.
The extension's Generated/Inserted totals and history are different: Chrome
stores them locally, so they do not validate the Railway volume.

## 6. Deploy and expose the backend

1. Apply the staged Railway changes and deploy the backend.
2. Open **Settings → Networking → Public Networking**.
3. Choose **Generate Domain**. In Railway UI variants that show proxy choices,
   choose **HTTP Proxy** and target port `3000`.
4. Do not use **TCP Proxy**; Extcom AI serves HTTP.

Railway will provide an HTTPS domain similar to:

```txt
https://your-service.up.railway.app
```

Verify it in a browser or terminal:

```bash
curl https://your-service.up.railway.app/health
```

Expected response:

```json
{"ok":true}
```

The deployment logs should also contain:

```txt
Extcom AI backend listening on http://localhost:3000
```

## 7. Connect the Chrome extension

1. Open the Extcom AI toolbar popup.
2. Go to **Advanced → Connection**.
3. Enter the Railway HTTPS domain as **Backend URL**. Do not append `/health`.
4. Enter the token portion of `AUTH_TOKENS` without the `:power` suffix.
5. Select **Save**.
6. Accept Chrome's prompt to allow access to the Railway domain.
7. Select **Test connection** and confirm the popup reports **Connected**.

Chrome grants host access per backend domain. If the Railway URL changes, save
the new URL and accept the new permission prompt before testing it.

## 8. Verify persistence

Do this once before relying on the deployment:

1. In the popup's Connected card, note the **replies left today** value.
2. Complete one successful generation and confirm that value decreases.
3. Restart or redeploy the Railway backend.
4. Reconnect the extension and confirm **replies left today** keeps the
   decreased value instead of returning to the plan maximum.

If the value resets, check both `DATABASE_PATH=/data/extcom-ai.db` and the
volume's `/data` mount path.

## Troubleshooting

### Railway cannot find the Dockerfile or workspace package

Leave **Root Directory** empty. Do not set it to `/apps/backend` or `/data`.
`/data` is the runtime volume mount, while the root Docker build needs the
repository's `package.json`, lockfile, and workspace manifests.

### Railway created an extension service

This is normal JavaScript-monorepo auto-detection. Delete the
`@extcom-ai/extension` Railway service and keep the backend service.

### `ENOENT: no such file or directory, open '/app/package.json'`

Railway generated an npm start command for the workspace. Clear that command
and use `node dist/server.js`, as defined in the root `railway.toml`.

### `No changes to watched files`

Add all Watch Paths from step 3. If the desired commit was already skipped,
manually use **Deploy Commit** for that commit once.

### `dockerfile invalid: docker VOLUME is not supported, use Railway Volumes`

The deployed branch has an old Dockerfile containing `VOLUME /data`. Update to
the current Dockerfile, which creates the directory but leaves persistence to
the Railway Volume.

### Deployment succeeds but data resets

Confirm the volume is connected to the backend, mounted at `/data`, and the
database path is `/data/extcom-ai.db`.

### Domain is unavailable

Confirm Public Networking targets HTTP port `3000`. If a TCP Proxy was added,
remove it and generate an HTTP domain instead. Then check `/health` and the
deployment logs.

### `/health` works but the extension cannot connect

Save the Backend URL again and accept Chrome's domain-access prompt. Also make
sure the access token exactly matches the value before the plan suffix in
`AUTH_TOKENS`.
