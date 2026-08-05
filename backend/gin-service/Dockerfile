ARG GO_BASE_IMAGE=golang:1.26-alpine
ARG ALPINE_BASE_IMAGE=alpine:latest
FROM ${GO_BASE_IMAGE} AS build

ENV GOPROXY=https://goproxy.cn,direct \
    GOTOOLCHAIN=local
WORKDIR /app

COPY go.mod go.sum ./
RUN --mount=type=cache,id=enterprise-ai-platform-go126-mod,target=/go/pkg/mod,sharing=locked \
    go mod download

COPY . .
RUN --mount=type=cache,id=enterprise-ai-platform-go126-mod,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,id=enterprise-ai-platform-go126-build,target=/root/.cache/go-build,sharing=locked \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -buildid=" -o /out/server .

FROM ${ALPINE_BASE_IMAGE} AS runtime

ARG APP_VERSION=local
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Enterprise AI Gin" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app

WORKDIR /app
COPY --from=build --chown=10001:10001 /out/server ./server

USER 10001:10001

EXPOSE 8080

CMD ["./server"]
