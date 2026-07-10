# Backend-only image. The extension is built separately and loaded in the browser.
FROM node:24-alpine AS build
WORKDIR /app
# Copy the workspace manifests first so dependency layers cache well. The
# extension package.json is needed for npm to resolve the workspace graph even
# though only the backend gets installed and built.
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/extension/package.json ./apps/extension/package.json
RUN npm ci --workspace=@extcom-ai/backend
COPY apps/backend ./apps/backend
RUN npm run build --workspace=@extcom-ai/backend

FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=3000
# SQLite lives on a volume so issued tokens and usage counters survive restarts.
ENV DATABASE_PATH=/data/extcom-ai.db
WORKDIR /app
COPY --from=build /app/apps/backend/dist ./dist
# No VOLUME instruction here: Railway's Dockerfile builder rejects it. Mount
# a persistent volume/disk at /data on whichever platform you deploy to.
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1
CMD ["node", "dist/server.js"]
