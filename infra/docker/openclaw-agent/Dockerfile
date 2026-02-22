FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  build-essential \
  cmake \
  python3 \
  chromium \
  ca-certificates \
  fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY packages/openclaw-fork/ /app/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  corepack enable && CI=true pnpm install --frozen-lockfile && pnpm build

COPY packages/openclaw-extensions/ /app/extensions/

VOLUME /workspace
EXPOSE 18789
CMD ["node", "openclaw.mjs", "gateway", "--port", "18789", "--bind", "lan"]
