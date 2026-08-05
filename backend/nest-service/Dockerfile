# syntax=docker/dockerfile:1.7

ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE} AS build

WORKDIR /app

# npm 下载缓存由前端和 NestJS 共享；node_modules 仍按各自 lock 文件独立生成。
COPY package*.json ./
RUN --mount=type=cache,id=enterprise-ai-platform-node22-npm,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit

COPY . .
RUN npm run build \
    && npm prune --omit=dev

ARG NODE_BASE_IMAGE=node:22-alpine
FROM ${NODE_BASE_IMAGE} AS runtime

ARG APP_VERSION=local
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Enterprise AI NestJS" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

CMD ["node", "dist/main"]
