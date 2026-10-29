#!/usr/bin/env bash
# 全量校验：pnpm verify = typecheck + 单元测试 + 构建。
# 日志：<项目>/.run/logs/verify.log
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"
trap on_error ERR

PNPM_BIN="$(command -v pnpm || true)"
[[ -n "$PNPM_BIN" ]] || die "PATH 中找不到 pnpm" 1
[[ -x "${PROJECT_DIR}/node_modules/.bin/vite" ]] || die "缺少 node_modules；请先执行 ${SCRIPT_DIR}/setup.sh" 1

mkdir -p "$LOG_DIR"
VERIFY_LOG="${LOG_DIR}/verify.log"
log "开始校验（typecheck + test + build），日志：${VERIFY_LOG}"
cd "$PROJECT_DIR"
printf '\n===== %s verify %s =====\n' "$APP_NAME" "$(date --iso-8601=seconds)" >>"$VERIFY_LOG"

if ! "$PNPM_BIN" run verify >>"$VERIFY_LOG" 2>&1; then
    tail -n 60 "$VERIFY_LOG" >&2 || true
    die "校验失败（完整日志：${VERIFY_LOG}）" 1
fi

log "校验通过（typecheck + test + build）。"
