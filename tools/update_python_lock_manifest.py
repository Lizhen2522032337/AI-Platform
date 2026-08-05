"""生成或校验 Python 依赖入口与锁文件的 SHA-256 清单。

清单用于阻止只修改 requirements 而忘记重新生成 lock 的发布。脚本只处理项目内
固定的 FastAPI 和 Worker 依赖文件，不读取或输出任何环境变量与密钥。
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIRECTORIES = (
    REPOSITORY_ROOT / "backend" / "fastapi-service",
    REPOSITORY_ROOT / "backend" / "worker",
)
LOCK_FILES = (
    "requirements.txt",
    "requirements.lock",
    "requirements-dev.txt",
    "requirements-dev.lock",
)
MANIFEST_NAME = "python-lock.manifest.sha256"


def file_sha256(path: Path) -> str:
    """统一换行为 LF 后计算哈希，保证 Windows 生成的清单可在 Linux 校验。"""

    digest = hashlib.sha256()
    content = path.read_bytes()
    normalized_content = content.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    digest.update(normalized_content)
    return digest.hexdigest()


def expected_manifest(directory: Path) -> str:
    """使用 sha256sum 兼容格式输出稳定、可审计的文件清单。"""

    lines = [f"{file_sha256(directory / name)}  {name}" for name in LOCK_FILES]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="更新或校验 Python lock 哈希清单")
    parser.add_argument(
        "--check",
        action="store_true",
        help="只校验，不修改文件；不一致时返回非零状态",
    )
    args = parser.parse_args()

    mismatches: list[str] = []
    for directory in SERVICE_DIRECTORIES:
        expected = expected_manifest(directory)
        manifest = directory / MANIFEST_NAME
        if args.check:
            actual = manifest.read_text(encoding="utf-8") if manifest.exists() else ""
            if actual != expected:
                mismatches.append(str(manifest.relative_to(REPOSITORY_ROOT)))
        else:
            manifest.write_text(expected, encoding="utf-8", newline="\n")
            print(f"已更新：{manifest.relative_to(REPOSITORY_ROOT)}")

    if mismatches:
        print("以下 Python 锁清单已过期，请重新生成 lock 和 manifest：")
        for mismatch in mismatches:
            print(f"- {mismatch}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
