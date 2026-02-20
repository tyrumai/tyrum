FROM node:24-bookworm-slim

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
COPY config ./config

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @tyrum/schemas build \
  && pnpm --filter @tyrum/gateway build

ENV NODE_ENV=production

EXPOSE 8080

ENTRYPOINT ["node", "packages/gateway/dist/index.mjs"]
CMD ["all"]

