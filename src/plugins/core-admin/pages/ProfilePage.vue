<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from '@/stores/session'
import { initialsOf } from '@/shared/format'

const session = useSessionStore()
const permissions = computed(() => session.permissions)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div><h1>个人中心</h1><p>账号资料与当前会话的权限清单；权限由插件路由和菜单共同消费。</p></div>
    </header>
    <div class="profile-grid">
      <section class="panel profile-card">
        <div class="avatar-large">{{ initialsOf(session.displayName) }}</div>
        <h2>{{ session.displayName }}</h2>
        <p class="muted">{{ session.user?.email }}</p>
        <dl>
          <dt>账号</dt><dd>{{ session.user?.username }}</dd>
          <dt>部门</dt><dd>{{ session.user?.department }}</dd>
          <dt>角色</dt><dd>{{ session.user?.roles.join(' / ') }}</dd>
        </dl>
      </section>
      <section class="panel">
        <div class="panel-title"><h2>权限清单</h2><span>{{ permissions.length }} 项</span></div>
        <div class="permission-list">
          <el-tag v-for="permission in permissions" :key="permission" :type="permission === '*:*:*' ? 'warning' : 'info'" effect="plain">{{ permission }}</el-tag>
        </div>
        <el-alert class="hint" type="info" :closable="false" show-icon title="权限演示" description="admin 拥有通配权限；auditor 只有用户、角色列表与监控只读权限。退出后切换到 auditor 可观察菜单收窄。" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.profile-grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; }
.profile-card { display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 32px; }
.avatar-large { width: 82px; height: 82px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg, #0f172a, #1e3a5f); color: #e2e8f0; font-size: 24px; font-weight: 760; }
.profile-card h2 { margin: 16px 0 4px; font-size: 20px; }
.profile-card p { margin: 0 0 22px; font-size: 13px; }
.profile-card dl { width: 100%; margin: 0; display: grid; grid-template-columns: 64px 1fr; gap: 12px; text-align: left; font-size: 13px; border-top: 1px solid var(--line); padding-top: 20px; }
.profile-card dt { color: var(--muted); }
.profile-card dd { margin: 0; color: var(--app-text); }
.permission-list { display: flex; flex-wrap: wrap; gap: 8px; }
.hint { margin-top: 22px; }
@media (max-width: 900px) { .profile-grid { grid-template-columns: 1fr; } }
</style>
