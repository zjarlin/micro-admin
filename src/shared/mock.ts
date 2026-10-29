// 浏览器演示后端：只负责「把共享层接到浏览器存储」。
//
// 页面 CRUD 走 `createPageEngine()`，鉴权/工作台/监控走 `createRuntimeApi()`，
// 两者都与 Node 后端共用同一份实现，这里只做 localStorage 与令牌持久化。
import type { HttpClient } from './http'
import { ENGINE_UNHANDLED } from './data/engine'
import { createPagesEngine, resetPagesMock } from './data/pages/mock'
import {
  RUNTIME_UNHANDLED,
  authenticate,
  createRuntimeApi,
  isPublicPath,
  type RuntimeData,
  type RuntimeStore,
} from './runtime/api'
import { UNHANDLED as SCADA_UNHANDLED, handleScadaMock } from './scada/mock-store'

const STORAGE_KEY = 'micro-admin.mock.v2'
const SESSION_KEY = 'micro-admin.token'

function localRuntimeStore(): RuntimeStore {
  return {
    read(): RuntimeData | null {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<RuntimeData>
        if (!Array.isArray(parsed.loginLogs) || !Array.isArray(parsed.operationLogs) || !Array.isArray(parsed.sessions)) {
          return null
        }
        return { loginLogs: parsed.loginLogs, operationLogs: parsed.operationLogs, sessions: parsed.sessions }
      } catch {
        // 损坏的本地演示数据不能阻塞登录，直接回落到种子。
        return null
      }
    },
    write(data: RuntimeData): void {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    },
  }
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

function messageOf(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'message' in data) {
    return String((data as { message: unknown }).message)
  }
  return '请求失败'
}

export function createMockHttpClient(options: { delay?: number } = {}): HttpClient {
  const pages = createPagesEngine()
  const runtime = createRuntimeApi(pages, localRuntimeStore())
  const delayMs = options.delay ?? 160
  let token: string | null = localStorage.getItem(SESSION_KEY)

  const respond = async <T>(value: T): Promise<T> => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return structuredClone(value)
  }

  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const url = new URL(path, location.origin)
      const method = (init.method ?? 'GET').toUpperCase()
      const route = url.pathname
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}

      // 与 Node 后端同一套判定：除登录外的接口都必须带有效令牌。
      if (!isPublicPath(route) && !authenticate(token)) {
        fail(401, '登录已失效，请重新登录')
      }

      const reply = runtime.handle({ method, path: route, body, token, userAgent: navigator.userAgent })
      if (reply !== RUNTIME_UNHANDLED) {
        if (reply.token !== undefined) {
          token = reply.token
          if (token) localStorage.setItem(SESSION_KEY, token)
          else localStorage.removeItem(SESSION_KEY)
        }
        if (reply.status >= 400) fail(reply.status, messageOf(reply.data))
        return respond(reply.data as T)
      }

      // 组态画布的演示后端：契约与 okmy_dics 的 plugins/scada 对齐。
      if (route.startsWith('/scada/')) {
        const scada = handleScadaMock(route, method, url, body)
        if (scada !== SCADA_UNHANDLED) return respond(scada as T)
      }

      // 页面 schema 与全部 CRUD：一份引擎，浏览器与 Node 后端共用。
      const handled = pages.handle({ method, path: route, query: url.searchParams, body })
      if (handled !== ENGINE_UNHANDLED) return respond(handled as T)

      fail(404, `接口不存在：${method} ${route}`)
    },
  }
}

export function resetMockDatabase(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(SESSION_KEY)
  resetPagesMock()
}
