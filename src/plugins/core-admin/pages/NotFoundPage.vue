<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="not-found">
    <p class="code">404</p>
    <h1>页面没有注册到内核</h1>
    <p>可能对应插件已停用，或当前角色没有该页面的权限。</p>
    <el-button type="primary" @click="router.replace('/dashboard')">返回工作台</el-button>
  </div>
</template>

<style scoped>
.not-found { min-height: 54vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; }
.code { margin: 0; font-size: 80px; font-weight: 900; letter-spacing: -.06em; color: #cbd5e1; line-height: 1; }
h1 { margin: 0; font-size: 22px; color: var(--app-text); }
p:not(.code) { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
</style>
