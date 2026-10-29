// 宿主 HTTP 客户端：只有一个实现，不再有 mock 分支。
//
// 浏览器开发时由 Vite 代理把 `/api` 转发到 `server/`（见 vite.config.ts 的 API_PROXY_TARGET），
// 生产由同一个进程托管前端产物，因此路径始终同源。
import { createHttpClient } from './http'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api'

export const http = createHttpClient({
  baseUrl,
  getToken: () => localStorage.getItem('micro-admin.token'),
})
