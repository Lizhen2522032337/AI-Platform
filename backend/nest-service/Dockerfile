FROM node:20-alpine

WORKDIR /app

# 先安装依赖，以便充分利用 Docker 构建缓存。
COPY package*.json ./
RUN npm install

# 编译并启动 NestJS 服务。
COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main"]
