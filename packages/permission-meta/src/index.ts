// 编译期采集元树 + 运行期按 metaId 控制可见性。
//
// 三层各管一件事，互不耦合：
// - `vite`：扫描 template AST，v-meta → meta-tree.json；metaId 静态注入 v-permission-meta；
// - `meta`：纯函数层（AST → 元树），不依赖 vite / Vue 运行时，可整体搬走；
// - `runtime`：v-permission-meta 指令，只读编译期写死的 metaId 参数，零 DOM 属性解析。
export {
  META_DIRECTIVE,
  PERMISSION_META_DIRECTIVE,
  BASIC_COMPONENT_PREFIXES,
  BASIC_NATIVE_TAGS,
  NodeType,
  TagType,
  buildMetaTree,
  collectComponentFiles,
  mergeRoots,
  isBasicComponent,
  isBasicNativeTag,
  isComponentTag,
  isTemplateTag,
  locKey,
  pageMetaId,
  bizMetaId,
  readIdLiteral,
  readLiteral,
  readObjectLiteral,
  walkMarked,
} from './meta.ts'
export type {
  AstNode,
  AstProp,
  FileRoots,
  MarkedHit,
  MarkedNodePlan,
  MergedRoots,
  MetaBuild,
  MetaBuildOptions,
  MetaNode,
} from './meta.ts'
export { collectVueFiles, markPermissionMeta, permissionMeta } from './vite.ts'
export type { PermissionMetaOptions, TemplateNodeTransform } from './vite.ts'
export { createPermissionMetaDirective, decide, installPermissionMeta, peekMetaId } from './runtime.ts'
export type {
  DirectiveValue,
  GrantedSource,
  PermissionDecision,
  PermissionMetaRuntimeOptions,
} from './runtime.ts'
