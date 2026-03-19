FROM public.ecr.aws/docker/library/node:24-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY patches ./patches
COPY scripts ./scripts
COPY packages ./packages
COPY apps/web ./apps/web
COPY config ./config

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @tyrum/contracts build \
  && pnpm --filter @tyrum/cli-utils build \
  && pnpm --filter @tyrum/runtime-policy build \
  && pnpm --filter @tyrum/gateway build

RUN mkdir -p /app/apps/desktop \
  && printf '%s\n' \
    '{' \
    '  "name": "tyrum-desktop-stub",' \
    '  "private": true,' \
    '  "version": "0.0.0",' \
    '  "dependencies": {' \
    '    "@develar/schema-utils": "2.6.5",' \
    '    "dmg-license": "1.0.11"' \
    '  }' \
    '}' \
    > /app/apps/desktop/package.json \
  && pnpm --filter @tyrum/gateway deploy --legacy --prod /app/deploy \
  && cp -R /app/packages/gateway/migrations /app/deploy/migrations

FROM base AS production

ENV NODE_ENV=production

COPY --from=builder /app/config ./config
COPY --from=builder /app/deploy ./packages/gateway

EXPOSE 8788

RUN groupadd --system --gid 10001 tyrum \
  && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/tyrum --shell /usr/sbin/nologin tyrum \
  && install -d -m 0770 -o 10001 -g 10001 /var/lib/tyrum

USER 10001:10001

ENTRYPOINT ["node", "packages/gateway/dist/index.mjs"]
CMD ["all"]
