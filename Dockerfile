FROM public.ecr.aws/docker/library/node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY patches ./patches
COPY scripts ./scripts
COPY packages ./packages
COPY apps/web ./apps/web
COPY config ./config

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @tyrum/schemas build \
  && pnpm --filter @tyrum/gateway build

ENV NODE_ENV=production

EXPOSE 8788

RUN groupadd --system --gid 10001 tyrum \
  && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/tyrum --shell /usr/sbin/nologin tyrum \
  && install -d -m 0770 -o 10001 -g 10001 /var/lib/tyrum

USER 10001:10001

ENTRYPOINT ["node", "packages/gateway/dist/index.mjs"]
CMD ["all"]
