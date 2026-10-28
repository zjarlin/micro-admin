import type { ApiEnvelope } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: number

  constructor(message: string, status: number, code: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface HttpClient {
  request<T>(path: string, init?: RequestInit): Promise<T>
}

export interface HttpClientOptions {
  baseUrl?: string
  getToken?: () => string | null
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const baseUrl = options.baseUrl ?? ''

  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const headers = new Headers(init.headers)
      headers.set('Accept', 'application/json')
      if (init.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }
      const token = options.getToken?.()
      if (token) headers.set('Authorization', `Bearer ${token}`)

      let response: Response
      try {
        response = await fetch(`${baseUrl}${path}`, { ...init, headers })
      } catch {
        throw new ApiError('网络不可达，请检查后端服务或代理配置', 0, 0)
      }

      const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
      if (!response.ok) {
        throw new ApiError(payload?.message ?? `请求失败（HTTP ${response.status}）`, response.status, payload?.code ?? response.status)
      }
      if (!payload || payload.code !== 0) {
        throw new ApiError(payload?.message ?? '响应格式不正确', response.status, payload?.code ?? -1)
      }
      return payload.data
    },
  }
}
