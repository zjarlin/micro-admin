import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { pluginCatalog } from './build/plugin-catalog'

export default defineConfig({
  plugins: [vue(), pluginCatalog(process.env.VITE_PLUGIN_PROFILE)],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
    // 默认 forks 池在本机启动慢且偶发超时；threads 更快也足够隔离。
    pool: 'threads',
  },
})
