"""报表生成与文件生成 Tool：Markdown、证据 JSON 和数据库查询 CSV。"""

import csv
import io
import json
import logging
import re
from typing import Any

from app.config.settings import Settings, get_settings
from app.integrations import save_file

logger = logging.getLogger(__name__)


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")
    return cleaned[:80] or "data"


def _csv_payload(rows: list[dict[str, object]], columns: list[str]) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    # Excel 在 Windows 上能自动识别 UTF-8 BOM。
    return stream.getvalue().encode("utf-8-sig")


def create_report_files(
    task_id: int,
    title: str,
    markdown: str,
    observations: list[dict[str, Any]],
    settings: Settings | None = None,
) -> list[dict[str, object]]:
    """把最终报告及其数据证据保存到现有 MinIO 的任务目录。"""

    current = settings or get_settings()
    if not current.report_files_enabled:
        return []
    artifacts: list[dict[str, object]] = []
    prefix = f"tasks/{task_id}"
    report = save_file(
        f"{prefix}/report.md",
        f"# {title}\n\n{markdown.strip()}\n".encode(),
        "text/markdown; charset=utf-8",
    )
    artifacts.append({"name": "分析报告.md", "kind": "report", **report})

    evidence_body = json.dumps(
        {"taskId": task_id, "observations": observations},
        ensure_ascii=False,
        indent=2,
        default=str,
    ).encode("utf-8")
    evidence = save_file(
        f"{prefix}/evidence.json",
        evidence_body,
        "application/json",
    )
    artifacts.append({"name": "证据清单.json", "kind": "evidence", **evidence})

    for observation in observations:
        if observation.get("tool") not in {"database_query", "db2_query"} or observation.get("status") != "ok":
            continue
        rows = observation.get("rows")
        columns = observation.get("columns")
        if not isinstance(rows, list) or not isinstance(columns, list):
            continue
        query_id = _safe_name(str(observation.get("queryId") or "query"))
        csv_file = save_file(
            f"{prefix}/{query_id}.csv",
            _csv_payload(rows, [str(column) for column in columns]),
            "text/csv; charset=utf-8",
        )
        artifacts.append(
            {"name": f"{query_id}.csv", "kind": "query_data", **csv_file}
        )
    logger.info("Agent report files created: task_id=%s files=%d", task_id, len(artifacts))
    return artifacts
