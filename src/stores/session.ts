import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http } from '@/shared/api'
import type { LoginPayload, LoginResult, SessionUser } from '@/shared/types'
import { hasPermission } from '@/kernel/permission'

const TOKEN_KEY = 'micro-admin.token'

export const useSessionStore = defineStore('session', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const user = ref<SessionUser | null>(null)
  const loading = ref(false)
  const initialized = ref(false)

  const isAuthenticated = computed(() => token.value !== null)
  const displayName = computed(() => user.value?.nickname ?? user.value?.username ?? '未登录')
  const permissions = computed(() => user.value?.permissions ?? [])

  function setSession(result: LoginResult): void {
    token.value = result.token
    user.value = result.user
    localStorage.setItem(TOKEN_KEY, result.token)
  }

  async function login(payload: LoginPayload): Promise<void> {
    loading.value = true
    try {
      const result = await http.request<LoginResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setSession(result)
      initialized.value = true
    } finally {
      loading.value = false
    }
  }

  async function restore(): Promise<void> {
    if (initialized.value || !token.value) return
    loading.value = true
    try {
      user.value = await http.request<SessionUser>('/auth/profile')
      initialized.value = true
    } catch (error) {
      token.value = null
      localStorage.removeItem(TOKEN_KEY)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function logout(): Promise<void> {
    try {
      if (token.value) await http.request<void>('/auth/logout', { method: 'POST' })
    } finally {
      token.value = null
      user.value = null
      initialized.value = false
      localStorage.removeItem(TOKEN_KEY)
    }
  }

  function can(permission?: string): boolean {
    return hasPermission(permissions.value, permission)
  }

  return {
    token,
    user,
    loading,
    initialized,
    isAuthenticated,
    displayName,
    permissions,
    login,
    logout,
    restore,
    can,
  }
})
