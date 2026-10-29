#!/usr/bin/env bash
# micro-admin 运行期公共库：目录解析、PID/端口/进程身份判定、锁与健康检查。
# 被 start/restart/stop/logs 等脚本 source；只提供函数，不做任何有副作用的事。
# 依赖：bash 4+（运行时在 okm182 Linux 上执行）、ss、curl、flock。

# ---------------------------------------------------------------------------
# 目录与文件（全部基于脚本自身位置推导，不依赖调用者 cwd）
# ---------------------------------------------------------------------------
LIB_DIR="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)"
PROJECT_DIR="$(cd -- "${LIB_DIR}/.." && pwd -P)"
APP_NAME="micro-admin"

RUN_DIR="${MICRO_ADMIN_RUN_DIR:-${PROJECT_DIR}/.run}"
LOG_DIR="${RUN_DIR}/logs"
PID_FILE="${RUN_DIR}/${APP_NAME}.pid"
STATE_FILE="${RUN_DIR}/${APP_NAME}.state"
LOCK_FILE="${RUN_DIR}/${APP_NAME}.lock"
DEV_LOG="${LOG_DIR}/dev.log"
SERVE_MODE="${MICRO_ADMIN_SERVE_MODE:-dev}"
LOCK_TIMEOUT="${MICRO_ADMIN_LOCK_TIMEOUT:-30}"
HEALTH_TIMEOUT="${MICRO_ADMIN_HEALTH_TIMEOUT:-90}"
STOP_TIMEOUT="${MICRO_ADMIN_STOP_TIMEOUT:-20}"

# ---------------------------------------------------------------------------
# 输出
# ---------------------------------------------------------------------------
log()  { printf '[%s] %s\n' "$APP_NAME" "$*"; }
warn() { printf '[%s] 警告：%s\n' "$APP_NAME" "$*" >&2; }
die()  { local msg="$1" code="${2:-1}"; printf '[%s] 失败：%s\n' "$APP_NAME" "$msg" >&2; exit "$code"; }

on_error() {
    local code=$?
    printf '[%s] 失败：第 %s 行命令退出码 %s\n' "$APP_NAME" "${BASH_LINENO[0]:-?}" "$code" >&2
    exit "$code"
}

# ---------------------------------------------------------------------------
# 端口解析：显式变量 > .env.local > .env > 5174（与 vite.config.ts 默认一致）
# 不 source 环境文件，避免执行其中的任意代码。
# ---------------------------------------------------------------------------
read_env_port() {
    local f="$1" v
    [[ -f "$f" ]] || return 1
    v="$(sed -n 's/^[[:space:]]*DEV_PORT[[:space:]]*=[[:space:]]*//p' "$f" | tail -n 1 | tr -d "\"'[:space:]")"
    [[ -n "$v" ]] || return 1
    printf '%s' "$v"
}

resolve_port() {
    if [[ -n "${MICRO_ADMIN_PORT:-}" ]]; then
        printf '%s' "$MICRO_ADMIN_PORT"
        return 0
    fi
    local v
    v="$(read_env_port "${PROJECT_DIR}/.env.local" || true)"
    [[ -n "$v" ]] || v="$(read_env_port "${PROJECT_DIR}/.env" || true)"
    [[ -n "$v" ]] || v=5174
    printf '%s' "$v"
}

# ---------------------------------------------------------------------------
# 进程状态读取（只读 /proc，失败返回非 0）
# ---------------------------------------------------------------------------
pid_alive() {
    local pid="$1"
    [[ -n "$pid" ]] || return 1
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    [[ "$pid" -gt 1 ]] || return 1
    # 僵尸进程不算存活
    local st
    st="$(awk '{print $3}' "/proc/${pid}/stat" 2>/dev/null || true)"
    [[ "$st" == "Z" ]] && return 1
    kill -0 "$pid" 2>/dev/null
}

# /proc/<pid>/stat 第 N 字段（comm 可能含空格/括号，先截掉到最后一个 ')'）
pid_stat_field() {
    local pid="$1" want="$2"
    # 在 ')' 之后，字段编号整体前移 2
    awk -v w="$want" '{ sub(/^[^)]*\) /, ""); print $((w - 2)) }' "/proc/${pid}/stat" 2>/dev/null
}

pid_starttime() { pid_stat_field "$1" 22; }
pid_pgid()      { pid_stat_field "$1" 5;  }
pid_sid()       { pid_stat_field "$1" 6;  }
pid_cwd()       { readlink "/proc/$1/cwd" 2>/dev/null || true; }
pid_cmdline()   { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || true; }

