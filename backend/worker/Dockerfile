ARG PYTHON_BASE_IMAGE=python:3.11-slim
FROM ${PYTHON_BASE_IMAGE}

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_DEFAULT_TIMEOUT=120
ARG PIP_RETRIES=8

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Worker 使用独立的 Python 3.11 wheel 缓存，禁止与 Python 3.13 二进制 wheel 混用。
COPY requirements.txt requirements.lock ./
RUN --mount=type=cache,id=enterprise-ai-platform-python311-pip,target=/root/.cache/pip,sharing=locked \
    --mount=type=cache,id=enterprise-ai-platform-python311-wheelhouse,target=/opt/pip-wheelhouse,sharing=locked \
    pip download --require-hashes --dest /opt/pip-wheelhouse -r requirements.lock \
    && pip install --no-index --require-hashes --find-links=/opt/pip-wheelhouse -r requirements.lock \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app

COPY --chown=app:app app ./app

# 版本标签放在依赖层之后，避免每次 Git 提交变化都重新执行 pip 下载。
ARG APP_VERSION=local
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Enterprise AI Worker" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"

USER 10001:10001

EXPOSE 8090

CMD ["python", "-m", "app.main"]
