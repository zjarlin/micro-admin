// 通用页面层的门面：契约、引擎、状态机与传输端口。
//
// 这个包不 import Vue 之外的任何东西，也不认识 Element Plus / DOM / Node，
// 因此同一份实现可以给浏览器 mock、Node 服务、桌面壳共用。
export type {
  ActionKind,
  ActionSchema,
  CellKind,
  ColumnSchema,
  Condition,
  CrudPageSchema,
  FieldControl,
  FieldOption,
  FieldSchema,
  QuerySchema,
  Row,
  TagStyle,
  TagTone,
  TreeSchema,
  ValidationRule,
  VibeBindingSchema,
  VibeSchema,
} from './schema.ts'
export { interpolate, matchCondition } from './schema.ts'

export { vibeEventChannels, vibeHandlerName, vibeScopeData, vibeSourceKey } from './vibe.ts'

export type {
  PageRegistry,
  SchemaStateStore,
  StoredRegistryOptions,
  StoredSchemaState,
} from './registry.ts'
export { createStaticRegistry, createStoredRegistry } from './registry.ts'

export type {
  EngineRequest,
  PageData,
  PageEngine,
  PageEngineOptions,
  PageSchemaPayload,
  PageStore,
} from './engine.ts'
export { ENGINE_UNHANDLED, EngineError, createPageEngine } from './engine.ts'

export type { FieldIssue } from './validate.ts'
export { validateRow } from './validate.ts'

export type { NormalizedRule } from './rules.ts'
export { emptyForm, isRequired, pickForm, rulesOf } from './rules.ts'

export type { TreeNode } from './tree.ts'
export { buildTree, filterTree, flattenTree, pathToNode } from './tree.ts'

export type { DataTransport, PageQuery, PageResult } from './transport.ts'
export { transportOf } from './transport.ts'

export { DATA_TRANSPORT_KEY, provideDataTransport, useDataTransport } from './context.ts'

export type { PageSchemaResponse, SchemaClient, SchemaClientOptions } from './schema-client.ts'
export { createSchemaClient } from './schema-client.ts'

export type { PageState } from './usePage.ts'
export { initialFilters, usePage } from './usePage.ts'

export type { TreeState } from './useTree.ts'
export { useTree } from './useTree.ts'

export type { FormDialogOptions, FormDialogState } from './useFormDialog.ts'
export { useFormDialog } from './useFormDialog.ts'

export type { ActionContext, Notifier, ResolvedAction } from './useActions.ts'
export { defaultActions, resolveActions } from './useActions.ts'

export type { ReferenceState } from './useReferences.ts'
export { useReferences } from './useReferences.ts'

export { formatDateTime, formatPercent } from './format.ts'

// 运行期形状与接口：登录、会话、工作台、监控观测。
// 与 schema 驱动的 CRUD 分开，但同样前后端共用一份实现。
export type {
  ApiEnvelope,
  CacheEntry,
  LoginLog,
  LoginPayload,
  LoginResult,
  OnlineSession,
  OperationLog,
  ServerMetric,
  SessionUser,
} from './runtime-types.ts'
export type { RuntimeApi, RuntimeData, RuntimeReply, RuntimeRequest, RuntimeStore } from './runtime-api.ts'
export {
  ADMIN,
  AUDITOR,
  RUNTIME_UNHANDLED,
  SCHEMA_WRITE_PERMISSION,
  authenticate,
  canWriteSchema,
  createRuntimeApi,
  isPublicPath,
  seedRuntime,
} from './runtime-api.ts'
