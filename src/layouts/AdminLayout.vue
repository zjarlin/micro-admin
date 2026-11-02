<script setup lang="ts">
// 外壳宿主：把「外壳长什么样」交给图纸（`/shell/config`），本文件不再写死模板。
//
// 之前这个文件里有 248px 侧栏、76px 顶栏、图标行与用户区的全部标记；现在它们都在
// `ShellFrame.vue` 里按后端下发的 `ShellSchema` 渲染，本文件只做两件事：
// 1. 应用启动时确保外壳已加载（登录页之外的首屏都要读它）；
// 2. 把路由页面塞进外壳的内容区插槽。
//
// 于是「改外壳」= 外壳设计器里改图纸 + 发布，不需要碰这个文件，也不需要发版。
import { onMounted, ref } from 'vue'
import { useShellStore } from '@/stores/shell'
import ShellFrame from '@/components/shell/ShellFrame.vue'

const shell = useShellStore()
const booted = ref(false)

onMounted(async () => {
  // 外壳读取失败也有内置兜底（store 里保证），因此这里只控制骨架屏的时机。
  await shell.ensure()
  booted.value = true
})
</script>

<template>
  <ShellFrame>
    <router-view v-slot="{ Component, route }">
      <transition name="page-fade" mode="out-in">
        <component :is="Component" v-if="booted" :key="route.path" />
        <div v-else class="page-skeleton">
          <el-skeleton :rows="5" animated />
        </div>
      </transition>
    </router-view>
  </ShellFrame>
</template>

<style scoped>
.page-skeleton {
  background: var(--surface);
  padding: 24px;
  border-radius: 16px;
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity .16s ease, transform .16s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.page-fade-leave-to {
  opacity: 0;
}
</style>
