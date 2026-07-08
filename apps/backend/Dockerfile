# syntax=docker/dockerfile:1.7

FROM node:22-slim AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter backend build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

COPY --from=builder /app /app

WORKDIR /app/apps/backend
EXPOSE 3001

CMD ["node", "dist/main.js"]
