FROM python:3.13-slim

WORKDIR /app

# 先安装 Python 依赖，以便业务代码变化时直接复用整个依赖层。
# 两个 BuildKit 缓存都保存在虚拟机的 Docker 构建缓存中，不进入最终镜像：
# - pip-cache 保存索引响应和 pip 自身下载缓存；
# - wheelhouse 明确保留已经下载的 wheel，requirements 变化时只补齐缺失版本。
COPY requirements.txt ./
RUN --mount=type=cache,id=enterprise-ai-platform-fastapi-pip,target=/root/.cache/pip,sharing=locked \
    --mount=type=cache,id=enterprise-ai-platform-fastapi-wheelhouse,target=/opt/pip-wheelhouse,sharing=locked \
    pip download --dest /opt/pip-wheelhouse -r requirements.txt \
    && pip install --no-index --find-links=/opt/pip-wheelhouse -r requirements.txt

# 复制应用代码并启动 FastAPI 服务。
COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
