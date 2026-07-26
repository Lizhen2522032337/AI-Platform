FROM python:3.11-slim

WORKDIR /app

# 先安装依赖，充分利用 Docker 构建缓存。
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Worker 不对外提供业务接口，只在 8090 暴露容器健康检查。
COPY app ./app

EXPOSE 8090

CMD ["python", "-m", "app.main"]
