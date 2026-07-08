# syntax=docker/dockerfile:1.7

FROM node:22-slim AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

COPY . .

ARG NEXT_PUBLIC_API_BASE=http://localhost:3001
ARG NEXT_PUBLIC_SOCKET_BASE

ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_SOCKET_BASE=$NEXT_PUBLIC_SOCKET_BASE

RUN pnpm install --frozen-lockfile
RUN pnpm --filter admin build

FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

COPY --from=builder /app /app

WORKDIR /app/apps/admin
EXPOSE 3000

CMD ["pnpm", "start", "--hostname", "0.0.0.0", "--port", "3000"]
