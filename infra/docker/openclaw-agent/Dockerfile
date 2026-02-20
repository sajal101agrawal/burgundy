FROM node:22-alpine

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY packages/openclaw-fork/ /app/
RUN corepack enable && pnpm install && pnpm build

COPY packages/openclaw-extensions/ /skills/

VOLUME /workspace
EXPOSE 18789
CMD ["node", "dist/cli.js", "gateway", "--port", "18789"]
