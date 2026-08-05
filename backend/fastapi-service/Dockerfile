# 基础镜像由 Compose 注入；生产环境可在仓库外的 base-images.env 中固定到 digest。
ARG PYTHON_BASE_IMAGE=python:3.13-slim
FROM ${PYTHON_BASE_IMAGE}

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_DEFAULT_TIMEOUT=120
ARG PIP_RETRIES=8

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# requirements.txt 是人工维护的依赖入口；requirements.lock 是生产构建使用的精确哈希锁。
# wheelhouse 和 pip 下载缓存保存在 BuildKit 公共缓存中，代码变化不会重新下载依赖。
COPY requirements.txt requirements.lock ./
RUN --mount=type=cache,id=enterprise-ai-platform-python313-pip,target=/root/.cache/pip,sharing=locked \
    --mount=type=cache,id=enterprise-ai-platform-python313-wheelhouse,target=/opt/pip-wheelhouse,sharing=locked \
    pip download --require-hashes --dest /opt/pip-wheelhouse -r requirements.lock \
    && pip install --no-index --require-hashes --find-links=/opt/pip-wheelhouse -r requirements.lock \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app

COPY --chown=app:app . .

# 版本标签放在依赖层之后，避免每次 Git 提交变化都重新执行 pip 下载。
ARG APP_VERSION=local
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Enterprise AI FastAPI" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

USER 10001:10001

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
