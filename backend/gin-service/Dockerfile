FROM golang:1.26-alpine AS build

WORKDIR /app

# 先复制依赖清单，以便充分利用 Docker 构建缓存。
COPY go.mod go.sum ./
ENV GOPROXY=https://goproxy.cn,direct
RUN go mod download

# 编译不依赖 CGO 的 Linux 可执行文件。
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine

WORKDIR /app

COPY --from=build /app/server ./

EXPOSE 8080

CMD ["./server"]
