# @addzero/permission-meta

编译期把 Vue 3 `<script setup>` 项目里所有 `.vue` 的 template AST 扫一遍，产出**树形权限元数据**
`meta-tree.json`，供后台配置「组件 / 区块可见性」；配套一个运行期指令 `v-permission-meta` 按元数据 id
控制节点显隐。**不再手写权限编码**，元数据由模板自己长出来。

- 零运行时开销：`v-meta` 是采集标记，编译后从产物里删干净；`metaId` 以编译期常量写进指令参数，运行期不读任何 DOM 属性。
- 业务组件是黑盒：插件从不打开业务组件自己的 `.vue`，也不展开它内部结构；它作为单个树节点参与。
- 只采 template：不读 script / 不读 JSDoc，不跑运行期 DOM，全部能力收敛在 AST 阶段。

## 三层

| 入口 | 职责 | 依赖 |
| --- | --- | --- |
| `@addzero/permission-meta/vite` | 编译器 transform：采 `v-meta` → 元树；把 `metaId` 静态注入 `v-permission-meta` | vite, vue/compiler-sfc |
| `@addzero/permission-meta/meta` | 纯函数：模板 AST → 元树。无 vite、无 Vue 运行时，可整体搬走 | 无 |
| `@addzero/permission-meta/runtime` | `v-permission-meta` 指令：拿编译期写死的 `metaId` 查授权集合 | vue |

## 标记方案

### 两种写法

```html
<!-- 普通传参：名称 / 描述 / 分组，全部是字面量（不做运行期求值） -->
<div v-meta="{ name: '查询区域', desc: '关键字与筛选', group: 'query' }">…</div>

<!-- 指定稳定固定 id：优先级最高，防止模板增删节点导致 id 漂移 -->
<div v-meta:id="user_query_area">…</div>

<!-- 两者可同时写：id 供权限控制，对象供后台展示 -->
<el-table v-meta:id="result_table" v-meta="{ name: '结果表格', group: 'result' }" />
```

`v-meta:id` 收 `v-meta:id="user_query_area"`（裸标识符）与 `v-meta:id="'page:a:b'"`（含 `:` 时必须加引号）；
其余形态（成员表达式、拼接、模板插值）一律告警，避免「以为是固定 id，其实在跑表达式」。

### 两种场景

```html
<!-- 场景 A：页面内就地区块，不抽组件 -->
<div v-meta="{ name: '查询区域', group: 'query' }">
  <el-input v-model="kw" />
</div>

<!-- 场景 B：独立业务组件，黑盒，只记它自身一个节点 -->
<BizAddBtn v-meta />
```

### 兜底 id（不手写 id 时）

| 来源 | 格式 | 例子 |
| --- | --- | --- |
| 页面就地区块 | `page:文件相对路径:节点索引` | `page:src/views/Order.vue:4` |
| 独立业务 SFC 组件 | `biz:组件相对路径` | `biz:src/components/BizAddBtn.vue` |

- **索引是「文档序」**：按出现顺序数，`v-for` / `v-if` 不额外展开，循环实例复用同一个 `metaId`，权限统一控制。
- **同一业务组件全站共用一个 `biz:` id**：`<BizAddBtn v-meta />` 写在哪一页都一样，后台配一次到处生效。
- 组件解析不到本地来源（全局注册、动态组件、`el-*` 这类基础组件被显式标记）时退回页面就地区块的 `page:` id 并告警。
- 想让 id 不受模板增删影响，就给会漂移的区块手动写 `v-meta:id`——这正是它存在的意义。

### 过滤规则

- **只有写了 `v-meta` 的节点才进元树**，没有 `v-meta` 的节点全部跳过，没有第二种自动采集入口（所以黑名单天然不会「扫进来」）。
- 黑名单前缀 `el-*`、`a-*`（ElementPlus / Antdv）与原生标签（`div`/`span`/`button`/`input`/`p`/`label` …）**默认不采集**。
- **但显式写了 `v-meta` 就允许采集**——这正是「页面就地划分区块」的用法，例如
  `<div v-meta="{ name: '查询区域' }">`。
- **未标记的组件整棵子树都跳过**：`<el-form><el-row><span v-meta/></el-row></el-form>` 里那个 `span`
  不会被孤立成根，因为组件是黑盒，插件不进去翻。

### 业务组件：黑盒，内部标记不外泄

插件会扫**所有** `.vue`，包括 `BizAddBtn.vue` 这种业务组件自己的文件。为防止「组件内部实现」
冒充页面级可配置区块，规则是：

- 只要某个文件**被别的模板当作组件标签使用**（`<BizAddBtn />`，无论有没有写 `v-meta`），
  它就按 **黑盒组件**处理——它自己文件里的 `v-meta` 只作采集标记，**不进 `meta-tree.json`**；
- 真正进元树的，是「**使用**这个组件的那一页」里那个 `biz:` 节点（`tag` 记组件标签、`sourceFile` 记页面）；
- 判据是「被 `.vue` 模板里的组件标签用到」，不是「被谁 import」——所以路由懒加载的页面
  （`() => import('./pages/X.vue')` 写在 `.ts` 里）不算组件，它的区块仍是页面级根；
- `layout` / `App.vue` 这类没有被谁当组件用的文件，照常出根。

结果：**后台看到的每一个可配置区块，都真的属于某个页面**，不会翻出业务组件的内部结构。
若某组件确实希望把自己的内部区块暴露成可配置项，请在**使用它的页面**上标记，而不是在组件内部标记。

### 层级怎么定

