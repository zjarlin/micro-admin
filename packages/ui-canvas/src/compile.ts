// 图纸 → 页面：编译器主体。
//
// 这一层不猜语义、也不偷偷补齐：能编译的就编译，看不懂的落成诊断，
// 需要外部信息的落成 `questions`（只发缺的字段，不发整份图纸）。
//
// 输出与 `CrudPageSchema` 同构，因此发布就是 `PUT /ui/pages/{key}`，
// 前端不需要为「图纸页」发版——这正是「画完即上线」的全部含义。

import type {
  ActionSchema,
  ColumnSchema,
  CrudPageSchema,
  FieldSchema,
  QuerySchema,
} from '@zjarlin/data-page/schema'
import type {
  UiCompiledPage,
  UiDiagnostic,
  UiDrawing,
  UiDrawingAnalysis,
  UiElement,
  UiQuestion,
  UiRegion,
  UiRole,
} from './types.ts'
import { effectiveProps, specOf } from './roles.ts'
import {
  columnWidthOf,
  elementsOfRole,
  findElement,
  leavesOf,
  regionsOf,
  spanOf,
} from './layout.ts'

/** 需要页面形态扩展才能表达的富内容角色（当前编译会跳过并提示）。 */
const EXTENSION_ROLES: ReadonlyArray<UiRole> = ['chart', 'stat', 'detail', 'tabs']

/**
 * 页面级动作规则表：工具条上的按钮「编译成什么」。
 *
 * 关键区别：`CrudPageSchema.actions` 在现有页面壳里**只渲染成行操作列**，
 * 所以页面级按钮绝不能塞进 `actions` —— 否则「新增」「导出」会变成每行一个按钮。
 * 因此这里把页面级按钮映射到它们真正的落点：
 * - 新增 → schema 有 `fields` 时壳自动出「新增{entity}」按钮，无需声明；
 * - 导出 → `exportable: true`；
 * - 其余 → 当前形态没有槽位，落成诊断（不猜、不硬塞）。
 */
interface PageActionMatch {
  code: string
  kind: 'create' | 'export'
}
function matchPageAction(element: UiElement): PageActionMatch | null {
  const props = effectiveProps(element)
  const kind = props.kind ?? 'request'
  if (kind === 'create') return { code: 'page-create', kind: 'create' }
  const label = String(props.label ?? element.text ?? '')
  const path = String(props.request?.path ?? '')
  if (label.includes('导出') || /\bexport\b/i.test(path)) return { code: 'page-export', kind: 'export' }
  return null
}

interface CompileContext {
  drawing: UiDrawing
  diagnostics: UiDiagnostic[]
  questions: UiQuestion[]
  regions: UiRegion[]
  /** 元素 id → 已追问过的字段，保证同一元素同一字段只问一次。 */
  asked: Map<string, Set<string>>
}

function regionOfRole(ctx: CompileContext, role: UiRole): UiRegion | null {
  return ctx.regions.find((region) => region.role === role) ?? null
}

/** 记录一条诊断；带 `ask` 且定位到元素时同时进追问清单。 */
function report(
  ctx: CompileContext,
  level: UiDiagnostic['level'],
  code: string,
  message: string,
  element?: UiElement,
  ask?: Omit<UiQuestion, 'id' | 'elementId'>,
): void {
  const entry: UiDiagnostic = { level, code, message }
  if (element) entry.elementId = element.id
  ctx.diagnostics.push(entry)
  if (!ask || !element) return
  const seen = ctx.asked.get(element.id) ?? new Set<string>()
  if (seen.has(ask.field)) return
  seen.add(ask.field)
  ctx.asked.set(element.id, seen)
  ctx.questions.push({
    id: `${element.id}:${ask.field}`,
    elementId: element.id,
    field: ask.field,
    prompt: ask.prompt,
    kind: ask.kind,
    ...(ask.choices ? { choices: ask.choices } : {}),
    ...(ask.role ? { role: ask.role } : {}),
  })
}

/** 取必填字段：缺了就追问，而不是默默产出无名列/无名按钮。 */
function textOf(
  ctx: CompileContext,
  element: UiElement,
  field: 'prop' | 'label',
): string | null {
  const value = String(effectiveProps(element)[field] ?? '').trim()
  if (value) return value
  report(
    ctx, 'error', `missing-${field}`,
    `${specOf(element.role).label}「${element.text || element.id}」缺少${field === 'prop' ? '字段名 prop' : '标签 label'}`,
    element,
    {
      field,
      prompt: `这是图纸上的一个${specOf(element.role).label}（文案「${element.text || element.id}」，位置 x=${Math.round(element.rect.x)}, y=${Math.round(element.rect.y)}）。`
        + (field === 'prop'
          ? '请给出它绑定的数据字段名（英文驼峰，如 nickname / deptId / createdAt）。'
          : '请给出它显示的中文标签。'),
      kind: 'text',
    },
  )
  return null
}

