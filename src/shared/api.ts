import { createHttpClient } from './http'
import { createMockHttpClient } from './mock'

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
const useMock = (import.meta.env.VITE_API_MODE as string | undefined) !== 'http'

export const http = useMock
  ? createMockHttpClient()
  : createHttpClient({
      baseUrl,
      getToken: () => localStorage.getItem('micro-admin.token'),
    })

export const apiMode = useMock ? 'mock' : 'http'
