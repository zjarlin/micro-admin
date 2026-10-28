import { describe, expect, it, vi } from 'vitest'
import { createHttpClient } from '@/shared/http'

describe('http client', () => {
  it('adds bearer token and unwraps envelope', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'ok', data: { id: 1 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createHttpClient({ baseUrl: 'https://example.test', getToken: () => 'abc' })
    await expect(client.request('/x')).resolves.toEqual({ id: 1 })
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer abc')
  })

  it('throws readable error for non-zero envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 401, message: '未登录', data: null }), { status: 401 })))
    const client = createHttpClient()
    await expect(client.request('/x')).rejects.toThrow('未登录')
  })
})