/** 列 → `ColumnSchema`：宽度优先取显式配置，否则按图纸几何。 */
function compileColumn(ctx: CompileContext, element: UiElement): ColumnSchema | null {
  const prop = textOf(ctx, element, 'prop')
  const label = textOf(ctx, element, 'label')
  if (!prop || !label) return null
  const props = effectiveProps(element)
  const geometry = columnWidthOf(element.rect)
  const width = props.width ?? geometry.width
  const minWidth = props.minWidth ?? (geometry.width === undefined ? geometry.minWidth : undefined)
  const column: ColumnSchema = {
    prop,
    label,
    ...(width !== undefined ? { width } : {}),
    ...(minWidth !== undefined ? { minWidth } : {}),
    ...(props.align ? { align: props.align } : {}),
    ...(props.fixed ? { fixed: props.fixed } : {}),
    ...(props.cell ? { cell: props.cell } : {}),
    ...(props.help ? { help: props.help } : {}),
    ...(props.dict ? { dict: props.dict } : {}),
    ...(props.tagMap ? { tagMap: props.tagMap } : {}),
    ...(props.resolveFrom
      ? {
          resolveFrom: {
            endpoint: props.resolveFrom.endpoint,
            ...(props.resolveFrom.keyProp ? { keyProp: props.resolveFrom.keyProp } : {}),
            ...(props.resolveFrom.labelProp ? { labelProp: props.resolveFrom.labelProp } : {}),
          },
        }
      : {}),
  }
  if (props.cell === 'custom' && !props.resolveFrom) {
    report(ctx, 'warn', 'column-custom-without-slot',
      `列「${label}」声明了自定义单元格，但下发的 schema 没有插槽可用，将按文本展示`, element)
  }
  return column
}

/** 表单字段 → `FieldSchema`：必填必须同时带校验规则。 */
function compileField(
  ctx: CompileContext,
  element: UiElement,
  formRect: { width: number } | null,
): FieldSchema | null {
  const prop = textOf(ctx, element, 'prop')
  const label = textOf(ctx, element, 'label')
  if (!prop || !label) return null
  const props = effectiveProps(element)
  const rules = props.rules ? [...props.rules] : []
  if (props.required && !rules.some((rule) => rule.kind === 'required')) rules.unshift({ kind: 'required' })
  const field: FieldSchema = {
    prop,
    label,
    control: props.control ?? 'input',
    ...(props.required ? { required: true } : {}),
    ...(rules.length ? { rules: rules as NonNullable<FieldSchema['rules']> } : {}),
    ...(props.options?.length ? { options: props.options } : {}),
    ...(props.dict ? { dict: props.dict } : {}),
    ...(props.default !== undefined ? { default: props.default } : {}),
    ...(props.disabledOnEdit ? { disabledOnEdit: true } : {}),
    ...(props.placeholder ? { placeholder: props.placeholder } : {}),
    ...(props.help ? { help: props.help } : {}),
    ...(props.rows !== undefined ? { rows: props.rows } : {}),
    ...(props.treeEndpoint ? { treeEndpoint: props.treeEndpoint } : {}),
    span: props.span ?? spanOf(element.rect, formRect),
  }
  const needsOptions = field.control === 'select' || field.control === 'radio' || field.control === 'treeSelect'
  if (needsOptions && !field.options?.length && !field.dict && !field.treeEndpoint) {
    report(ctx, 'warn', 'field-options-missing',
      `字段「${label}」是 ${field.control} 却没有选项来源`, element, {
        field: 'options',
        prompt: `表单字段「${label}」（${prop}）是 ${field.control}，需要选项。请给出字典类型编码，或选项数组 [{label, value}]。`,
        kind: 'text',
      })
  }
  return field
}

