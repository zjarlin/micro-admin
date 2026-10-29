#!/usr/bin/env bash
# 只读查看 micro-admin 运行状态、端口占用与最近日志（不启动、不停止、不改文件）。
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"
trap on_error ERR

PORT="$(resolve_port)"
PID="$(pidfile_get || true)"

log "项目目录：${PROJECT_DIR}"
log "运行目录：${RUN_DIR}"
log "监听端口：${PORT}（期望 0.0.0.0:${PORT}）"

if [[ -z "$PID" ]]; then
    log "状态：未运行（无 PID 文件）"
elif ! pid_alive "$PID"; then
    log "状态：未运行（PID 文件记录 ${PID} 已不存在，属陈旧记录）"
elif verify_identity "$PID"; then
    log "状态：运行中 PID ${PID} PGID $(pid_pgid "$PID") 启动时间 $(ps -o lstart= -p "$PID" 2>/dev/null | sed 's/^ *//')"
    log "命令行：$(pid_cmdline "$PID")"
else
    log "状态：PID ${PID} 存在但身份校验不通过（cwd=$(pid_cwd "$PID")）"
fi

log "HTTP 状态码：$(http_code "$PORT")（http://127.0.0.1:${PORT}/）"

if port_listening "$PORT"; then
    log "端口监听：$(port_owner "$PORT")"
else
    log "端口监听：无"
fi

tail_log "${MICRO_ADMIN_LOG_LINES:-40}"
