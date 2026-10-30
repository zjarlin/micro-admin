// Vue 完整构建（带运行期模板编译器）：vibeelement 的实时编译依赖它。
//
// 官方类型只覆盖 `vue` 主入口（运行期 + 别名），这里补上 `vue/dist/vue.esm-bundler.js`
// 的声明，让 `compile()` 的类型为「模板字符串 → 渲染函数」。
declare module 'vue/dist/vue.esm-bundler.js' {
  export * from 'vue'

  /** 模板 → 渲染函数；返回的函数接收渲染上下文（`_ctx`）。 */
  export function compile(
    template: string,
    options?: Record<string, unknown>,
  ): (context: Record<string, unknown>) => unknown
}
