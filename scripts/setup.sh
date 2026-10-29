#!/usr/bin/env bash
# 安装依赖：pnpm install --frozen-lockfile（与 pnpm-lock.yaml 严格一致，幂等）。
# 日志：<项目>/.run/logs/setup.log
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"
trap on_error ERR

PNPM_BIN="$(command -v pnpm || true)"
[[ -n "$PNPM_BIN" ]] || die "PATH 中找不到 pnpm（需要 Node.js 22+）" 1

mkdir -p "$LOG_DIR"
SETUP_LOG="${LOG_DIR}/setup.log"
log "安装依赖，日志：${SETUP_LOG}"
cd "$PROJECT_DIR"
printf '\n===== %s setup %s =====\n' "$APP_NAME" "$(date --iso-8601=seconds)" >>"$SETUP_LOG"

if ! "$PNPM_BIN" install --frozen-lockfile >>"$SETUP_LOG" 2>&1; then
    tail -n 40 "$SETUP_LOG" >&2 || true
    die "依赖安装失败（完整日志：${SETUP_LOG}）" 1
fi

log "依赖已就绪（node_modules/.bin/vite 存在：$([[ -x "${PROJECT_DIR}/node_modules/.bin/vite" ]] && echo 是 || echo 否)）"
