import { beforeEach, describe, expect, it } from 'vitest'
import { createMockHttpClient, resetMockDatabase } from '@/shared/mock'

describe('mock api', () => {
  beforeEach(() => resetMockDatabase())

  it('logs in admin and pages users', async () => {
    const http = createMockHttpClient({ delay: 0 })
    const result = await http.request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) })
    expect(result.token).toBe('mock-token-admin')
    const page = await http.request<{ total: number; rows: unknown[] }>('/system/users?page=1&pageSize=5')
    expect(page.total).toBeGreaterThan(5)
    expect(page.rows).toHaveLength(5)
  })

  it('returns reduced permissions for auditor', async () => {
    const http = createMockHttpClient({ delay: 0 })
    const result = await http.request<{ user: { permissions: string[] } }>('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'auditor', password: 'audit123' }) })
    expect(result.user.permissions).toContain('system:user:list')
    expect(result.user.permissions).not.toContain('system:user:add')
  })

  it('rejects bad password', async () => {
    const http = createMockHttpClient({ delay: 0 })
    await expect(http.request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'x' }) })).rejects.toThrow('账号或密码错误')
  })

  it('prevents deleting built-in admin', async () => {
    const http = createMockHttpClient({ delay: 0 })
    await http.request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) })
    await expect(http.request('/system/users/1', { method: 'DELETE' })).rejects.toThrow('内置管理员不可删除')
  })
})
