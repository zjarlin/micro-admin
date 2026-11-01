// vue-tsc 用的可选类型补丁（按需引入，默认不生效）。
//
// 背景：`v-meta:id="user_query_area"` 这种「裸标识符」写法在构建期完全没问题——
// 编译器 transform 直接把它当字面量读，运行期根本不取值。但 `vue-tsc` / Volar 会把它
// 当普通表达式对组件实例做类型检查，于是报 TS2339（属性不存在）。
//
// 两种解法，按项目取舍：
// 1）写带引号的字符串：`v-meta:id="'user_query_area'"`——类型安全，推荐给 TS 项目。
// 2）引入本文件放行裸标识符：在项目的 .d.ts 里加
//    `/// <reference types="@addzero/permission-meta/volar" />`。
//    代价：组件实例上的任意未知属性都变成 unknown，会掩盖其它笔误，慎用。
import 'vue'

declare module 'vue' {
  interface ComponentCustomProperties {
    /** v-meta:id 的裸标识符写法：只给编译期采集读，运行期不存在。 */
    [permissionMetaId: string]: unknown
  }
}
