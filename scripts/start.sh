#!/usr/bin/env bash
# 启动微内核后台（Vite 开发服务器，默认 0.0.0.0:5174）。
# 幂等：已在运行时只做身份与端口校验，健康即成功，绝不重复拉起。
# 运行期文件：<项目>/.run/{micro-admin.pid,micro-admin.state,micro-admin.lock}、<项目>/.run/logs/dev.log
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)"
# shellcheck source=./lib.sh
source "${SCRIPT_DIR}/lib.sh"
trap on_error ERR

require_tools

SERVE_MODE="${MICRO_ADMIN_SERVE_MODE:-dev}"
case "$SERVE_MODE" in
    dev)     vite_args=(--host 0.0.0.0 --port) ;;
    preview) vite_args=(preview --host 0.0.0.0 --port) ;;
    *)       die "MICRO_ADMIN_SERVE_MODE 只支持 dev / preview，当前：${SERVE_MODE}" 2 ;;
esac

acquire_lock
mkdir -p "$RUN_DIR" "$LOG_DIR"
PORT="$(resolve_port)"

# --- 1) 已在运行？只校验，不重启 -------------------------------------------
if existing_pid="$(pidfile_get)"; then
    if verify_identity "$existing_pid"; then
        recorded_port="$(state_get port || true)"
        if [[ -n "$recorded_port" && "$recorded_port" != "$PORT" ]]; then
            die "已有实例 PID ${existing_pid} 监听端口 ${recorded_port}，与当前期望端口 ${PORT} 不一致；请先执行 stop.sh" 1
        fi
        log "已在运行：PID ${existing_pid}（端口 ${PORT}），不重复启动。"
        if wait_health "$PORT" "$existing_pid"; then
            log "健康检查通过：http://127.0.0.1:${PORT}/ 返回 200"
            exit 0
        fi
        tail_log 30
        die "PID ${existing_pid} 仍在，但端口 ${PORT} 在 ${HEALTH_TIMEOUT}s 内未返回 200；请查看日志或执行 restart.sh" 1
    fi
    log "发现陈旧 PID 记录（PID ${existing_pid} 已不存在或身份不符），清理后继续启动。"
    cleanup_stale_files
fi

# --- 2) 端口必须空闲 -------------------------------------------------------
if port_listening "$PORT"; then
    log "端口 ${PORT} 的监听者：$(port_owner "$PORT")"
    die "端口 ${PORT} 已被其他进程占用，拒绝启动；请改用 MICRO_ADMIN_PORT 或先释放该端口" 1
fi

# --- 3) 依赖检查 -----------------------------------------------------------
[[ -x "${PROJECT_DIR}/node_modules/.bin/vite" ]] \
    || die "缺少 node_modules/.bin/vite；请先执行 ${SCRIPT_DIR}/setup.sh（pnpm install）" 1
if [[ "$SERVE_MODE" == "preview" && ! -f "${PROJECT_DIR}/dist/index.html" ]]; then
    die "preview 模式需要先构建：请执行 ${SCRIPT_DIR}/build.sh" 1
fi

PNPM_BIN="$(command -v pnpm || true)"
[[ -n "$PNPM_BIN" ]] || die "PATH 中找不到 pnpm（需要 Node.js 22+ 与 pnpm）" 1

# --- 4) 拉起（独立会话，便于按进程组安全回收） ----------------------------
cd "$PROJECT_DIR"
rotate_log
printf '\n===== %s start (%s, port %s) %s =====\n' "$APP_NAME" "$SERVE_MODE" "$PORT" "$(date --iso-8601=seconds)" >>"$DEV_LOG"

# 子 shell 把自己的 PID 写入 PID 文件后 exec 目标命令：PID 恒等、进程组可回收，
# 9>&- 让子进程不继承生命周期锁；8>&- 同理，防止从 restart 进来时把它的锁带给常驻进程。
setsid bash -c 'printf "%s\n" "$$" > "$1"; shift; exec "$@"' _ "$PID_FILE" \
    "$PNPM_BIN" exec vite "${vite_args[@]}" "$PORT" --strictPort \
    >>"$DEV_LOG" 2>&1 9>&- 8>&- &

for _ in $(seq 1 50); do
    [[ -s "$PID_FILE" ]] && break
    sleep 0.1
done
[[ -s "$PID_FILE" ]] || die "启动后 5s 内未写出 PID 文件 ${PID_FILE}" 1

PID="$(pidfile_get)"
PGID="$(pid_pgid "$PID")"
SID="$(pid_sid "$PID")"
STARTTIME="$(pid_starttime "$PID")"
state_write "$PID" "$PGID" "$SID" "$STARTTIME" "$PORT"

log "已拉起：PID ${PID} PGID ${PGID} 端口 ${PORT} 模式 ${SERVE_MODE}"
log "日志：${DEV_LOG}"

# --- 5) 等待就绪 -----------------------------------------------------------
if wait_health "$PORT" "$PID"; then
    log "健康检查通过：http://127.0.0.1:${PORT}/ 返回 200"
    exit 0
fi

if ! pid_alive "$PID"; then
    tail_log 40
    cleanup_stale_files
    die "进程启动后立即退出，启动失败（日志见 ${DEV_LOG}）" 1
fi

tail_log 40
die "PID ${PID} 在 ${HEALTH_TIMEOUT}s 内未就绪（端口 ${PORT} 未返回 200）" 1
