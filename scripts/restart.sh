#!/usr/bin/env bash
# 重启微内核后台：严格「先停稳，再启动」。stop 失败或旧进程/旧端口未释放时立即失败，
# 不会在没有确认旧实例退出的情况下并行拉起第二个实例。
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"
trap on_error ERR

require_tools
mkdir -p "$RUN_DIR" "$LOG_DIR"

# 编排锁：只串行化 restart 本身；stop.sh / start.sh 各自持有自己的生命周期锁，故不在此占用同名锁。
exec 8>"${RUN_DIR}/${APP_NAME}.restart.lock"
flock -w "$LOCK_TIMEOUT" 8 || die "另一个 restart 正在进行（锁 ${RUN_DIR}/${APP_NAME}.restart.lock）" 3

OLD_PID="$(pidfile_get || true)"
OLD_PORT="$(state_get port || true)"
[[ -n "$OLD_PORT" ]] || OLD_PORT="$(resolve_port)"

log "== 第一步：停止（当前 PID=${OLD_PID:-无}，端口 ${OLD_PORT}）=="
# 8>&- ：子脚本与它拉起的常驻进程不得继承 restart 锁，
# 否则 restart 结束后锁仍被 vite/node 持有，下一次 restart 会永久报「正在进行」。
if ! bash "${SCRIPT_DIR}/stop.sh" 8>&-; then
    die "stop.sh 执行失败，已中止 restart（不会启动新实例）" 1
fi

# 复核：旧进程必须真的消失，端口必须不再由旧实例持有。
if [[ -n "$OLD_PID" ]] && pid_alive "$OLD_PID"; then
    die "旧进程 PID ${OLD_PID} 仍未退出，已中止 restart" 1
fi
if port_listening "$OLD_PORT"; then
    log "端口 ${OLD_PORT} 仍被其他进程占用：$(port_owner "$OLD_PORT")"
    die "端口 ${OLD_PORT} 未释放，已中止 restart（不会启动新实例）" 1
fi

log "== 第二步：启动 =="
if ! bash "${SCRIPT_DIR}/start.sh" 8>&-; then
    die "start.sh 执行失败，restart 未完成" 1
fi

NEW_PID="$(pidfile_get || true)"
NEW_PORT="$(state_get port || true)"
log "restart 完成：PID ${OLD_PID:-无} -> ${NEW_PID:-未知}，端口 ${NEW_PORT:-$OLD_PORT}"
[ -n "$NEW_PID" ] || die "restart 结束后未读到新 PID" 1
exit 0
