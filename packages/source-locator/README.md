# @zjarlin/source-locator

浏览器里点一下元素就知道它在那行源码 —— 类似 Chrome DevTools 的元素检查，但落在生产站点上也成立。

## 为什么不是 sourcemap

sourcemap 只在 DevTools 里有用：它把「压缩后的 JS 位置」映射回源码，但浏览器里你
**拿不到某个 DOM 元素对应哪段 JS**。要回答「这块 DOM 写在哪」，必须在元素自身上留标记。

## 三层

| 入口 | 职责 | 依赖 |
| --- | --- | --- |
| `@zjarlin/source-locator/vite` | 编译期把 `data-source-loc="src/x.vue:12:3"` 写进原生元素；把本地 `.vue` 清单注入 HTML | vite, vue/compiler-core |
| `@zjarlin/source-locator/location` | 纯函数：解析位置、找最近的带标记祖先、从 Vue 实例读组件链 | 无 |
| `@zjarlin/source-locator/browser` | Shadow DOM 覆盖层：悬停高亮 + 点击出卡片（位置/组件链/复制/跳编辑器） | 无 |

## 接入

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { markSourceElements, sourceLocatorPlugin } from '@zjarlin/source-locator/vite'

export default defineConfig({
  plugins: [
    vue({
      // 生产构建默认会把 __file / __vueParentComponent 裁掉，组件链要靠它们。
      // 必须走插件自己的 features 开关：直接 define `__VUE_PROD_DEVTOOLS__`
      // 会被 plugin-vue 的默认值覆盖，产物里根本不会留下这两个属性。
      features: { prodDevtools: true },
      template: { compilerOptions: { nodeTransforms: [markSourceElements()] } },
    }),
    sourceLocatorPlugin(),
  ],
})
```

`features.prodDevtools` 只在**生产构建**下才有区别；开发构建默认保留。

```ts
// 任意宿主代码
import { createSourcePicker } from '@zjarlin/source-locator/browser'

const picker = createSourcePicker({ root: '/abs/project/root', repo: { baseUrl: 'https://github.com/me/repo' } })
// ⌘⇧E / Ctrl⇧E 切换
picker.enable()
picker.onPick?.(...) // 见 SourcePickerOptions
```

## 约定

- 只标 **原生元素**：`<el-button>` 这类组件不标（多根组件会丢属性、属性会透传到第三方 DOM），
  它们的来源由组件链回答。
- 属性值是**仓库内相对路径**，所以生产构建、压缩、分块都不影响；`line:column` 是 1 基。
- 生产构建的 `__file` 只是 basename，`componentChain` 用清单还原目录；同名文件会给出候选而不是猜一个。
