FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
    pkg-config \
    libx11-dev \
    libxtst-dev \
    libpng++-dev \
    libxkbfile-dev \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY patches ./patches
COPY scripts ./scripts
COPY packages/schemas ./packages/schemas
COPY packages/cli-utils ./packages/cli-utils
COPY packages/client ./packages/client
COPY packages/desktop-node ./packages/desktop-node

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @tyrum/schemas build \
  && pnpm --filter @tyrum/cli-utils build \
  && pnpm --filter @tyrum/client build \
  && pnpm --filter @tyrum/desktop-node build

# ---------------------------------------------------------------------------

FROM public.ecr.aws/docker/library/node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    at-spi2-common \
    at-spi2-core \
    bash \
    ca-certificates \
    curl \
    dbus \
    dbus-x11 \
    novnc \
    tini \
    websockify \
    x11-utils \
    x11vnc \
    xauth \
    xfce4 \
    xfce4-terminal \
    xvfb \
    zenity \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/packages/schemas/package.json ./packages/schemas/package.json
COPY --from=builder /app/packages/schemas/dist ./packages/schemas/dist
COPY --from=builder /app/packages/schemas/node_modules ./packages/schemas/node_modules

COPY --from=builder /app/packages/cli-utils/package.json ./packages/cli-utils/package.json
COPY --from=builder /app/packages/cli-utils/dist ./packages/cli-utils/dist
COPY --from=builder /app/packages/cli-utils/node_modules ./packages/cli-utils/node_modules

COPY --from=builder /app/packages/client/package.json ./packages/client/package.json
COPY --from=builder /app/packages/client/dist ./packages/client/dist
COPY --from=builder /app/packages/client/node_modules ./packages/client/node_modules

COPY --from=builder /app/packages/desktop-node/package.json ./packages/desktop-node/package.json
COPY --from=builder /app/packages/desktop-node/dist ./packages/desktop-node/dist
COPY --from=builder /app/packages/desktop-node/bin ./packages/desktop-node/bin
COPY --from=builder /app/packages/desktop-node/node_modules ./packages/desktop-node/node_modules

COPY docker/desktop-sandbox/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5900
EXPOSE 6080

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD curl -fsS "http://127.0.0.1:${NOVNC_PORT:-6080}/vnc.html" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