/** 查询条件 → `QuerySchema`：匹配方式决定后端条件生成。 */
function compileQuery(ctx: CompileContext, element: UiElement): QuerySchema | null {
  const prop = textOf(ctx, element, 'prop')
  if (!prop) return null
  const props = effectiveProps(element)
  const control = props.control === 'select' ? 'select' : 'input'
  // `match` 只认元素显式声明：传了 like 才带参与字段，其余交给后端按控件推断，
  // 避免「下拉框被角色默认值改成长模糊匹配」这种默认值泄漏。
  const explicitMatch = element.props.match
    ? { match: element.props.match, ...(element.props.props?.length && element.props.match === 'like' ? { props: element.props.props } : {}) }
    : null
  const query: QuerySchema = {
    prop,
    control,
    ...(props.placeholder ? { placeholder: props.placeholder } : {}),
    ...(props.param ? { param: props.param } : {}),
    ...(props.width !== undefined
      ? { width: props.width }
      : element.rect.width >= 40 ? { width: Math.round(element.rect.width) } : {}),
    ...(props.options?.length ? { options: props.options } : {}),
    ...(props.dict ? { dict: props.dict } : {}),
    ...(explicitMatch ?? (control === 'input' ? { match: 'like' as const } : {})),
  }
  if (control === 'select' && !query.options?.length && !query.dict) {
    report(ctx, 'error', 'query-options-missing',
      `查询条件「${element.text || prop}」是下拉却没有选项`, element, {
        field: 'options',
        prompt: `查询条件（字段 ${prop}）是下拉框，请给出字典编码或选项数组。`,
        kind: 'text',
      })
  }
  return query
}

/** 动作按钮 → `ActionSchema`；缺请求模板的 request 动作是缺陷，不放过。 */
function compileAction(ctx: CompileContext, element: UiElement): ActionSchema | null {
  const props = effectiveProps(element)
  const label = String(props.label ?? element.text ?? '').trim()
  if (!label) {
    report(ctx, 'error', 'action-label-missing', `按钮「${element.id}」缺少文案`, element, {
      field: 'label', prompt: '这是图纸上的一个按钮，请给出它的中文文案。', kind: 'text',
    })
    return null
  }
  const kind = props.kind ?? 'request'
  if (kind === 'request' && !props.request) {
    report(ctx, 'error', 'action-request-missing',
      `按钮「${label}」是 request 动作但没有请求模板`, element, {
        field: 'request',
        prompt: `按钮「${label}」需要请求模板：HTTP 方法（POST/PUT/PATCH/DELETE）、路径（可用 {id} 占位行主键）、请求体字段。`,
        kind: 'text',
      })
    return null
  }
  if (props.route) {
    report(ctx, 'warn', 'action-route-ignored',
      `按钮「${label}」声明了跳转路由 ${props.route}；页面 schema 的动作只有内置分支，跳转请走已有入口`, element)
  }
  return {
    key: String(props.prop ?? '').trim() || `${kind}-${element.id}`,
    label,
    kind,
    ...(props.variant ? { variant: props.variant } : {}),
    ...(props.permission ? { permission: props.permission } : {}),
    ...(props.confirm ? { confirm: props.confirm } : {}),
    ...(props.request ? { request: props.request as NonNullable<ActionSchema['request']> } : {}),
    ...(props.visibleWhen ? { visibleWhen: props.visibleWhen } : {}),
    ...(props.disabledWhen ? { disabledWhen: props.disabledWhen } : {}),
  }
}