# ---------------------------------------------------------------------------
# 端口
# ---------------------------------------------------------------------------
port_listening() {
    local port="$1"
    ss -ltnH 2>/dev/null | awk -v p="$port" '{ n = split($4, a, ":"); if (a[n] == p) f = 1 } END { exit f ? 0 : 1 }'
}

port_owner() {
    local port="$1"
    ss -ltnpH 2>/dev/null | awk -v p="$port" '{ n = split($4, a, ":"); if (a[n] == p) print $0 }'
}

# ---------------------------------------------------------------------------
# 状态文件（key=value）
# ---------------------------------------------------------------------------
pidfile_get() {
    [[ -s "$PID_FILE" ]] || return 1
    tr -d '[:space:]' < "$PID_FILE"
}

pidfile_write() {
    printf '%s\n' "$1" > "$PID_FILE"
}

state_get() {
    local key="$1"
    [[ -s "$STATE_FILE" ]] || return 1
    sed -n "s/^${key}=//p" "$STATE_FILE" | tail -n 1
}

state_write() {
    # $1=pid $2=pgid $3=sid $4=starttime $5=port
    mkdir -p "$RUN_DIR"
    cat > "$STATE_FILE" <<EOF
pid=$1
pgid=$2
sid=$3
starttime=$4
port=$5
mode=${SERVE_MODE}
project=${PROJECT_DIR}
log=${DEV_LOG}
started_at=$(date --iso-8601=seconds)
EOF
}

cleanup_stale_files() {
    rm -f "$PID_FILE" "$STATE_FILE"
}

# ---------------------------------------------------------------------------
# 进程身份校验：只认「cwd 是本项目 + 命令行像 vite/pnpm + 启动时间与记录一致」
# ---------------------------------------------------------------------------
verify_identity() {
    local pid="$1"
    pid_alive "$pid" || return 1

    local cwd
    cwd="$(pid_cwd "$pid")"
    [[ "$cwd" == "$PROJECT_DIR" ]] || return 1

    local cmd
    cmd="$(pid_cmdline "$pid")"
    [[ "$cmd" == *vite* || "$cmd" == *pnpm* || "$cmd" == *node* ]] || return 1

    local recorded
    recorded="$(state_get starttime || true)"
    if [[ -n "$recorded" ]]; then
        [[ "$(pid_starttime "$pid")" == "$recorded" ]] || return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# 锁：同一时刻只允许一个生命周期动作
# ---------------------------------------------------------------------------
acquire_lock() {
    mkdir -p "$RUN_DIR" "$LOG_DIR"
    exec 9>"$LOCK_FILE"
    if ! flock -w "$LOCK_TIMEOUT" 9; then
        die "另一个 ${APP_NAME} 生命周期操作正在进行（锁 ${LOCK_FILE}），${LOCK_TIMEOUT}s 内未释放" 3
    fi
}

# ---------------------------------------------------------------------------
# 健康检查：HTTP 200 即视为可用
# ---------------------------------------------------------------------------
http_code() {
    local port="$1"
    curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:${port}/" 2>/dev/null || true
}

wait_health() {
    local port="$1" pid="${2:-}" deadline code
    deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
    while (( $(date +%s) < deadline )); do
        if [[ -n "$pid" ]] && ! pid_alive "$pid"; then
            return 2   # 进程已退出
        fi
        code="$(http_code "$port")"
        if [[ "$code" == "200" ]]; then
            return 0
        fi
        sleep 1
    done
    return 1
}

tail_log() {
    local lines="${1:-40}"
    [[ -f "$DEV_LOG" ]] || return 0
    printf '[%s] 最近 %s 行日志（%s）：\n' "$APP_NAME" "$lines" "$DEV_LOG" >&2
    tail -n "$lines" "$DEV_LOG" >&2 || true
}

rotate_log() {
    [[ -f "$DEV_LOG" ]] || return 0
    local size
    size=$(stat -c '%s' "$DEV_LOG" 2>/dev/null || echo 0)
    if (( size > 20 * 1024 * 1024 )); then
        mv -f "$DEV_LOG" "${DEV_LOG}.1"
        log "日志已轮转：${DEV_LOG} -> ${DEV_LOG}.1"
    fi
}

require_tools() {
    local t
    for t in curl ss flock; do
        command -v "$t" >/dev/null 2>&1 || die "缺少依赖命令：$t"
    done
}
