# Zorel on a server (spec 014): the server and the web app, a headless Chromium for the agents' browser, one port and
# one data folder. Run it behind HTTPS (Caddy) or Tailscale; see docs/server.md.

# The web app, built with the whole workspace.
FROM oven/bun:1.4.4 AS web
WORKDIR /app
COPY . .
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN bun install --frozen-lockfile && bun run build

# Only the server's dependencies (no desktop, site or web build tools).
FROM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY packages/contracts/package.json packages/contracts/
RUN bun install --production --filter ./apps/server

FROM oven/bun:1.4.4
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# git for the projects' history; the headless Chromium and the system libraries it needs.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY package.json ./
COPY packages/contracts packages/contracts
COPY --from=deps /app/packages/contracts/node_modules packages/contracts/node_modules
COPY apps/server apps/server
COPY --from=web /app/apps/web/dist apps/web/dist
RUN bun apps/server/node_modules/playwright-core/cli.js install --with-deps chromium-headless-shell && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data && chown bun:bun /data
USER bun
ENV ZOREL_SERVER=1 ZOREL_HOME=/data ZOREL_LISTEN=0.0.0.0:4317 NODE_ENV=production
VOLUME /data
EXPOSE 4317
# ZOREL_PUBLIC_URL is required: the address people open (https://zorel.example.com).
CMD ["bun", "apps/server/src/main.ts"]
