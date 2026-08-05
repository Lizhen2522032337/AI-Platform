ARG NODE_BASE_IMAGE=node:22-alpine
ARG NGINX_BASE_IMAGE=nginx:alpine
FROM ${NODE_BASE_IMAGE} AS build

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,id=enterprise-ai-platform-node22-npm,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit

COPY . .
RUN npm run build

FROM ${NGINX_BASE_IMAGE} AS runtime

ARG APP_VERSION=local
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Enterprise AI Frontend" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
