FROM python:3.13-slim

WORKDIR /app

# 先安装 Python 依赖，以便业务代码变化时直接复用整个依赖层。
# BuildKit 的 pip 缓存会跨构建保留下载文件：requirements 变化时，只需下载
# 新增或版本发生变化的包；缓存不会进入最终镜像。
COPY requirements.txt ./
RUN --mount=type=cache,id=enterprise-ai-platform-fastapi-pip,target=/root/.cache/pip,sharing=locked \
    pip install -r requirements.txt

# 复制应用代码并启动 FastAPI 服务。
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
