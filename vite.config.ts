import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import { permissionMeta } from '@addzero/permission-meta/vite'
import { markSourceElements, sourceLocatorPlugin } from '@addzero/source-locator/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      // 采集 v-meta → meta-tree.json，并把 metaId 静态注入 v-permission-meta。
      // 必须排在 vue() 之前：它要在 configResolved 时改写 vue 的 template.compilerOptions。
      permissionMeta({ exclude: /[\\/]packages[\\/][^\\/]+[\\/]examples[\\/]/ }),
      vue({
        // 拾取器要在浏览器里回答「这块 DOM 属于哪个组件」，这依赖 Vue 的
        // `__vueParentComponent` 与 `__file`——生产构建默认会把它们裁掉。
        // 必须走插件自己的 features 开关：直接 define `__VUE_PROD_DEVTOOLS__`
        // 会被 plugin-vue 的默认值覆盖，产物里根本不会留下那两个属性。
        features: { prodDevtools: true },
        template: {
          // 编译期把 data-source-loc="src/x.vue:12:3" 写进每个原生元素；
          // 行列指向原文件真实位置，sourcemap 不因此偏移。
          compilerOptions: { nodeTransforms: [markSourceElements()] },
        },
      }),
      sourceLocatorPlugin(),
    ],
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
            // 页面助手按需加载：不要并进 vendor，否则 500 kB 又回到首屏。
            if (id.includes('page-agent')) return undefined
            if (id.includes('element-plus') || id.includes('@element-plus')) return 'vendor-element'
            // Vue 的模板编译器单独成块：只有 vibeelement（运行期编译模板）用得到，
            // 留在共享 vendor 里会让每个页面都白下载一遍。
            if (id.includes('@vue/compiler-') || id.includes('vue/dist/vue.esm-bundler')) return 'vendor-vue-compiler'
            if (id.includes('vue-router') || id.includes('/vue/') || id.includes('pinia')) return 'vendor-vue'
            return 'vendor'
          },
        },
      },
    },
  }
})
