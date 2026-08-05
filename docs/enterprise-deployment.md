# 企业级构建、发布与回滚

本文描述当前单台 Linux 虚拟机上的企业级第一阶段方案。目标是在不引入 Kubernetes
和大型制品平台的前提下，实现固定运行环境、可重复构建、增量发布、版本审计和快速回滚。

## 1. 发布原则

1. 真实配置和密钥始终位于 `/etc/enterprise-ai-platform`，不进入 Git 或镜像。
2. 生产依赖只从 lock 文件安装，不在运行中的容器执行 `pip install` 或 `npm install`。
3. 基础镜像固定到 `sha256` digest，只有经过审批的运行环境升级才重新固定。
4. 应用镜像使用 Git Commit 前 12 位作为 tag，同一个 Commit 不使用浮动 `latest`。
5. 修改哪个服务就构建哪个服务；完整版本发布才构建五个应用服务。
6. 回滚只切换到已经存在并验收过的镜像，禁止在事故期间现场重新构建旧代码。

## 2. 构建和数据流

```text
Git Commit
   -> GitHub Actions：lint / test / build
   -> 固定 digest 的 Python、Node、Go 基础镜像
   -> BuildKit 公共 pip/npm/Go 缓存
   -> enterprise-ai-platform/<service>:<commit-12>
   -> Linux 虚拟机健康检查
   -> release-history.tsv 发布审计记录
```

运行配置仍由仓库外文件注入。镜像中只包含应用程序和精确锁定依赖。

## 3. 第一次启用企业发布流程

已经部署过旧版本的虚拟机，需要先拉取这次改造，再固定基础镜像：

```bash
cd /opt/enterprise-ai-platform
git pull --ff-only
bash ./deploy/scripts/pin-base-images.sh
bash ./deploy/scripts/preflight.sh
bash ./deploy/scripts/update-all.sh
```

`pin-base-images.sh` 会拉取当前批准标签，并把 Linux 架构对应的不可变 digest 写入：

```text
/etc/enterprise-ai-platform/base-images.env
```

该文件不含密钥。不要在每次部署时重新生成；只有计划升级 Python、Node、Go、数据库或
基础系统镜像时，才重新执行并完成回归测试。

空白虚拟机使用 `bootstrap-deploy.sh` 时，会自动完成首次基础镜像固定。

## 4. 公共依赖缓存

| 生态 | 生产锁 | 公共缓存 |
| --- | --- | --- |
| FastAPI / Python 3.13 | `requirements.lock` + SHA-256 | pip cache + Python 3.13 wheelhouse |
| Worker / Python 3.11 | `requirements.lock` + SHA-256 | pip cache + Python 3.11 wheelhouse |
| NestJS / React | `package-lock.json` | Node 22 npm 下载缓存 |
| Gin | `go.mod` + `go.sum` | Go module cache + Go build cache |

Python 3.11 与 3.13 的 wheelhouse 有不同缓存 ID，不能混用包含本地二进制的 wheel。
NestJS 与前端只共享 npm 下载缓存，不共享 `node_modules`。

不要在日常维护中执行以下命令，否则会清除可复用依赖和旧版本回滚镜像：

```text
docker system prune -a
docker builder prune -a
```

可用 `bash ./deploy/scripts/status.sh` 查看镜像、BuildKit 缓存和磁盘占用。

## 5. 日常发布

发布前只读检查：

```bash
bash ./deploy/scripts/preflight.sh
```

只修改一个服务时：

```bash
bash ./deploy/scripts/update-frontend.sh
bash ./deploy/scripts/update-fastapi.sh
bash ./deploy/scripts/update-nest.sh
bash ./deploy/scripts/update-gin.sh
bash ./deploy/scripts/update-worker.sh
```

一次修改多个服务时，只拉取一次代码并构建指定服务：

```bash
bash ./deploy/scripts/update-services.sh frontend fastapi-service nest-service worker
```

完整发布：

```bash
bash ./deploy/scripts/update-all.sh
```

完整发布验收通过后会更新：

```text
~/.local/state/enterprise-ai-platform/current_release
~/.local/state/enterprise-ai-platform/previous_release
~/.local/state/enterprise-ai-platform/release-history.tsv
```

## 6. 构建一次并推送企业镜像仓库

默认情况下镜像只保存在当前虚拟机。接入 Harbor、GHCR 或其他企业仓库后，在
`/etc/enterprise-ai-platform/deploy.env` 配置：

```dotenv
APP_IMAGE_REGISTRY=registry.example.com/enterprise-ai-platform
```

完成 `docker login` 后执行：

```bash
bash ./deploy/scripts/build-release.sh --push
```

脚本会构建当前干净 Commit 的版本镜像、生成镜像 ID 清单并推送。镜像仓库登录凭据
由 Docker credential store 管理，不写入 deploy.env。

## 7. 快速回滚

回滚到最近一个完整发布：

```bash
bash ./deploy/scripts/rollback.sh
```

回滚到指定 Commit：

```bash
bash ./deploy/scripts/rollback.sh <commit-id>
```

回滚脚本先检查五个应用镜像是否全部存在，然后使用 `--no-build` 切换容器。只要镜像仍在，
就不会下载语言依赖或重新编译。数据库迁移采用向前兼容策略，回滚脚本不会删除或回滚数据。

## 8. 更新 Python 依赖

修改 `requirements.txt` 或 `requirements-dev.txt` 后，必须用 uv 重新生成 Linux 锁文件：

```bash
cd backend/fastapi-service
uv pip compile requirements.txt -o requirements.lock --generate-hashes \
  --python-version 3.13 --python-platform x86_64-manylinux_2_28 --no-strip-extras
uv pip compile requirements-dev.txt -o requirements-dev.lock --generate-hashes \
  --python-version 3.13 --python-platform x86_64-manylinux_2_28 --no-strip-extras

cd ../worker
uv pip compile requirements.txt -o requirements.lock --generate-hashes \
  --python-version 3.11 --python-platform x86_64-manylinux_2_28 --no-strip-extras
uv pip compile requirements-dev.txt -o requirements-dev.lock --generate-hashes \
  --python-version 3.11 --python-platform x86_64-manylinux_2_28 --no-strip-extras

cd ../../
python tools/update_python_lock_manifest.py
```

依赖入口、lock 文件和 `python-lock.manifest.sha256` 必须在同一次 Commit 中提交。
发布前检查和 CI 都会校验清单，防止修改依赖入口后忘记更新生产锁。

## 9. 当前边界

本阶段仍是单虚拟机、单实例应用服务，因此不能抵御整台虚拟机故障，也不是无停机滚动发布。
下一阶段在业务需要明确后再增加私有镜像仓库、第二台应用节点、负载均衡、集中监控和数据库
高可用。当前改造先解决最频繁的解释器漂移、重复下载、全量构建和事故回滚过慢问题。
