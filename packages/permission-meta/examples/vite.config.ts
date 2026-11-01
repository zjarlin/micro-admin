// 示例的 Vite 配置：permissionMeta() 必须排在 vue() 之前（它要改写 vue 的 compilerOptions）。
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { permissionMeta } from '@addzero/permission-meta/vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // 让构建从示例目录的 index.html 起步，产物落在示例自己的 dist。
  build: { outDir: 'dist', emptyOutDir: true },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    // 采集 v-meta → meta-tree.json；把 metaId 静态注入 v-permission-meta。
    permissionMeta({ output: 'meta-tree.json' }),
    vue(),
  ],
})
