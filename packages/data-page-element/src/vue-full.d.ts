// Vue 完整构建（带运行期模板编译器）：活元素的实时编译依赖它。
//
// 官方类型只覆盖 `vue` 主入口，这里补上深层入口的声明，使 `compile()` 的类型为
// 「模板字符串 → 渲染函数」。与宿主应用里的同名声明合并，不冲突。
declare module 'vue/dist/vue.esm-bundler.js' {
  /** 模板 → 渲染函数；返回的函数接收渲染上下文（`_ctx`）。 */
  export function compile(
    template: string,
    options?: Record<string, unknown>,
  ): (context: Record<string, unknown>) => unknown
}
