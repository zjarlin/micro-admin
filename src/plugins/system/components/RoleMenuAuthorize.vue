<script setup lang="ts">
// 角色授权菜单：把「角色 → 菜单/权限码」这段关系画出来，替代手填权限编码。
//
// 为什么不做成 schema 字段：勾选是一棵树（父子联动、半选态），
// 声明式 form 字段表达不了；这里由插件自渲染，schema 只保留入口按钮
// （`system.role` 的 `authorize` 动作，`kind: 'custom'`）。
//
// 数据来源与落点都是同一份资源：
// - 菜单树读 `/system/menus`（与菜单管理页同一张表，带 parentId）；
// - 保存写 `/system/roles/{id}` 的 `menuIds` + 由菜单派生的 `permissions`。
// 服务端读会话时按角色的 `permissions` 下发，因此这里改完、重新拉一次会话就生效。
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { TreeInstance } from 'element-plus'
import { buildTree } from '@addzero/data-page'
import type { Row } from '@addzero/data-page'
import { useService } from '@/shared/service'
import type { HttpClient } from '@/shared/http'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{
  /** 抽屉开关（v-model）。 */
  modelValue: boolean
  /** 当前要授权的角色行；为空时不渲染内容。 */
  role: Row | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  /** 保存成功：父页面据此刷新列表里的授权列。 */
  (event: 'saved'): void
}>()

const http = useService<HttpClient>('http')
const session = useSessionStore()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

/** 菜单树一行：只保留渲染需要的字段，`id` 与后端一致才好回写。 */
interface MenuNode {
  id: number
  label: string
  permission: string
  type: 'directory' | 'menu' | 'button'
  children: MenuNode[]
}

