#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE="${1:-}"
LINES="${LINES:-200}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-enterprise-ai}"

if [[ -n "$SERVICE" ]]; then
  docker compose --project-name "$PROJECT_NAME" logs --tail="$LINES" -f "$SERVICE"
else
  docker compose --project-name "$PROJECT_NAME" logs --tail="$LINES" -f
fi
