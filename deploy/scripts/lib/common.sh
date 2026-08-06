#!/usr/bin/env bash

# Linux 部署脚本公共函数。
# 真实数据库配置始终位于仓库外，脚本不会把密码写入 Git 工作区。
set -Eeuo pipefail

readonly COMMON_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR="$(cd -- "${COMMON_DIR}/.." && pwd)"
readonly REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

# deploy.env 只保存分支和数据库模式等非敏感选项。
DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-/etc/enterprise-ai-platform/deploy.env}"
if [[ -f "${DEPLOY_CONFIG_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${DEPLOY_CONFIG_FILE}"
fi

readonly COMPOSE_FILE="${REPO_ROOT}/deploy/docker-compose.yml"
readonly BASE_IMAGES_FILE="${BASE_IMAGES_FILE:-/etc/enterprise-ai-platform/base-images.env}"
readonly DATABASE_ENV_FILE="${DATABASE_ENV_FILE:-/etc/enterprise-ai-platform/database.env}"
readonly PLATFORM_ENV_FILE="${PLATFORM_ENV_FILE:-/etc/enterprise-ai-platform/platform.env}"
readonly LLM_ENV_FILE="${LLM_ENV_FILE:-/etc/enterprise-ai-platform/llm.env}"
readonly AGENT_ENV_FILE="${AGENT_ENV_FILE:-/etc/enterprise-ai-platform/agent.env}"
readonly KNOWLEDGE_CONFIG_FILE="${KNOWLEDGE_CONFIG_FILE:-/etc/enterprise-ai-platform/knowledge-base.json}"
readonly DATABASE_MODE="${DATABASE_MODE:-managed}"
readonly DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-${HOME}/.local/state/enterprise-ai-platform}"
readonly DEPLOY_LOCK_DIR="${DEPLOY_STATE_DIR}/deploy.lock"
readonly DEPLOY_LOCK_OWNER_FILE="${DEPLOY_LOCK_DIR}/owner.pid"
readonly APP_IMAGE_REGISTRY="${APP_IMAGE_REGISTRY:-enterprise-ai-platform}"
# Python 依赖在 Docker 构建阶段下载，默认使用国内镜像；生产环境可在 deploy.env 覆盖。
readonly PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
readonly PIP_DEFAULT_TIMEOUT="${PIP_DEFAULT_TIMEOUT:-120}"
readonly PIP_RETRIES="${PIP_RETRIES:-8}"
readonly -a INFRASTRUCTURE_SERVICES=(redis rabbitmq qdrant minio)
readonly -a APPLICATION_SERVICES=(frontend fastapi-service nest-service gin-service worker)
readonly -a BACKEND_SERVICES=(fastapi-service nest-service gin-service worker)
readonly -a DATABASE_SERVICES=(nest-service worker)
# FastAPI Dockerfile 使用 BuildKit cache mount 保存 pip 下载缓存。Compose v2 默认
# 已启用 BuildKit；这里显式保留用户设置，并在未设置时启用。
DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"

# 基础镜像锁文件不包含密钥，可以由 pin-base-images.sh 在虚拟机上生成。
# set -a 确保其中的镜像 digest 能传入 Docker Compose 的变量插值。
if [[ -f "${BASE_IMAGES_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "${BASE_IMAGES_FILE}"
    set +a
fi
export DATABASE_ENV_FILE PLATFORM_ENV_FILE LLM_ENV_FILE AGENT_ENV_FILE
export DOCKER_BUILDKIT APP_IMAGE_REGISTRY BASE_IMAGES_FILE
export PIP_INDEX_URL PIP_DEFAULT_TIMEOUT PIP_RETRIES

log() {
    printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

warn() {
    printf '[%s] 警告：%s\n' "$(date '+%F %T')" "$*" >&2
}

die() {
    printf '[%s] 错误：%s\n' "$(date '+%F %T')" "$*" >&2
    exit 1
}

report_unexpected_error() {
    local exit_code="$?"
    local source_file="${BASH_SOURCE[1]:-unknown}"
    local source_line="${BASH_LINENO[0]:-unknown}"
    printf '[%s] 错误：部署脚本意外终止（exit=%s，位置=%s:%s）\n' \
        "$(date '+%F %T')" "${exit_code}" "${source_file}" "${source_line}" >&2
    return "${exit_code}"
}

# 防止 set -e 再次出现没有任何错误文字就返回命令行的情况。
trap report_unexpected_error ERR

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

ensure_repository() {
    require_command git
    git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
        || die "${REPO_ROOT} 不是 Git 仓库"
    [[ -f "${COMPOSE_FILE}" ]] || die "找不到 ${COMPOSE_FILE}"
}

ensure_docker_compose() {
    require_command docker
    docker compose version >/dev/null 2>&1 || die '未安装 Docker Compose v2 插件'
    docker info >/dev/null 2>&1 \
        || die '当前用户无法连接 Docker；请检查 Docker 服务和 docker 用户组权限'
}

run_preflight() {
    bash "${SCRIPT_DIR}/preflight.sh"
}

ensure_database_env() {
    local key configured_host
    local -a required_keys=(
        POSTGRES_HOST
        POSTGRES_PORT
        POSTGRES_DB
        POSTGRES_USER
        POSTGRES_PASSWORD
        POSTGRES_SSLMODE
    )

    [[ -f "${DATABASE_ENV_FILE}" ]] \
        || die "找不到独立数据库配置：${DATABASE_ENV_FILE}"
    [[ -r "${DATABASE_ENV_FILE}" ]] \
        || die "当前用户无法读取数据库配置：${DATABASE_ENV_FILE}"

    for key in "${required_keys[@]}"; do
        grep -Eq "^[[:space:]]*${key}=.+$" "${DATABASE_ENV_FILE}" \
            || die "${DATABASE_ENV_FILE} 缺少 ${key}"
    done

    grep -Eqi 'change_me|请替换|实际密码|your_password' "${DATABASE_ENV_FILE}" \
        && die "${DATABASE_ENV_FILE} 仍包含示例占位值，请先填写真实配置"

    case "${DATABASE_MODE}" in
        managed|external) ;;
        *) die "DATABASE_MODE 只能是 managed 或 external，当前值：${DATABASE_MODE}" ;;
    esac

    if [[ "${DATABASE_MODE}" == 'managed' ]]; then
        configured_host="$(awk -F= '/^[[:space:]]*POSTGRES_HOST=/{sub(/^[^=]*=/, ""); gsub(/^[[:space:]]+|[[:space:]]+$/, ""); gsub(/^"|"$/, ""); print; exit}' "${DATABASE_ENV_FILE}")"
        [[ "${configured_host}" == 'postgres' ]] \
            || die 'managed 模式要求 database.env 中 POSTGRES_HOST=postgres'
    fi
    return 0
}

ensure_platform_env() {
    local key
    local -a required_keys=(
        REDIS_HOST REDIS_PORT REDIS_PASSWORD
        RABBITMQ_HOST RABBITMQ_PORT RABBITMQ_DEFAULT_USER
        RABBITMQ_DEFAULT_PASS RABBITMQ_DEFAULT_VHOST RABBITMQ_TASK_QUEUE
        AI_SERVICE_URL QDRANT_URL QDRANT_COLLECTION
        MINIO_ENDPOINT MINIO_ROOT_USER MINIO_ROOT_PASSWORD MINIO_BUCKET MINIO_USE_SSL
        JWT_SECRET JWT_ISSUER JWT_AUDIENCE JWT_COOKIE_NAME JWT_EXPIRES_SECONDS COOKIE_SECURE
    )

    [[ -f "${PLATFORM_ENV_FILE}" ]] || die "找不到平台配置：${PLATFORM_ENV_FILE}"
    [[ -r "${PLATFORM_ENV_FILE}" ]] || die "当前用户无法读取平台配置：${PLATFORM_ENV_FILE}"
    for key in "${required_keys[@]}"; do
        grep -Eq "^[[:space:]]*${key}=.+$" "${PLATFORM_ENV_FILE}" \
            || die "${PLATFORM_ENV_FILE} 缺少 ${key}"
    done
    grep -Eqi 'change_me|请替换|实际密码|your_password' "${PLATFORM_ENV_FILE}" \
        && die "${PLATFORM_ENV_FILE} 仍包含示例占位值，请先填写真实配置"

    ensure_llm_env
    return 0
}

ensure_knowledge_config() {
    # 热配置不含密钥；旧环境首次升级时安全创建默认文件，之后绝不覆盖管理员调整。
    if [[ ! -e "${KNOWLEDGE_CONFIG_FILE}" ]]; then
        install -m 644 "${REPO_ROOT}/deploy/knowledge-base.example.json" \
            "${KNOWLEDGE_CONFIG_FILE}"
        log "已创建知识库热配置：${KNOWLEDGE_CONFIG_FILE}"
    fi
    return 0
}

ensure_llm_env() {
    local key
    local -a required_keys=(
        DEEPSEEK_API_KEY DEEPSEEK_BASE_URL DEEPSEEK_MODEL
        QWEN_API_KEY QWEN_BASE_URL QWEN_MODEL
        EMBEDDING_API_KEY EMBEDDING_BASE_URL EMBEDDING_MODEL EMBEDDING_DIMENSION
        EMBEDDING_REQUEST_TIMEOUT_SECONDS KNOWLEDGE_CONFIG_FILE
        LLM_REQUEST_TIMEOUT_SECONDS LLM_MAX_TOKENS
    )

    [[ -f "${LLM_ENV_FILE}" ]] || die "找不到独立大模型配置：${LLM_ENV_FILE}"
    [[ -r "${LLM_ENV_FILE}" ]] || die "当前用户无法读取大模型配置：${LLM_ENV_FILE}"
    for key in "${required_keys[@]}"; do
        grep -Eq "^[[:space:]]*${key}=.+$" "${LLM_ENV_FILE}" \
            || die "${LLM_ENV_FILE} 缺少 ${key}"
    done
    grep -Eqi 'change_me|请替换|你的工作空间|your[_-]?api|sk-xxx' "${LLM_ENV_FILE}" \
        && die "${LLM_ENV_FILE} 仍包含示例占位值，请先填写真实配置"
    # grep 在“没有占位符”时返回 1，这是配置正常的情况，不能让 set -e 静默退出更新脚本。
    return 0
}

release_tag() {
    if [[ -n "${RELEASE_TAG_OVERRIDE:-}" ]]; then
        printf '%s\n' "${RELEASE_TAG_OVERRIDE}"
        return 0
    fi
    git -C "${REPO_ROOT}" rev-parse --short=12 HEAD
}

compose() {
    local image_tag
    image_tag="$(release_tag)"
    if [[ "${DATABASE_MODE}" == 'managed' ]]; then
        # 三个配置路径已在文件开头 export；不要在命令前重复赋值只读变量。
        APP_IMAGE_TAG="${image_tag}" docker compose -f "${COMPOSE_FILE}" --profile managed-db "$@"
    else
        APP_IMAGE_TAG="${image_tag}" docker compose -f "${COMPOSE_FILE}" "$@"
    fi
}

acquire_deploy_lock() {
    mkdir -p "${DEPLOY_STATE_DIR}"
    if ! mkdir "${DEPLOY_LOCK_DIR}" 2>/dev/null; then
        die "已有部署任务正在运行；若确认没有任务，请删除 ${DEPLOY_LOCK_DIR}"
    fi
    printf '%s\n' "${BASHPID}" >"${DEPLOY_LOCK_OWNER_FILE}"
    trap release_deploy_lock EXIT
}

adopt_deploy_lock_after_exec() {
    # update-all 拉取到新版本后会 exec 自身。exec 前后操作系统 PID 不变，因此可以
    # 安全继承原部署锁，同时拒绝外部进程伪造“已经持锁”的环境变量。
    local owner_pid=''
    [[ -r "${DEPLOY_LOCK_OWNER_FILE}" ]] \
        || die '部署脚本尝试自更新重启，但找不到原部署锁'
    owner_pid="$(<"${DEPLOY_LOCK_OWNER_FILE}")"
    [[ "${owner_pid}" == "${BASHPID}" ]] \
        || die '部署脚本自更新后的进程与部署锁持有者不一致'
    trap release_deploy_lock EXIT
}

release_deploy_lock() {
    local owner_pid=''
    if [[ -r "${DEPLOY_LOCK_OWNER_FILE}" ]]; then
        owner_pid="$(<"${DEPLOY_LOCK_OWNER_FILE}")"
    fi
    if [[ "${owner_pid}" == "${BASHPID}" ]]; then
        rm -f -- "${DEPLOY_LOCK_OWNER_FILE}"
        rmdir "${DEPLOY_LOCK_DIR}" 2>/dev/null || true
    fi
}

wait_for_healthy() {
    local service="$1"
    local attempts="${2:-60}"
    local container_id status index

    for ((index = 1; index <= attempts; index++)); do
        container_id="$(compose ps -q "${service}" 2>/dev/null || true)"
        if [[ -n "${container_id}" ]]; then
            status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
            if [[ "${status}" == 'healthy' || "${status}" == 'running' ]]; then
                log "容器已就绪：${service}"
                return 0
            fi
            if [[ "${status}" == 'unhealthy' || "${status}" == 'exited' || "${status}" == 'dead' ]]; then
                compose logs --tail=100 "${service}" >&2 || true
                die "容器启动失败：${service}（${status}）"
            fi
        fi
        sleep 2
    done

    compose logs --tail=100 "${service}" >&2 || true
    die "等待容器就绪超时：${service}"
}

start_database_if_managed() {
    if [[ "${DATABASE_MODE}" == 'managed' ]]; then
        log '启动项目托管的 PostgreSQL 容器'
        compose up -d postgres
        wait_for_healthy postgres
    else
        log '使用外部 PostgreSQL；不会启动或修改本项目的数据库容器'
    fi
}

start_infrastructure() {
    log '启动 Redis、RabbitMQ、Qdrant 和 MinIO'
    compose up -d "${INFRASTRUCTURE_SERVICES[@]}"
    wait_for_healthy redis
    wait_for_healthy rabbitmq
    log '创建或确认 MinIO 结果桶'
    compose run --rm minio-init
}

run_migrations() {
    ensure_database_env
    log '执行幂等数据库迁移'
    compose run --rm migrator
}

ensure_clean_worktree() {
    local changes
    changes="$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=normal)"
    if [[ -n "${changes}" ]]; then
        printf '%s\n' "${changes}" >&2
        die '仓库存在本地修改；脚本不会覆盖，请先查明并提交、暂存或清理'
    fi
}

record_deploy_state() {
    local commit="$1"
    local branch="$2"

    mkdir -p "${DEPLOY_STATE_DIR}"
    printf '%s\n' "${commit}" >"${DEPLOY_STATE_DIR}/previous_commit"
    printf '%s\n' "${branch}" >"${DEPLOY_STATE_DIR}/production_branch"
}

record_successful_release() {
    local scope="${1:-full}"
    local commit tag timestamp current temp_file

    commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
    tag="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD)"
    timestamp="$(date --iso-8601=seconds)"
    mkdir -p "${DEPLOY_STATE_DIR}"

    if [[ "${scope}" == 'full' ]]; then
        if [[ -f "${DEPLOY_STATE_DIR}/current_release" ]]; then
            current="$(<"${DEPLOY_STATE_DIR}/current_release")"
            if [[ -n "${current}" && "${current}" != "${commit}" ]]; then
                printf '%s\n' "${current}" >"${DEPLOY_STATE_DIR}/previous_release"
            fi
        fi
        temp_file="$(mktemp "${DEPLOY_STATE_DIR}/current_release.XXXXXX")"
        printf '%s\n' "${commit}" >"${temp_file}"
        mv "${temp_file}" "${DEPLOY_STATE_DIR}/current_release"
    fi
    printf '%s\t%s\t%s\t%s\n' "${timestamp}" "${scope}" "${commit}" "${tag}" \
        >>"${DEPLOY_STATE_DIR}/release-history.tsv"
    log "已记录发布版本：scope=${scope} commit=${commit} image_tag=${tag}"
}

application_image_ref() {
    local service="$1"
    local tag="${2:-$(release_tag)}"
    printf '%s/%s:%s\n' "${APP_IMAGE_REGISTRY}" "${service}" "${tag}"
}

ensure_release_images() {
    local tag="$1"
    local service image_ref
    for service in "${APPLICATION_SERVICES[@]}"; do
        image_ref="$(application_image_ref "${service}" "${tag}")"
        docker image inspect "${image_ref}" >/dev/null 2>&1 \
            || die "缺少不可变回滚镜像：${image_ref}；禁止在回滚时现场重建"
    done
}

pull_code() {
    local requested_branch="${1:-}"
    local target_branch old_commit old_branch new_commit

    ensure_repository
    ensure_clean_worktree

    old_commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
    old_branch="$(git -C "${REPO_ROOT}" branch --show-current)"
    target_branch="${requested_branch:-${DEPLOY_BRANCH:-${old_branch}}}"
    [[ -n "${target_branch}" ]] || die '无法确定部署分支，请传入分支名或设置 DEPLOY_BRANCH'
    record_deploy_state "${old_commit}" "${old_branch:-${target_branch}}"

    log "从 origin 拉取分支：${target_branch}"
    git -C "${REPO_ROOT}" fetch origin "${target_branch}"
    if git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${target_branch}"; then
        git -C "${REPO_ROOT}" switch "${target_branch}"
    else
        git -C "${REPO_ROOT}" switch --track -c "${target_branch}" "origin/${target_branch}"
    fi
    git -C "${REPO_ROOT}" pull --ff-only origin "${target_branch}"

    new_commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
    printf '更新前：%s\n更新后：%s\n' "${old_commit}" "${new_commit}"
    git -C "${REPO_ROOT}" diff --name-only "${old_commit}" "${new_commit}"
}

deployment_runtime_revision() {
    local entry_script="$1"
    # 更新入口和公共函数库都可能在 pull 时被替换；组合哈希用于判断是否必须 exec。
    git -C "${REPO_ROOT}" hash-object \
        "${entry_script}" \
        "${SCRIPT_DIR}/lib/common.sh"
}

prepare_update() {
    local entry_script="$1"
    local branch="$2"
    shift 2
    local before_revision after_revision reexec_count

    reexec_count="${DEPLOY_SELF_REEXEC_COUNT:-0}"
    [[ "${reexec_count}" =~ ^[0-9]+$ ]] || die 'DEPLOY_SELF_REEXEC_COUNT 格式无效'
    if ((reexec_count > 0)); then
        adopt_deploy_lock_after_exec
    else
        acquire_deploy_lock
    fi

    before_revision="$(deployment_runtime_revision "${entry_script}")"
    pull_code "${branch}"
    after_revision="$(deployment_runtime_revision "${entry_script}")"
    if [[ "${before_revision}" != "${after_revision}" ]]; then
        ((reexec_count < 2)) || die '部署脚本连续自更新次数过多，请检查部署分支是否稳定'
        log "检测到 $(basename -- "${entry_script}") 或公共函数库已更新，自动重新载入后继续部署"
        export DEPLOY_SELF_REEXEC_COUNT="$((reexec_count + 1))"
        exec bash "${entry_script}" "$@"
    fi
    return 0
}

prepare_deployment_environment() {
    log '检查 Docker、外部配置、依赖锁和磁盘空间'
    ensure_docker_compose
    ensure_database_env
    ensure_platform_env
    ensure_knowledge_config
    compose config --quiet
    run_preflight
    log '部署环境检查完成，开始更新运行中的服务'
}

wait_http() {
    local url="$1"
    local description="$2"
    local attempts="${3:-30}"
    local index

    for ((index = 1; index <= attempts; index++)); do
        if compose exec -T nginx wget -qO- -T 5 "${url}" >/dev/null 2>&1; then
            log "验收通过：${description}"
            return 0
        fi
        sleep 2
    done
    compose logs --tail=100 >&2 || true
    die "验收失败：${description}（${url}）"
}

wait_internal_http() {
    local service="$1"
    local command="$2"
    local description="$3"
    local attempts="${4:-30}"
    local index

    for ((index = 1; index <= attempts; index++)); do
        if compose exec -T "${service}" sh -ec "${command}" >/dev/null 2>&1; then
            log "验收通过：${description}"
            return 0
        fi
        sleep 2
    done
    compose logs --tail=100 "${service}" >&2 || true
    die "验收失败：${description}"
}

verify_service() {
    case "$1" in
        frontend) wait_http 'http://127.0.0.1/' 'React 前端' ;;
        fastapi-service) wait_internal_http fastapi-service "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)\"" 'FastAPI AI 服务' ;;
        gin-service) wait_http 'http://127.0.0.1/realtime/health' 'Gin 实时服务' ;;
        nest-service) wait_http 'http://127.0.0.1/api/health' 'NestJS 核心后端' ;;
        worker) wait_internal_http worker "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=3)\"" '异步 Worker' ;;
        nginx) wait_http 'http://127.0.0.1/healthz' 'Nginx 统一入口' ;;
        *) die "不支持的服务：$1" ;;
    esac
}

