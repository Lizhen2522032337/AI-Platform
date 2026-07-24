FROM node:20-alpine AS build

WORKDIR /app

# 先安装依赖，以便充分利用 Docker 构建缓存。
COPY package*.json ./
RUN npm install

# 构建 React 生产资源。
COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
