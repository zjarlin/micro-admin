// 浏览器端拾取器：像 Chrome 的「检查元素」一样，用鼠标点一下就知道这块 DOM 写在哪。
//
// 只在需要时创建（`createSourcePicker()`），关掉后不残留监听。
// 视觉层跑在 Shadow DOM 里：业务页面的通配样式与 Element Plus 的 reset 都影响不到它，
// 它自己也不会覆盖页面任何样式；覆盖框与提示都用 `pointer-events: none`。
import {
  SOURCE_ATTRIBUTE,
  componentChain,
  createFileResolver,
  filesNamed,
  formatLocation,
  instanceProps,
  locateElement,
  normalizeFile,
  type ComponentFrame,
  type FileResolver,
  type SourceLocation,
} from './location.ts'

/** 当前页面的来源：谁提供了这一页（插件 / schema / 路由）。 */
export interface PageOrigin {
  /** 一句话结论，例如「配置驱动页面：schema demo.device」。 */
  label: string
  /** 补充说明：具体文件或权限码，可省。 */
  detail?: string
  /** 定义这一页的源码文件（相对路径）；给了就能点击跳转。 */
  files?: string[]
}

export interface PickerLabels {
  title: string
  hint: string
  empty: string
  copy: string
  copied: string
  open: string
  ambiguous: string
  repo: string
  page: string
}

export interface PickedDetail {
  location: SourceLocation | null
  chain: ComponentFrame[]
  /** 组件链上出现过的 schema key（配置驱动的页面把页面定义写在 `page-key` 里）。 */
  schemaKeys: string[]
  /** 组件链上出现过的路由名（容器组件把它写进 props 时才有）。 */
  routeNames: string[]
  /** 元素选择器路径，例如 `main .app-frame > section.page > h1`。 */
  path: string
  /** 同一 basename 对应多个源码文件时的候选（生产构建会压成 basename）。 */
  candidates: string[]
}

export interface SourcePickerOptions {
  /** 切换快捷键；默认 `mod+shift+e`（macOS ⌘⇧E）。传 `null` 关闭。 */
  hotkey?: string | null
  /** 本地 `.vue` 清单；默认读注入到 HTML 的那份。 */
  files?: () => string[]
  /** 仓库链接：给了就多一个「在仓库查看」。 */
  repo?: { baseUrl: string; branch?: string }
  /** 打开编辑器的端点；默认 Vite 的 `/__open-in-editor`，传 `false` 关闭。 */
  editorEndpoint?: string | false
  /** 选中回调；插件用它联动宿主（例如把结果推进右栏）。 */
  onPick?: (picked: PickedDetail) => void
  /** 激活状态变化回调。 */
  onChange?: (active: boolean) => void
  /**
   * 当前页面的来源说明（宿主提供）。
   *
   * 配置驱动的页面根本没有 `.vue`，光靠元素标记只能回答「渲染在哪个壳里」；
   * 由宿主补一句「这一页的配置来自哪里」，用户才不会在壳文件里翻业务逻辑。
   */
  describePage?: (picked: PickedDetail) => PageOrigin | null
  labels?: Partial<PickerLabels>
}

const DEFAULT_LABELS: PickerLabels = {
  title: '元素定位',
  hint: '点击元素查看源码位置；Esc 退出，⌘/Ctrl+⇧+E 切换',
  empty: '该元素没有源码标记（来自第三方组件，或该元素由 JS 动态创建）',
  copy: '复制位置',
  copied: '已复制',
  open: '在编辑器打开',
  ambiguous: '同名文件，需确认目录',
  repo: '在仓库查看',
  page: '这一页来自',
}

const MANIFEST_ID = 'source-locator-files'

