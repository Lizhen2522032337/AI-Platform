FROM python:3.11-slim

WORKDIR /app

# 先安装 Python 依赖，以便充分利用 Docker 构建缓存。
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码并启动 FastAPI 服务。
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