validate_service() {
    case "$1" in
        frontend|fastapi-service|gin-service|nest-service|worker|nginx) ;;
        *) die "不支持的服务：$1" ;;
    esac
}

is_backend_service() {
    case "$1" in
        fastapi-service|gin-service|nest-service|worker) return 0 ;;
        *) return 1 ;;
    esac
}

uses_database() {
    case "$1" in
        nest-service|worker) return 0 ;;
        *) return 1 ;;
    esac
}

assert_service_recreated() {
    local service="$1"
    local previous_id="$2"
    local current_id

    current_id="$(compose ps -q "${service}")"
    [[ -n "${current_id}" ]] || die "${service} 更新后没有运行中的容器"
    if [[ -n "${previous_id}" && "${previous_id}" == "${current_id}" ]]; then
        die "${service} 容器 ID 未变化，未完成强制重建"
    fi
    log "已确认 ${service} 容器重新创建：${previous_id:-未运行} -> ${current_id}"
}

rebuild_and_recreate_services() {
    (($# > 0)) || die '没有指定需要构建的应用服务'
    local service
    local -A previous_ids=()
    local -a services=("$@")

    for service in "${services[@]}"; do
        previous_ids["${service}"]="$(compose ps -q "${service}" 2>/dev/null || true)"
    done
    log "开始构建应用镜像：${services[*]}"
    compose build "${services[@]}"
    log "强制重新创建应用容器：${services[*]}"
    compose up -d --no-deps --force-recreate "${services[@]}"
    for service in "${services[@]}"; do
        wait_for_healthy "${service}"
        assert_service_recreated "${service}" "${previous_ids[${service}]}"
    done
}

recreate_nginx() {
    local previous_id
    previous_id="$(compose ps -q nginx 2>/dev/null || true)"
    if [[ -n "${previous_id}" ]]; then
        log '校验新的 Nginx 配置'
        compose exec -T nginx nginx -t
    fi
    log '强制重新创建 Nginx 容器'
    compose up -d --no-deps --force-recreate nginx
    wait_for_healthy nginx
    assert_service_recreated nginx "${previous_id}"
}

refresh_nginx() {
    # Nginx 在启动时解析上游容器地址，后端重建后需重启以刷新地址。
    recreate_nginx
}

update_one_service() {
    local service="$1"

    validate_service "${service}"
    prepare_deployment_environment

    if is_backend_service "${service}"; then
        start_infrastructure
    fi
    if uses_database "${service}"; then
        start_database_if_managed
        run_migrations
    fi

    if [[ "${service}" == 'nginx' ]]; then
        recreate_nginx
    else
        rebuild_and_recreate_services "${service}"
        refresh_nginx
    fi

    compose ps
    verify_service "${service}"
    record_successful_release "component:${service}"
    log "${service} 已完成构建、容器重建和健康检查"
}