const STYLE = `
:host { all: initial; }
.wrap { position: fixed; inset: 0; pointer-events: none; font: 500 12px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.box { position: fixed; display: none; border: 1px solid #22d3ee; background: rgba(34, 211, 238, .14); box-shadow: 0 0 0 1px rgba(34, 211, 238, .35), 0 10px 30px rgba(8, 47, 73, .28); border-radius: 4px; }
.chip { position: fixed; display: none; max-width: min(72vw, 620px); padding: 5px 9px; border-radius: 7px; background: #0b1220; color: #e6f6ff; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 10px 28px rgba(2, 10, 25, .45); border: 1px solid rgba(34, 211, 238, .5); }
.chip b { color: #67e8f9; font-weight: 600; }
.chip small { display: block; color: #93a4bb; font-family: inherit; font-size: 10.5px; }
.card { position: fixed; right: 16px; bottom: 16px; width: min(420px, calc(100vw - 32px)); max-height: 60vh; overflow: auto; pointer-events: auto; background: #0b1220; color: #e6f6ff; border: 1px solid #22304a; border-radius: 14px; box-shadow: 0 24px 60px rgba(2, 10, 25, .55); padding: 14px 14px 12px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.head strong { font-size: 12.5px; letter-spacing: .02em; }
.head button { all: unset; cursor: pointer; color: #93a4bb; font-size: 15px; line-height: 1; padding: 2px 5px; border-radius: 5px; }
.head button:hover { color: #e6f6ff; background: rgba(255, 255, 255, .08); }
.code { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px; background: #111c30; border: 1px solid #1d2b44; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.code span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
.actions button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 8px; background: #17253c; color: #cfe3ff; font-size: 11.5px; border: 1px solid #24344f; }
.actions button:hover { background: #1d2f4a; border-color: #2f4767; }
.actions button.primary { background: linear-gradient(135deg, #2563eb, #06b6d4); border-color: transparent; color: #06121f; font-weight: 700; }
.actions a { text-decoration: none; }
.origin { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 10px 0 0; padding: 7px 9px; border-radius: 9px; background: rgba(37, 99, 235, .12); border: 1px solid rgba(37, 99, 235, .3); font-size: 11.5px; }
.origin-label { color: #93a4bb; flex: none; }
.origin-value { color: #cfe3ff; font-weight: 600; }
.origin-detail { flex-basis: 100%; color: #7f93ad; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; word-break: break-all; }
.origin-file { all: unset; cursor: pointer; flex-basis: 100%; color: #67e8f9; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; word-break: break-all; }
.origin-file:hover { text-decoration: underline; }
.list { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.list li { display: flex; align-items: baseline; gap: 8px; padding: 5px 7px; border-radius: 7px; font-size: 11.5px; }
.list li.local { cursor: pointer; }
.list li.local:hover { background: rgba(34, 211, 238, .12); }
.list li.current { background: rgba(37, 99, 235, .28); }
.list .name { color: #e6f6ff; font-weight: 600; flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list .file { color: #7f93ad; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tip { color: #7f93ad; font-size: 10.5px; margin: 8px 0 0; line-height: 1.6; }
.path { color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; margin-top: 8px; word-break: break-all; }
.warn { color: #fbbf24; font-size: 10.5px; margin: 8px 0 0; }
.none { color: #93a4bb; font-size: 11.5px; line-height: 1.7; margin: 0; }
`

