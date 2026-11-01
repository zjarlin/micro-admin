// 放行 v-meta:id 的「裸标识符」写法：`v-meta:id="user_query_area"`。
//
// 该表达式只在编译期被 @addzero/permission-meta 的 transform 当字面量读取，运行期不存在，
// 但 Volar 会按普通表达式类型检查组件实例，进而报 TS2339。要恢复严格检查就删掉本文件，
// 并把 id 写成带引号的字符串：`v-meta:id="'user_query_area'"`。
/// <reference types="@addzero/permission-meta/volar" />
