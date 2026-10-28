<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import { useSessionStore } from '@/stores/session'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()
const formRef = ref<FormInstance>()
const form = reactive({ username: 'admin', password: 'admin123' })
const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    await session.login(form)
    ElMessage.success(`欢迎回来，${session.displayName}`)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败')
  }
}

function fill(username: string, password: string): void {
  form.username = username
  form.password = password
}
</script>

<template>
  <main class="login-page">
    <section class="login-brand">
      <div class="brand-mark">MA</div>
      <p class="eyebrow">MICROKERNEL ADMIN</p>
      <h1>可组装的后台内核</h1>
      <p class="brand-copy">登录、权限、菜单与页面均由插件声明，宿主只负责生命周期。像搭积木一样扩展业务，同时保留若依式的管理体验。</p>
      <ul class="brand-points">
        <li><span>01</span> 依赖拓扑决定插件启动顺序</li>
        <li><span>02</span> 槽位扩展不改宿主页面</li>
        <li><span>03</span> 权限同时约束路由与菜单</li>
      </ul>
      <div class="brand-foot">Vue 3 · Vite · TypeScript · Element Plus</div>
    </section>
    <section class="login-panel">
      <div class="login-card">
        <div class="login-heading">
          <span class="eyebrow">SIGN IN</span>
          <h2>登录控制台</h2>
          <p>使用内置演示账号快速体验不同权限视图。</p>
        </div>
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @keyup.enter="submit">
          <el-form-item label="账号" prop="username">
            <el-input v-model="form.username" size="large" placeholder="请输入账号" :prefix-icon="User" autocomplete="username" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" type="password" show-password size="large" placeholder="请输入密码" :prefix-icon="Lock" autocomplete="current-password" />
          </el-form-item>
          <el-button class="login-button" type="primary" size="large" :loading="session.loading" @click="submit">进入系统</el-button>
        </el-form>
        <div class="demo-accounts">
          <button type="button" @click="fill('admin', 'admin123')"><strong>admin</strong><span>全部权限</span></button>
          <button type="button" @click="fill('auditor', 'audit123')"><strong>auditor</strong><span>只读审计</span></button>
        </div>
      </div>
      <p class="login-tip">演示数据保存在浏览器 localStorage，可随时清空。</p>
    </section>
  </main>
</template>

<style scoped>
.login-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(420px, .85fr); background: #0b1220; }
.login-brand { position: relative; padding: 8vh 7vw; color: #e5e7eb; overflow: hidden; display: flex; flex-direction: column; }
.login-brand::before { content: ''; position: absolute; inset: -30% 20% 30% -20%; background: radial-gradient(circle, rgba(59,130,246,.32), transparent 62%); }
.login-brand::after { content: ''; position: absolute; width: 460px; height: 460px; right: -160px; bottom: -180px; border: 1px solid rgba(148,163,184,.22); border-radius: 50%; box-shadow: 0 0 0 70px rgba(148,163,184,.05), 0 0 0 140px rgba(148,163,184,.03); }
.brand-mark { width: 58px; height: 58px; border-radius: 16px; display: grid; place-items: center; background: linear-gradient(135deg, #3b82f6, #22d3ee); color: #06121f; font-weight: 900; letter-spacing: .04em; }
.eyebrow { margin: 28px 0 0; font-size: 11px; letter-spacing: .24em; color: #93c5fd; font-weight: 700; }
h1 { font-size: clamp(40px, 5vw, 66px); line-height: 1.12; margin: 18px 0 22px; letter-spacing: -.03em; max-width: 12ch; }
.brand-copy { max-width: 46ch; color: #a9b4c6; line-height: 1.9; font-size: 15px; }
.brand-points { list-style: none; padding: 0; margin: 40px 0 0; display: grid; gap: 14px; }
.brand-points li { display: flex; gap: 14px; align-items: center; color: #dbe4f2; }
.brand-points span { font-variant-numeric: tabular-nums; color: #22d3ee; font-size: 12px; letter-spacing: .08em; }
.brand-foot { margin-top: auto; padding-top: 56px; color: #64748b; font-size: 12px; letter-spacing: .08em; }
.login-panel { background: #f6f8fb; display: flex; flex-direction: column; justify-content: center; padding: 6vh 6vw; }
.login-card { width: 100%; max-width: 420px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 24px; box-shadow: 0 28px 80px rgba(15,23,42,.12); border: 1px solid #e6ebf2; }
.login-heading { margin-bottom: 28px; }
.login-heading .eyebrow { color: #2563eb; margin: 0; }
.login-heading h2 { margin: 10px 0 8px; color: #0f172a; font-size: 30px; letter-spacing: -.02em; }
.login-heading p { margin: 0; color: #64748b; font-size: 14px; }
.login-button { width: 100%; margin-top: 8px; height: 46px; border-radius: 10px; font-weight: 600; }
.demo-accounts { margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.demo-accounts button { border: 1px dashed #cbd5e1; background: #f8fafc; border-radius: 10px; padding: 10px 12px; text-align: left; cursor: pointer; transition: .2s ease; }
.demo-accounts button:hover { border-color: #3b82f6; background: #eff6ff; }
.demo-accounts strong { display: block; color: #0f172a; font-size: 13px; }
.demo-accounts span { color: #64748b; font-size: 12px; }
.login-tip { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 18px; }
@media (max-width: 900px) { .login-page { grid-template-columns: 1fr; } .login-brand { padding: 48px 28px; } .brand-copy, .brand-points { display: none; } .login-panel { padding: 32px 20px 56px; } .login-card { padding: 28px; } }
</style>