/** 读取注入到 HTML 的清单；没有就返回空数组（拾取器依然可用）。 */
export function readManifest(doc: Document = document): string[] {
  const node = doc.getElementById(MANIFEST_ID)
  if (!node?.textContent) return []
  try {
    const parsed: unknown = JSON.parse(node.textContent)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** 元素在 DOM 里的可读路径：用于人工确认「点的是哪一个」。 */
export function describePath(element: Element): string {
  const parts: string[] = []
  let node: Element | null = element
  while (node && parts.length < 6) {
    const tag = node.tagName.toLowerCase()
    const id = node.id ? `#${node.id}` : ''
    const cls = node.classList.length ? `.${[...node.classList].slice(0, 2).join('.')}` : ''
    parts.unshift(`${tag}${id}${cls}`)
    node = node.parentElement
  }
  return parts.join(' > ')
}

function matchesHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.toLowerCase().split('+')
  const key = parts.pop() ?? ''
  if (event.key.toLowerCase() !== key) return false
  const mac = /mac|iphone|ipad/i.test(navigator.platform)
  const wantMod = parts.includes('mod')
  const wantCtrl = parts.includes('ctrl') || (wantMod && !mac)
  const wantMeta = parts.includes('meta') || (wantMod && mac)
  if (parts.includes('shift') !== event.shiftKey) return false
  if (parts.includes('alt') !== event.altKey) return false
  if (wantCtrl !== event.ctrlKey) return false
  if (wantMeta !== event.metaKey) return false
  return true
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

export interface SourcePicker {
  enable(): void
  disable(): void
  toggle(): void
  readonly active: boolean
  destroy(): void
}

/**
 * 创建拾取器。默认不激活，调用 `enable()` 后才接管指针。
 *
 * 只捕获事件、不改页面 DOM：悬停画一个覆盖框，点击阻止默认行为并出卡片，
 * 滚动、键盘输入、表单交互都不受影响。
 */
export function createSourcePicker(options: SourcePickerOptions = {}): SourcePicker {
  const labels = { ...DEFAULT_LABELS, ...options.labels }
  const hotkey = options.hotkey === undefined ? 'mod+shift+e' : options.hotkey
  const editorEndpoint = options.editorEndpoint ?? '/__open-in-editor'
  const files = options.files ?? (() => readManifest())
  // `/__open-in-editor` 只有 Vite dev server 提供；生产站点上点了只会 404。
  // 因此先探测一次，不可用就不显示按钮，而不是给一个点了没反应的入口。
  let editorReady: boolean | null = null
  void probeEditor()

  async function probeEditor(): Promise<void> {
    if (editorEndpoint === false) {
      editorReady = false
      return
    }
    try {
      const response = await fetch(editorEndpoint, { method: 'GET' })
      // dev server 对缺少 file 参数的请求返回 400，说明端点存在；
      // 生产 SPA 兜底会返回 index.html（200 但 content-type 是 html）。
      editorReady = response.status === 400 || response.status === 200 && !/text\/html/.test(response.headers.get('content-type') ?? '')
    } catch {
      editorReady = false
    }
  }

  let active = false
  let host: HTMLElement | null = null
  let shadow: ShadowRoot | null = null
  let layer: HTMLElement | null = null
  let box: HTMLElement | null = null
  let chip: HTMLElement | null = null
  let card: HTMLElement | null = null
  let hovered: Element | null = null
  let hoverDetail: PickedDetail | null = null
  let resolveFile: FileResolver | null = null

  function resolver(): FileResolver {
    resolveFile ??= createFileResolver(files())
    return resolveFile
  }

  function pick(element: Element): PickedDetail {
    const location = locateElement(element, SOURCE_ATTRIBUTE)
    const chain = componentChain(element, { resolve: resolver() })
    const basename = location ? (location.file.split('/').pop() ?? location.file) : null
    const candidates = basename ? filesNamed(files(), basename) : []

    // 配置驱动的页面（`<SchemaPage page-key="system.user">`）把业务定义写在 props 里，
    // 只报「渲染壳在 CrudPage.vue」等于没说，因此顺手把 key 一起带出去。
    const keys = new Set<string>()
    const names = new Set<string>()
    for (const props of instanceProps(element)) {
      for (const field of ['pageKey', 'page-key']) {
        const value = props[field]
        if (typeof value === 'string' && value) keys.add(value)
      }
      const routeName = props.routeName ?? props['route-name']
      if (typeof routeName === 'string' && routeName) names.add(routeName)
    }

    return {
      location,
      chain,
      schemaKeys: [...keys],
      routeNames: [...names],
      path: describePath(element),
      candidates: candidates.length > 1 ? candidates : [],
    }
  }

  function ensureLayer(): void {
    if (layer) return
    host = document.createElement('div')
    host.setAttribute('data-source-picker', '')
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000'
    shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLE
    layer = document.createElement('div')
    layer.className = 'wrap'
    box = document.createElement('div')
    box.className = 'box'
    chip = document.createElement('div')
    chip.className = 'chip'
    layer.append(box, chip)
    shadow.append(style, layer)
    document.body.append(host)
  }

  function paint(): void {
    if (!hovered || !hoverDetail || !box || !chip) return
    const rect = hovered.getBoundingClientRect()
    const visible = rect.width > 0 && rect.height > 0
    box.style.display = visible ? 'block' : 'none'
    box.style.left = `${rect.left}px`
    box.style.top = `${rect.top}px`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`

    const detail = hoverDetail
    const where = detail.location ? formatLocation(detail.location) : labels.empty
    // 优先显示「与这段 DOM 同文件」的组件：那才是真正写这行模板的地方；
    // 最外层组件（App/Layout）对定位没有帮助。
    const owner = detail.chain.find((frame) => frame.file && frame.file === detail.location?.file) ?? detail.chain[0]
    const sub = owner ? `${owner.name}${owner.file ? ` · ${owner.file}` : ''}` : detail.path
    chip.innerHTML = `<b>${escapeHtml(where)}</b><small>${escapeHtml(sub)}</small>`
    chip.style.display = 'block'
    const width = chip.offsetWidth
    const height = chip.offsetHeight
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
    // 上方放得下就放上方（留 8px 间隔，不压住元素本身），否则落到元素下方。
    const above = rect.top - height - 8
    const top = above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - height - 8)
    chip.style.left = `${left}px`
    chip.style.top = `${top}px`
  }

  function targetOf(event: Event): Element | null {
    const node = event.composedPath()[0]
    if (!(node instanceof Element)) return null
    if (host && (node === host || host.contains(node))) return null
    return node
  }

  function setHovered(element: Element | null): void {
    if (element === hovered) return
    hovered = element
    // 组件链解析是这里最贵的一步，只在「换元素」时做，滚动时只重算坐标。
    hoverDetail = element ? pick(element) : null
    paint()
  }

  function onPointerMove(event: PointerEvent): void {
    setHovered(targetOf(event))
  }

  /** 滚动与缩放时元素自身没变，但它在视口里的位置变了：只重画，不重解析。 */
  function onReposition(): void {
    if (hovered) paint()
  }

  function onClick(event: MouseEvent): void {
    const element = targetOf(event)
    if (!element) return
    event.preventDefault()
    event.stopPropagation()
    // 按住快捷键点击 = 只定位不打断原交互；普通点击在拾取模式下当然要拦。
    setHovered(element)
    renderCard(pick(element))
  }

  /**
   * 激活态只处理 Esc：先关结果卡片，再退出拾取。
   *
   * 切换键故意不在这里处理——全局监听已经接管，两处都响应会让一次按键开关两次，
   * 表现成「按了没反应」。
   */
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (card) {
      card.remove()
      card = null
      return
    }
    disable()
  }

  function renderCard(detail: PickedDetail): void {
    ensureLayer()
    card?.remove()
    const panel = document.createElement('div')
    panel.className = 'card'

    const head = document.createElement('div')
    head.className = 'head'
    const title = document.createElement('strong')
    title.textContent = labels.title
    const close = document.createElement('button')
    close.type = 'button'
    close.title = '关闭'
    close.textContent = '×'
    close.addEventListener('click', () => {
      panel.remove()
      card = null
    })
    head.append(title, close)
    panel.append(head)

    if (detail.location) {
      const code = document.createElement('div')
      code.className = 'code'
      const text = document.createElement('span')
      text.textContent = formatLocation(detail.location)
      code.append(text)
      panel.append(code)

      const actions = document.createElement('div')
      actions.className = 'actions'
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'primary'
      copy.textContent = labels.copy
      copy.addEventListener('click', () => {
        void copyText(formatLocation(detail.location as SourceLocation)).then(() => {
          copy.textContent = labels.copied
          setTimeout(() => (copy.textContent = labels.copy), 1200)
        })
      })
      actions.append(copy)

      if (editorReady !== false) {
        const open = document.createElement('button')
        open.type = 'button'
        open.textContent = labels.open
        open.addEventListener('click', () => void openInEditor(detail.location as SourceLocation))
        actions.append(open)
      }

      if (options.repo) {
        const link = document.createElement('a')
        link.href = repoUrl(options.repo, detail.location)
        link.target = '_blank'
        link.rel = 'noreferrer'
        const jump = document.createElement('button')
        jump.type = 'button'
        jump.textContent = labels.repo
        link.append(jump)
        actions.append(link)
      }
      panel.append(actions)

      if (detail.candidates.length > 1) {
        const warn = document.createElement('p')
        warn.className = 'warn'
        warn.textContent = `${labels.ambiguous}：${detail.candidates.join(' / ')}`
        panel.append(warn)
      }
    } else {
      const none = document.createElement('p')
      none.className = 'none'
      none.textContent = labels.empty
      panel.append(none)
    }

    const origin = options.describePage?.(detail) ?? null
    if (origin) {
      const block = document.createElement('div')
      block.className = 'origin'
      const caption = document.createElement('span')
      caption.className = 'origin-label'
      caption.textContent = labels.page
      const value = document.createElement('span')
      value.className = 'origin-value'
      value.textContent = origin.label
      block.append(caption, value)
      if (origin.detail) {
        const extra = document.createElement('div')
        extra.className = 'origin-detail'
        extra.textContent = origin.detail
        block.append(extra)
      }
      for (const file of origin.files ?? []) {
        if (editorReady === false) {
          const plain = document.createElement('div')
          plain.className = 'origin-detail'
          plain.textContent = file
          block.append(plain)
          continue
        }
        const link = document.createElement('button')
        link.type = 'button'
        link.className = 'origin-file'
        link.textContent = file
        link.addEventListener('click', () => void openInEditor({ file, line: 1, column: 1 }))
        block.append(link)
      }
      panel.append(block)
    }

    if (detail.chain.length) {
      const list = document.createElement('ul')
      list.className = 'list'
      detail.chain.forEach((frame, index) => {
        const item = document.createElement('li')
        if (index === 0) item.classList.add('current')
        if (frame.file && editorReady !== false) item.classList.add('local')
        const name = document.createElement('span')
        name.className = 'name'
        name.textContent = `${index === 0 ? '▸ ' : ''}${frame.name}`
        const file = document.createElement('span')
        file.className = 'file'
        file.textContent = frame.file ?? '—'
        item.append(name, file)
        const target = frame.file
        if (target && editorReady !== false) {
          item.addEventListener('click', () => void openInEditor({ file: target, line: 1, column: 1 }))
        }
        list.append(item)
      })
      panel.append(list)
    }

    const path = document.createElement('div')
    path.className = 'path'
    path.textContent = detail.path
    panel.append(path)

    const tip = document.createElement('p')
    tip.className = 'tip'
    tip.textContent = labels.hint
    panel.append(tip)

    layer?.append(panel)
    card = panel
    options.onPick?.(detail)
  }

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.cssText = 'position:fixed;opacity:0'
      document.body.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
  }

  async function openInEditor(location: SourceLocation): Promise<void> {
    if (editorEndpoint === false) return
    // Vite dev server 提供这个端点；生产站点没有它（404），此时退回复制路径。
    try {
      const response = await fetch(`${editorEndpoint}?file=${encodeURIComponent(formatLocation(location))}`)
      if (response.ok) return
    } catch {
      /* 落到复制 */
    }
    await copyText(formatLocation(location))
  }

  function enable(): void {
    if (active) return
    active = true
    ensureLayer()
    document.documentElement.style.cursor = 'crosshair'
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    options.onChange?.(true)
  }

  function disable(): void {
    if (!active) return
    active = false
    document.documentElement.style.cursor = ''
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('scroll', onReposition, true)
    window.removeEventListener('resize', onReposition)
    hovered = null
    hoverDetail = null
    card?.remove()
    card = null
    if (box) box.style.display = 'none'
    if (chip) chip.style.display = 'none'
    options.onChange?.(false)
  }

  function toggle(): void {
    if (active) disable()
    else enable()
  }

  // 快捷键独立于激活状态挂一次：未激活时也要能唤醒。
  // 输入框里不抢键：用户正在打字时 ⌘⇧E 可能另有含义。
  const combo = hotkey
  const globalHotkey = (event: KeyboardEvent): void => {
    if (!combo || !matchesHotkey(event, combo)) return
    const el = event.target
    if (el instanceof HTMLElement && /^(input|textarea|select)$/i.test(el.tagName)) return
    event.preventDefault()
    toggle()
  }
  if (combo) document.addEventListener('keydown', globalHotkey)

  return {
    enable,
    disable,
    toggle,
    get active() {
      return active
    },
    destroy(): void {
      disable()
      if (combo) document.removeEventListener('keydown', globalHotkey)
      host?.remove()
      host = null
      shadow = null
      layer = null
      box = null
      chip = null
    },
  }
}

/** 仓库链接：`https://github.com/me/repo/blob/main/src/x.vue#L12`。 */
export function repoUrl(repo: { baseUrl: string; branch?: string }, location: SourceLocation): string {
  const base = repo.baseUrl.replace(/\/$/, '')
  const branch = repo.branch ?? 'main'
  const file = normalizeFile(location.file) ?? location.file
  return `${base}/blob/${encodeURIComponent(branch).replace(/%2F/g, '/')}/${file}#L${location.line}`
}