const treeRef = ref<TreeInstance>()
const menus = ref<Row[]>([])
const nodes = ref<MenuNode[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

/** 已授权 id：菜单行上存的是勾选结果（含父级），回显时整份塞给树。 */
const authorized = computed<number[]>(() => {
  const raw = props.role?.menuIds
  return Array.isArray(raw) ? raw.map((id) => Number(id)).filter((id) => Number.isFinite(id)) : []
})

/** 超管用通配权限，菜单勾选对它没有约束力，置灰避免误解。 */
const wildcardRole = computed(() => {
  const list = props.role?.permissions
  return Array.isArray(list) && list.includes('*:*:*')
})

const canSave = computed(() => session.can('system:role:authorize') && !wildcardRole.value)

/**
 * 勾选变化的信号：el-tree 的勾选状态不是响应式的，
 * 靠 `check` 事件递增它，下面两个统计才会跟着重算。
 */
const checkTick = ref(0)

/** 本次勾选能派生出的权限码（父级目录没有权限码，天然被过滤掉）。 */
const grantedCount = computed(() => {
  void checkTick.value
  const byId = new Map(menus.value.map((row) => [Number(row.id), row]))
  const picked = new Set(currentCheckedIds())
  const codes = new Set<string>()
  for (const id of picked) {
    const permission = String(byId.get(id)?.permission ?? '').trim()
    if (permission) codes.add(permission)
  }
  return codes.size
})

const checkedCount = computed(() => {
  void checkTick.value
  return currentCheckedIds().length
})

/** 当前勾选 id：整选 + 半选（父级目录要一起存，否则下次回显会把子级孤立）。 */
function currentCheckedIds(): number[] {
  const tree = treeRef.value
  if (!tree) return authorized.value
  const ids = [...tree.getCheckedKeys(false), ...tree.getHalfCheckedKeys()].map((id) => Number(id))
  return [...new Set(ids.filter((id) => Number.isFinite(id)))].sort((left, right) => left - right)
}

function toNodes(rows: Row[]): MenuNode[] {
  const tree = buildTree(rows, { idProp: 'id', parentProp: 'parentId' })
  const map = (items: typeof tree): MenuNode[] => items.map((item) => ({
    id: Number(item.raw.id),
    label: String(item.raw.title ?? ''),
    permission: String(item.raw.permission ?? ''),
    type: (String(item.raw.type ?? 'menu') as MenuNode['type']),
    children: map(item.children),
  }))
  return map(tree)
}

/** 每次打开都重新拉一次菜单：菜单管理页刚加的路由必须马上能授权。 */
async function open(): Promise<void> {
  if (!props.role) return
  loading.value = true
  error.value = null
  try {
    menus.value = await http.request<Row[]>('/system/menus')
    nodes.value = toNodes(menus.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '菜单加载失败'
  } finally {
    loading.value = false
  }
  // 回显必须在「骨架屏已让位、el-tree 真正挂载」之后：加载中渲染的是 el-skeleton，
  // 此时 treeRef 还是 undefined，setCheckedKeys 会被静默丢弃，抽屉会显示成「一个都没选」，
  // 保存一次就把角色的授权清空。等两拍：一拍换掉骨架屏，一拍让 el-tree 完成内部初始化。
  if (error.value === null) {
    await nextTick()
    await nextTick()
    treeRef.value?.setCheckedKeys(authorized.value, false)
  }
}

watch(() => [props.modelValue, props.role?.id] as const, ([open_, id]) => {
  if (open_ && id !== undefined) void open()
})

async function save(): Promise<void> {
  const role = props.role
  if (!role) return
  const menuIds = currentCheckedIds()
  const byId = new Map(menus.value.map((row) => [Number(row.id), row]))
  const permissions = [...new Set(
    menuIds
      .map((id) => String(byId.get(id)?.permission ?? '').trim())
      .filter((permission) => permission !== ''),
  )].sort()
  saving.value = true
  try {
    // PUT 是「局部更新」：只写授权两列，角色名/编码等其余字段由后端按原行合并保留。
    await http.request(`/system/roles/${String(role.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ menuIds, permissions }),
    })
    ElMessage.success(`已授权 ${menuIds.length} 个菜单节点 / ${permissions.length} 个权限码`)
    emit('saved')
    visible.value = false
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="role ? `授权菜单 · ${String(role.name ?? '')}` : '授权菜单'"
    size="520px"
    destroy-on-close
    class="role-authorize"
  >
    <div v-meta="{ name: '授权菜单面板', desc: '角色 → 菜单/权限码勾选', group: 'system' }" class="body">
      <el-alert
        v-if="wildcardRole"
        type="warning"
        :closable="false"
        show-icon
        title="超级管理员使用通配权限"
        description="该角色的权限码是 *:*:*，菜单勾选不会改变它的可见范围。要收窄权限请改其他角色。"
      />
      <p class="hint">
        勾选决定这个角色能看到哪些菜单、具备哪些权限码。父级目录会自动带上，
        保存后该角色的用户重新登录即按新范围收窄。
      </p>

      <el-skeleton v-if="loading" :rows="6" animated />
      <el-alert v-else-if="error" type="error" :closable="false" show-icon :title="error" />
      <section v-else-if="!wildcardRole" v-meta="{ name: '菜单授权树', desc: '按菜单层级勾选权限', group: 'system' }" class="tree-wrap">
        <el-tree
          ref="treeRef"
          :data="nodes"
          node-key="id"
          show-checkbox
          default-expand-all
          :props="{ label: 'label', children: 'children' }"
          @check="checkTick += 1"
        >
          <template #default="{ data }">
            <span class="node">
              <span class="node-label">{{ data.label }}</span>
              <el-tag v-if="data.type === 'directory'" size="small" type="warning" effect="plain">目录</el-tag>
              <el-tag v-else-if="data.type === 'button'" size="small" type="info" effect="plain">按钮</el-tag>
              <code v-if="data.permission" class="node-code">{{ data.permission }}</code>
              <span v-else class="node-code muted">无权限码</span>
            </span>
          </template>
        </el-tree>
      </section>
    </div>

    <template #footer>
      <div class="footer">
        <span class="summary">
          已选 <strong>{{ checkedCount }}</strong> 个节点 → <strong>{{ grantedCount }}</strong> 个权限码
        </span>
        <div class="footer-actions">
          <el-button @click="visible = false">取消</el-button>
          <!-- metaId 在编译期写死；没有 system:role:authorize 的人看不到这个按钮。 -->
          <el-button
            v-meta:id="'system:role:authorize'"
            v-permission-meta
            type="primary"
            :disabled="!canSave"
            :loading="saving"
            @click="save"
          >保存授权</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.body { display: flex; flex-direction: column; gap: 12px; }
.hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--muted); }
.tree-wrap {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px 10px;
  max-height: calc(100vh - 260px);
  overflow: auto;
}
.node { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.node-label { font-size: 13px; color: var(--app-text); }
.node-code { font-size: 11px; color: var(--el-color-primary); }
.node-code.muted { color: var(--muted); }
.footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.summary { font-size: 12px; color: var(--muted); }
.footer-actions { display: flex; gap: 8px; }
</style>
