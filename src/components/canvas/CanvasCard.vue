<script setup lang="ts">
// 画布类卡片：缩略图 + 标题 + 元信息 + 一排动作。
//
// 画面库与图纸库的卡片完全同构，只是缩略图/角标不同，所以合成一个组件：
// 各页面只提供数据与动作插槽，不再各自维护一份卡片样式（这正是「同一件事写三处」的来源）。
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    /** 标题右侧的版本号之类。 */
    badge?: string | undefined
    description?: string | null | undefined
    /** 缩略图 SVG（直接 v-html）。 */
    svg?: string | undefined
    /** 缩略图区域底色，深浅两套主题下都要能看清线框。 */
    thumbBackground?: string | undefined
    /** 左下角角标（图元数 / 元素数）。 */
    footnote?: string | undefined
    /** 左上角状态角标：`ok` 绿、`warn` 红、`info` 蓝；不传就不显示。 */
    status?: { text: string; tone: 'ok' | 'warn' | 'info' } | undefined
    /** 一行补充信息（页面 key 之类）。 */
    meta?: string | undefined
  }>(),
  { thumbBackground: '#0b1220' },
)

const emit = defineEmits<{ (event: 'open'): void }>()

const toneClass = computed(() => (props.status ? `is-${props.status.tone}` : ''))
</script>

<template>
  <article class="canvas-card">
    <button type="button" class="canvas-card__thumb" :style="{ background: thumbBackground }" @click="emit('open')">
      <span v-if="!svg" class="canvas-card__empty muted">生成中…</span>
      <span v-else class="canvas-card__svg" v-html="svg" />
      <span v-if="footnote" class="canvas-card__foot">{{ footnote }}</span>
      <span v-if="status" class="canvas-card__status" :class="toneClass">{{ status.text }}</span>
    </button>
    <div class="canvas-card__meta">
      <div class="canvas-card__head">
        <strong :title="title">{{ title }}</strong>
        <span v-if="badge" class="muted">{{ badge }}</span>
      </div>
      <p class="muted canvas-card__desc">{{ description || '未填写描述' }}</p>
      <p v-if="meta || $slots.meta" class="canvas-card__extra">
        <slot name="meta">{{ meta }}</slot>
      </p>
      <div class="canvas-card__actions">
        <slot name="actions" />
      </div>
    </div>
  </article>
</template>

<style scoped>
.canvas-card {
  display: flex; flex-direction: column; overflow: hidden; min-width: 0;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  transition: border-color .15s ease, transform .15s ease;
}
.canvas-card:hover { border-color: rgba(99, 102, 241, .5); transform: translateY(-2px); }
.canvas-card__thumb {
  position: relative; display: flex; align-items: center; justify-content: center;
  padding: 0; border: 0; aspect-ratio: 4 / 3; cursor: pointer; overflow: hidden;
}
.canvas-card__svg { display: block; width: 100%; height: 100%; }
.canvas-card__svg :deep(svg) { width: 100%; height: 100%; display: block; }
.canvas-card__empty { font-size: 12px; }
.canvas-card__foot {
  position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px;
  background: rgba(15, 23, 42, .78); color: #cbd5e1; font-size: 11px;
}
.canvas-card__status {
  position: absolute; left: 8px; top: 8px; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; border: 1px solid transparent;
}
.canvas-card__status.is-ok { background: rgba(34, 197, 94, .2); border-color: rgba(34, 197, 94, .55); color: #15803d; }
.canvas-card__status.is-warn { background: rgba(248, 113, 113, .2); border-color: rgba(248, 113, 113, .6); color: #b91c1c; }
.canvas-card__status.is-info { background: rgba(56, 189, 248, .18); border-color: rgba(56, 189, 248, .5); color: #0369a1; }
.canvas-card__meta { display: flex; flex-direction: column; gap: 5px; padding: 10px 12px 8px; min-width: 0; }
.canvas-card__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.canvas-card__head strong { font-size: 13px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.canvas-card__head .muted { font-size: 11px; flex: none; }
.canvas-card__desc {
  margin: 0; font-size: 12px; line-height: 1.5; min-height: 18px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.canvas-card__extra { margin: 0; font-size: 11px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.canvas-card__extra :deep(code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.canvas-card__actions { display: flex; align-items: center; justify-content: flex-end; gap: 0; min-height: 26px; }
</style>
