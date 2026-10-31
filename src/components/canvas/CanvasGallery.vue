<script setup lang="ts">
// 画布类「库」页面的公共外壳：左侧筛选栏 + 右侧卡片网格。
//
// 画面库与图纸库的版式完全同构（筛选、统计、九宫格、卡片动作），差异只在筛选控件与
// 卡片内容，因此这里做一层壳：两个页面各自只管自己的数据与卡片，不再各写一份布局。
//
// 布局按 CAD/IDE 的吝啬标准：高度吃满、网格按容器宽度自动铺列（不写死 3 列、
// 不留 1320px 上限），滚动只发生在网格区；筛选栏可收起，收起后网格拿到全部宽度。
import { computed, ref } from 'vue'
import { ArrowLeftBold, ArrowRightBold, Search } from '@element-plus/icons-vue'

const props = withDefaults(
  defineProps<{
    /** 关键字（v-model）。 */
    keyword: string
    placeholder?: string | undefined
    /** 统计块：筛选栏底部的「数量」清单。 */
    stats?: Array<{ label: string; value: number | string }> | undefined
    loading?: boolean | undefined
    /** 网格为空时的提示。 */
    emptyText?: string | undefined
    /** 卡片最小宽度（px），决定一屏几列。 */
    minCardWidth?: number | undefined
    /** 筛选栏可收起（收起后只剩一条窄轨）。 */
    collapsible?: boolean | undefined
  }>(),
  {
    placeholder: '搜索',
    stats: () => [],
    loading: false,
    emptyText: '还没有内容。',
    minCardWidth: 240,
    collapsible: true,
  },
)

const emit = defineEmits<{ (event: 'update:keyword', value: string): void }>()

const filterOpen = ref(true)

const keyword = computed({
  get: () => props.keyword,
  set: (value: string) => emit('update:keyword', value),
})

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.minCardWidth}px, 1fr))`,
}))
</script>

<template>
  <div class="canvas-gallery">
    <aside class="canvas-gallery__filter" :class="{ 'is-collapsed': !filterOpen }">
      <button
        v-if="collapsible"
        type="button"
        class="canvas-gallery__toggle"
        :title="filterOpen ? '收起筛选' : '展开筛选'"
        @click="filterOpen = !filterOpen"
      >
        <el-icon :size="14"><ArrowRightBold v-if="!filterOpen" /><ArrowLeftBold v-else /></el-icon>
      </button>

      <template v-if="filterOpen">
        <el-input v-model="keyword" size="small" clearable :prefix-icon="Search" :placeholder="placeholder" />
        <div class="canvas-gallery__extra">
          <slot name="filters" />
        </div>
        <div v-if="stats.length" class="canvas-gallery__stats">
          <div v-for="item in stats" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </template>
    </aside>

    <section class="canvas-gallery__main">
      <header v-if="$slots.actions" class="canvas-gallery__actions">
        <slot name="actions" />
      </header>
      <div class="canvas-gallery__grid" :class="{ 'is-loading': loading }" :style="gridStyle">
        <slot />
        <p v-if="!$slots.default" class="canvas-gallery__empty muted">{{ emptyText }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.canvas-gallery { display: flex; flex: 1 1 auto; min-width: 0; min-height: 0; height: 100%; }
.canvas-gallery__filter {
  position: relative; flex: 0 0 210px; width: 210px; min-height: 0;
  display: flex; flex-direction: column; gap: 12px;
  padding: 12px 10px 12px 12px; border-right: 1px solid var(--line);
  background: var(--surface); overflow: auto; transition: width .18s ease, flex-basis .18s ease;
}
.canvas-gallery__filter.is-collapsed { flex-basis: 30px; width: 30px; padding: 8px 4px; overflow: hidden; }
.canvas-gallery__toggle {
  position: absolute; top: 8px; right: 6px; z-index: 2;
  width: 18px; height: 26px; display: grid; place-items: center;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface);
  color: var(--muted); cursor: pointer;
}
.canvas-gallery__toggle:hover { color: var(--brand); border-color: var(--brand); }
.canvas-gallery__extra { display: flex; flex-direction: column; gap: 8px; }
.canvas-gallery__stats {
  margin-top: auto; display: flex; flex-direction: column; gap: 6px;
  border-top: 1px solid var(--line); padding-top: 10px;
}
.canvas-gallery__stats div { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.canvas-gallery__stats span { color: var(--muted); }
.canvas-gallery__stats strong { color: var(--app-text); font-size: 14px; font-variant-numeric: tabular-nums; }
.canvas-gallery__main { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.canvas-gallery__actions {
  display: flex; align-items: center; gap: 8px; flex: none;
  padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--surface);
}
.canvas-gallery__grid {
  flex: 1 1 auto; min-height: 0; overflow: auto;
  display: grid; gap: 14px; align-content: start;
  padding: 14px; overscroll-behavior: contain;
}
.canvas-gallery__grid.is-loading { opacity: .6; }
.canvas-gallery__empty { grid-column: 1 / -1; padding: 40px 0; text-align: center; font-size: 12px; }
</style>
