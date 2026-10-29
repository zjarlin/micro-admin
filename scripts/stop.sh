#!/usr/bin/env bash
# 停止微内核后台。安全 + 幂等：
#   只处理 PID 文件记录、且经「cwd=本项目 + 命令行含 vite/node/pnpm + 启动时间一致」核验的进程；
#   否则拒绝动手。进程不存在时返回 0。
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"
trap on_error ERR

require_tools

acquire_lock

PID="$(pidfile_get || true)"
if [[ -z "$PID" ]]; then
    if [[ -f "$PID_FILE" || -f "$STATE_FILE" ]]; then
        cleanup_stale_files
    fi
    log "未运行（无 PID 文件 ${PID_FILE}）。"
    exit 0
fi

if ! pid_alive "$PID"; then
    log "PID ${PID} 已不存在，清理陈旧记录。"
    cleanup_stale_files
    exit 0
fi

if ! verify_identity "$PID"; then
    # 不做任何 kill：无法证明该 PID 属于本项目。
    printf '[%s] PID %s 身份校验未通过（cwd=%s，cmdline=%s），拒绝停止。\n' \
        "$APP_NAME" "$PID" "$(pid_cwd "$PID")" "$(pid_cmdline "$PID")" >&2
    die "请人工确认 ${PID_FILE} 是否指向本项目进程，确认后可删除该文件再重试" 1
fi

PGID="$(pid_pgid "$PID")"
SID="$(pid_sid "$PID")"
PORT="$(state_get port || true)"
[[ -n "$PORT" ]] || PORT="$(resolve_port)"

# 仅当该 PID 是自建会话的首进程时，才按进程组回收；否则只针对单 PID，避免波及他人。
if [[ "$SID" == "$PID" && "$PGID" == "$PID" && "$PGID" -gt 1 && "$PGID" != "$(pid_pgid $$ || echo 0)" ]]; then
    KILL_TARGET="-$PGID"
    log "停止进程组：PID ${PID}（PGID ${PGID}，端口 ${PORT}）"
else
    KILL_TARGET="$PID"
    warn "PID ${PID} 不是独立会话首进程（PGID ${PGID} / SID ${SID}），仅停止该 PID。"
fi

kill -TERM -- "$KILL_TARGET" 2>/dev/null || true

deadline=$(( $(date +%s) + STOP_TIMEOUT ))
while (( $(date +%s) < deadline )); do
    if ! pid_alive "$PID"; then
        break
    fi
    sleep 0.2
done

if pid_alive "$PID"; then
    warn "PID ${PID} 在 ${STOP_TIMEOUT}s 内未响应 SIGTERM，升级为 SIGKILL。"
    kill -KILL -- "$KILL_TARGET" 2>/dev/null || true
    deadline=$(( $(date +%s) + 10 ))
    while (( $(date +%s) < deadline )); do
        pid_alive "$PID" || break
        sleep 0.2
    done
fi

if pid_alive "$PID"; then
    die "PID ${PID} 仍然存在，停止失败（未清理 PID 文件，便于排查）" 1
fi

cleanup_stale_files

# 端口必须释放；若仍被其他进程占用只告警，说明不是本项目的残留。
deadline=$(( $(date +%s) + 10 ))
while (( $(date +%s) < deadline )) && port_listening "$PORT"; do
    sleep 0.2
done
if port_listening "$PORT"; then
    warn "端口 ${PORT} 仍被占用（非本脚本记录的进程）：$(port_owner "$PORT")"
else
    log "端口 ${PORT} 已释放。"
fi

log "已停止（原 PID ${PID}）。"
exit 0