一棵树里的下一层，是**最近的标记后代**；中间夹着的原生元素与 `<template>` 是透明的、会被穿透：

```html
<div v-meta="{ name: '顶层' }">
  <section>                                  <!-- 没标记，透明 -->
    <div v-meta="{ name: '子块' }">…</div>    <!-- → 顶层的 children -->
    <span v-meta="{ name: '另一个子块' }" />  <!-- → 顶层的 children -->
  </section>
  <BizAddBtn v-meta />                       <!-- 组件节点，不展开 -->
</div>
```

## 产出

`meta-tree.json`（默认写在项目根，可用 `output` 改）**顶层是根数组**，每个节点结构固定：

```json
[
  {
    "metaId": "page:src/App.vue:0",
    "name": "查询区域",
    "desc": "关键字与筛选条件",
    "group": "query",
    "sourceFile": "src/App.vue",
    "tag": "div",
    "children": [
      {
        "metaId": "biz:src/components/BizAddBtn.vue",
        "name": "",
        "desc": "",
        "group": "",
        "sourceFile": "src/App.vue",
        "tag": "BizAddBtn",
        "children": []
      }
    ]
  }
]
```

- `build` 与 `dev` 启动都会产出；HMR 改动 `.vue` 会即时刷新（不必等浏览器再请求一次）。
- 同一份源码两次构建结果字节一致（按 `sourceFile` 排序），可直接进版本库对账或喂给后台。
- 顶层数组只含**页面级**根：被当作组件使用的文件（黑盒组件内部）整棵剔除，构建日志会打印
  `黑盒组件内部标记不计入元树：…`，便于核对。

## 接入

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { permissionMeta } from '@addzero/permission-meta/vite'

export default defineConfig({
  plugins: [
    // 必须排在 vue() 之前：它要在 configResolved 时改写 vue 的 template.compilerOptions。
    permissionMeta({ output: 'meta-tree.json' }),
    vue(),
  ],
})
```

```ts
// main.ts —— 运行期只提供「当前用户授权 id 列表」
import { createApp } from 'vue'
import { installPermissionMeta } from '@addzero/permission-meta/runtime'
import App from './App.vue'

createApp(App)
  .use({
    install(app) {
      installPermissionMeta(app, { granted: () => session.permissions })
    },
  })
  .mount('#app')
```

```html
<!-- 页面里：metaId 由编译期写死进指令参数，运行期只做一次集合查找 -->
<div v-meta:id="admin_area" v-permission-meta>仅管理员可见</div>

<!-- 也可以就地传授权列表，覆盖全局 -->
<div v-meta:id="auditor_area" v-permission-meta="['auditor_area']">审计可见</div>
```

### 选项

`permissionMeta(options)`：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `output` | `meta-tree.json` | 元数据输出路径，相对项目根 |
| `root` | Vite root | 路径基准 |
| `directories` | `['src', 'packages']` | 采集要扫的顶层目录 |
| `exclude` | — | 额外排除的路径正则（`node_modules` 已默认排除） |
| `log` | `true` | 是否打印每个文件的采集汇总 |

`installPermissionMeta(app, options)`：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `granted` | `[]` | 授权 id 列表，或返回列表的函数（可动态） |
| `superPermission` | `*:*:*` | 命中即全部放行 |
| `wildcard` | `true` | 是否接受通配 `*` |
| `onDenied` | `remove` | 未授权时 `remove`（换注释节点，等价 `v-if=false`）或 `hide`（`display:none`） |

## 边界

- **不改业务组件渲染逻辑**：只对「写了 `v-meta` / `v-permission-meta` 的标签」动手，其它标签一个字符都不碰。
- **不把 ElementPlus 底层组件扫进元树**：`el-*` / `a-*` 默认不采集、不下钻；只有被显式 `v-meta` 时才作为单个节点。
- **不在运行期扫 DOM**：元数据全部在 AST 阶段定稿，运行期只读编译期常量。
- **不读 script**：不解析 JSDoc、装饰器、注释里的任何元信息；组件来源只按静态 `import X from './X.vue'`（含 `./x`、`@/x`、`/src/x` 与项目自定义别名）判定。
- **组件内部不展开**：业务组件只作为一个 `biz:` 节点；组件自己 `.vue` 里的标记不会平铺进元树。
- **`v-meta` 零残留**：编译后被移除，产物里搜不到 `v-meta`，也不会有对应的 `resolveDirective("meta")`。
- **已知限制：<template> 上不能挂 `v-permission-meta`**。Vue 会把 `<template>` 上除 `v-if`/`v-for`/`v-slot`
  之外的指令静默丢弃，插件对这种情况会告警；请把指令移到真正渲染的元素/组件上。
  （纯 `<template v-meta>` 只作元数据分组用，不渲染 DOM，可以正常采集。）

## 本地验证示例

`examples/` 是一个最小可运行工程，把两种场景、`v-meta:id`、`v-if`/`v-for`、黑名单标签显式标记、
以及运行期指令一次演完：

```bash
pnpm --filter @addzero/permission-meta-demo dev     # 或
node node_modules/vite/bin/vite.js --config packages/permission-meta/examples/vite.config.ts
```

构建一次看产物（会在示例目录生成 `meta-tree.json`）：

```bash
pnpm demo:meta
```

## 目录

```
packages/permission-meta/
  src/meta.ts      # 纯逻辑：AST → 元树，字面量解析，黑名单判据
  src/vite.ts      # 编译器 transform + 宿主插件（采集、注入、写文件、HMR）
  src/runtime.ts   # v-permission-meta 指令
  src/index.ts     # 统一出口
  examples/        # 最小可运行示例
```
