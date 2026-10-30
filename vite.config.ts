import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: env.DEV_HOST || '0.0.0.0',
      port: Number(env.DEV_PORT || 5174),
      // 开发期始终把 /api 转到本地 TS 后端；未配置时按默认端口 5181。
      proxy: {
        '/api': {
          target: env.API_PROXY_TARGET || 'http://127.0.0.1:5181',
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('element-plus') || id.includes('@element-plus')) return 'vendor-element'
            // Vue 的模板编译器单独成块：只有 vibeelement（运行期编译模板）用得到，
            // 留在共享 vendor 里会让每个页面都白下载 ~90KB。
            if (id.includes('@vue/compiler-') || id.includes('vue/dist/vue.esm-bundler')) return 'vendor-vue-compiler'
            if (id.includes('vue-router') || id.includes('/vue/') || id.includes('pinia')) return 'vendor-vue'
            return 'vendor'
          },
        },
      },
    },
  }
})