/** 主函数：编译整份图纸。 */
export function compileDrawing(drawing: UiDrawing): UiCompiledPage {
  const regions = regionsOf(drawing)
  const ctx: CompileContext = { drawing, diagnostics: [], questions: [], regions, asked: new Map() }
  const meta = drawing.meta

  if (!meta.key?.trim()) {
    ctx.diagnostics.push({ level: 'error', code: 'meta-key-missing', message: '图纸缺少页面 key，发布后无法定位页面' })
    ctx.questions.push({
      id: 'meta:key', field: 'key', kind: 'text',
      prompt: '这份图纸还没有页面 key，请给出英文点分标识（如 system.user）。',
    })
  }
  if (!meta.title?.trim()) {
    ctx.diagnostics.push({ level: 'error', code: 'meta-title-missing', message: '图纸缺少页面标题' })
    ctx.questions.push({
      id: 'meta:title', field: 'title', kind: 'text',
      prompt: '这份图纸还没有页面标题，请给出后台侧栏与页头显示的中文标题。',
    })
  }

  const tableRegion = regionOfRole(ctx, 'table')
  const formRegion = regionOfRole(ctx, 'form')
  const treeRegion = regionOfRole(ctx, 'tree')
  const filterRegion = regionOfRole(ctx, 'filter')
  const toolbarRegion = regionOfRole(ctx, 'toolbar')
  const headerRegion = regionOfRole(ctx, 'header')
  const tableElement = tableRegion ? findElement(drawing, tableRegion.id) : null
  const tableProps = tableElement ? effectiveProps(tableElement) : null
  const treeElement = treeRegion ? findElement(drawing, treeRegion.id) : null
  const treeProps = treeElement ? effectiveProps(treeElement) : null

  // 列表接口：meta > 表格容器；两处都没有才追问。
  const endpoint = String(meta.endpoint ?? tableProps?.endpoint ?? '').trim()
  if (!endpoint) {
    ctx.diagnostics.push({
      level: 'error', code: 'endpoint-missing',
      message: '页面的列表接口为空，编译出的页面取不到数据',
      ...(tableElement ? { elementId: tableElement.id } : {}),
    })
    ctx.questions.push({
      id: 'meta:endpoint', field: 'endpoint', kind: 'text',
      prompt: '这份图纸还没有列表接口。请给出资源端点（如 /system/users）与行主键字段名（缺省 id）。',
    })
  }

  // 标题：meta > 表格 label > 页头里的文案元素。
  const headerElement = (headerRegion?.childIds ?? [])
    .map((id) => findElement(drawing, id))
    .filter((element): element is UiElement => element !== null)
    .find((element) => element.role === 'text')
  const title = String(meta.title ?? tableProps?.label ?? headerElement?.text ?? '').trim()

  // 列：表格区子元素；没有表格容器时退化为全图列元素（仍按横向排序）。
  const columnElements = tableRegion
    ? leavesOf(drawing, tableRegion.id, ['column'])
    : elementsOfRole(drawing, 'column')
  const columns: ColumnSchema[] = []
  for (const element of columnElements) {
    const column = compileColumn(ctx, element)
    if (column) columns.push(column)
  }
  if (!columns.length) {
    ctx.diagnostics.push({ level: 'warn', code: 'columns-empty', message: '图纸里没有可编译的列，页面表格会是空的' })
  }

  // 表格区里既不是列也不是动作的元素：富内容走扩展诊断，其余给可执行提示。
  if (tableRegion) {
    for (const id of tableRegion.childIds) {
      const element = findElement(drawing, id)
      if (!element || element.role === 'column' || element.role === 'action') continue
      if (EXTENSION_ROLES.includes(element.role)) {
        report(ctx, 'info', 'extension-element',
          `${specOf(element.role).label}「${element.text || element.id}」需要页面形态扩展，本次编译跳过`, element)
      } else {
        report(ctx, 'warn', 'unexpected-in-table',
          `列表区里的${specOf(element.role).label}「${element.text || element.id}」不会被编译，请改成列/动作或移出列表区`, element)
      }
    }
  }

  // 行操作：列表区里的动作；没有列表容器时只认带行级条件的动作。
  const rowActionElements = tableRegion
    ? leavesOf(drawing, tableRegion.id, ['action'])
    : elementsOfRole(drawing, 'action').filter((element) => {
        const props = effectiveProps(element)
        return Boolean(props.visibleWhen || props.disabledWhen)
      })
  const rowActionIds = new Set(rowActionElements.map((element) => element.id))

  // 行操作：只认列表区里的动作。它们才是 `actions` 的唯一来源。
  const actions: ActionSchema[] = []
  for (const element of rowActionElements) {
    const action = compileAction(ctx, element)
    if (action) actions.push(action)
  }

  // 表单字段：表单区子元素；没有表单容器时按全图字段元素、两栏判定。
  const fieldElements = formRegion
    ? leavesOf(drawing, formRegion.id, ['field'])
    : elementsOfRole(drawing, 'field')
  const fields: FieldSchema[] = []
  for (const element of fieldElements) {
    const field = compileField(ctx, element, formRegion ? { width: formRegion.rect.width } : null)
    if (field) fields.push(field)
  }

  // 页面级按钮：按规则表映射到真正的落点，映射不上的明确报「需要扩展」。
  const toolbarActionElements = toolbarRegion
    ? leavesOf(drawing, toolbarRegion.id, ['action']).filter((element) => !rowActionIds.has(element.id))
    : elementsOfRole(drawing, 'action').filter((element) => !rowActionIds.has(element.id))

  let hasCreateIntent = false
  let hasExportIntent = false
  for (const element of toolbarActionElements) {
    const matched = matchPageAction(element)
    if (!matched) {
      report(ctx, 'warn', 'page-action-unsupported',
        `页面级按钮「${effectiveProps(element).label ?? element.text ?? element.id}」当前页面形态没有槽位：`
        + 'schema 的 actions 只渲染行操作列，页面级按钮需要页面形态扩展', element)
      continue
    }
    if (matched.kind === 'create') {
      hasCreateIntent = true
      continue
    }
    hasExportIntent = true
  }
  // 想要「新增」按钮，就必须有表单：否则按钮点了没内容，属缺陷而非提醒。
  if (hasCreateIntent && !fields.length && formRegion === null) {
    ctx.diagnostics.push({
      level: 'error', code: 'page-create-without-form',
      message: '工具条上有「新增」按钮，但图纸里没有表单区，点新增将无事发生',
    })
    ctx.questions.push({
      id: 'meta:form', field: 'element', kind: 'text', role: 'form',
      prompt: '工具条上有新增按钮，但图纸里还没有表单区。请给出新增/编辑需要的字段清单（字段名、中文标签、控件类型、是否必填），我会据此生成表单元件。',
    })
  }

  // 查询条件。
  const queryElements = filterRegion
    ? leavesOf(drawing, filterRegion.id, ['query'])
    : elementsOfRole(drawing, 'query')
  const queries: QuerySchema[] = []
  for (const element of queryElements) {
    const query = compileQuery(ctx, element)
    if (query) queries.push(query)
  }

  // 左树：接口必须显式给，否则追问（给不出就不编出一棵假树）。
  let tree: CrudPageSchema['tree']
  if (treeRegion) {
    const treeEndpoint = String(treeProps?.treeEndpointOf ?? '').trim()
    if (!treeEndpoint) {
      report(ctx, 'error', 'tree-endpoint-missing', '左树没有数据接口', treeElement ?? undefined, {
        field: 'treeEndpointOf',
        prompt: '左树需要一个数据接口。请给出树资源端点（如 /system/departments），以及选中节点写入列表查询的参数名（如 deptId）。',
        kind: 'text',
      })
    } else {
      tree = {
        endpoint: treeEndpoint,
        idProp: 'id',
        labelProp: 'name',
        parentProp: 'parentId',
        param: String(treeProps?.treeParam ?? 'deptId'),
        ...(treeProps?.treeFilterProp ? { filterProp: treeProps.treeFilterProp } : {}),
        includeDescendants: treeProps?.treeIncludeDescendants !== false,
        allLabel: '全部',
        searchable: true,
      }
    }
  }

  // 超出当前页面形态的角色：按角色去重汇总，看板类图纸不至于刷屏。
  const unsupported: UiDrawingAnalysis['unsupported'] = []
  const seenUnsupportedRoles = new Set<UiRole>()
  for (const element of drawing.elements) {
    if (element.visible === false || !EXTENSION_ROLES.includes(element.role)) continue
    if (seenUnsupportedRoles.has(element.role)) continue
    seenUnsupportedRoles.add(element.role)
    unsupported.push({
      elementId: element.id,
      role: element.role,
      reason: `${specOf(element.role).label}需要页面形态扩展（当前 schema 只覆盖表格/表单/查询/动作/左树）`,
    })
  }

  const layout = meta.layout ?? (tableProps?.layout === 'tree-table' ? 'tree-table' : 'table')
  const exportable = meta.exportable ?? (hasExportIntent || Boolean(toolbarRegion))
  const pageSize = meta.pageSize ?? tableProps?.pageSize ?? 10
  const rowKey = meta.rowKey ?? tableProps?.rowKey ?? 'id'

  const schema: CrudPageSchema = {
    key: meta.key,
    title: title || meta.key,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.entity ? { entity: meta.entity } : {}),
    ...(layout === 'tree-table' ? { layout: 'tree-table' as const } : {}),
    endpoint,
    rowKey,
    ...(meta.permissions ? { permissions: meta.permissions } : {}),
    ...(meta.menu ? { menu: meta.menu } : {}),
    ...(queries.length ? { query: queries } : {}),
    columns,
    ...(fields.length ? { fields } : {}),
    ...(actions.length ? { actions } : {}),
    pageSize,
    ...(exportable ? { exportable: true } : {}),
    ...(tree ? { tree } : {}),
    ...(meta.uniqueProps?.length ? { uniqueProps: meta.uniqueProps } : {}),
    ...(meta.undeletableWhen ? { undeletableWhen: meta.undeletableWhen } : {}),
  }

  const analysis: UiDrawingAnalysis = {
    regions,
    title: title || meta.key,
    endpoint,
    columns: columns.map((column) => column.prop),
    fields: fields.map((field) => field.prop),
    queries: queries.map((query) => query.prop),
    actions: actions.map((action) => action.label),
    hasTree: Boolean(tree),
    unsupported,
  }

  return {
    key: meta.key,
    schema: schema as unknown as Record<string, unknown>,
    diagnostics: ctx.diagnostics,
    questions: ctx.questions,
    analysis,
  }
}
