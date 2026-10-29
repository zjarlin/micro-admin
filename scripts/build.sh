#!/usr/bin/env bash
# 生产构建：vue-tsc -b && vite build，产物在 <项目>/dist。
# 日志：<项目>/.run/logs/build.log
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"
trap on_error ERR

PNPM_BIN="$(command -v pnpm || true)"
[[ -n "$PNPM_BIN" ]] || die "PATH 中找不到 pnpm" 1
[[ -x "${PROJECT_DIR}/node_modules/.bin/vite" ]] || die "缺少 node_modules；请先执行 ${SCRIPT_DIR}/setup.sh" 1

mkdir -p "$LOG_DIR"
BUILD_LOG="${LOG_DIR}/build.log"
log "开始构建，日志：${BUILD_LOG}"
cd "$PROJECT_DIR"
printf '\n===== %s build %s =====\n' "$APP_NAME" "$(date --iso-8601=seconds)" >>"$BUILD_LOG"

if ! "$PNPM_BIN" run build >>"$BUILD_LOG" 2>&1; then
    tail -n 40 "$BUILD_LOG" >&2 || true
    die "构建失败（完整日志：${BUILD_LOG}）" 1
fi

log "构建成功：${PROJECT_DIR}/dist（$(du -sh "${PROJECT_DIR}/dist" 2>/dev/null | cut -f1)）"
