<!--
  示例页面：把两种标记场景一次演完。

  场景 A —— 页面内就地区块：直接给原生容器写 v-meta，不抽组件。
  场景 B —— 独立业务组件：给组件标签写 v-meta，插件按黑盒只记一个节点。
  另外演示 v-meta:id 固定 id、v-if/v-for、以及黑名单标签显式标记这几种边界。
-->
<template>
  <main class="page">
    <!-- 场景 A：页面就地区块，带名称/描述/分组 -->
    <div v-meta="{ name: '查询区域', desc: '关键字与筛选条件', group: 'query' }" class="block">
      <el-input v-model="keyword" placeholder="关键字" />

      <!-- 场景 B：业务组件（黑盒），裸标记，靠兜底 id -->
      <BizAddBtn v-meta />

      <!-- 场景 B：同一个业务组件用显式 id 固定身份 -->
      <BizFilter v-meta:id="biz_filter_area" />

      <!-- 黑名单原生标签显式写 v-meta：允许采集，用于页面就地区块 -->
      <span v-meta="{ name: '提示语', desc: '查询区里的内联提示', group: 'query' }">按下回车搜索</span>
    </div>

    <!-- 场景 A：另一块区块，children 由「最近的标记后代」决定 -->
    <section class="block">
      <div v-meta="{ name: '结果区域', desc: '列表与状态', group: 'result' }">
        <!-- 没有 v-meta 的原生容器是透明的，会被穿透，不会孤立子块 -->
        <template v-if="rows.length > 0">
          <el-table :data="rows" v-meta="{ name: '结果表格', group: 'result' }" />
        </template>

        <!-- 黑名单组件 el-tag：默认不采集；显式写 v-meta 才进元树 -->
        <el-tag v-meta:id="status_tag" type="success">已启用</el-tag>

        <!-- v-for：模板里只有一个定义，循环实例复用同一个 metaId -->
        <li v-for="row in rows" :key="row.id" v-meta="{ name: '结果行', group: 'result' }">
          <b v-meta>{{ row.title }}</b>
        </li>
      </div>
    </section>

    <!-- 配套指令：编译期把 metaId 静态写进参数，运行期只查授权集合 -->
    <div class="block" v-meta:id="admin_area" v-permission-meta>
      <span>仅管理员可见区块</span>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import BizAddBtn from './components/BizAddBtn.vue'
import BizFilter from './components/BizFilter.vue'

const keyword = ref('')
const rows = ref([
  { id: 1, title: '第一条' },
  { id: 2, title: '第二条' },
])
</script>

<style scoped>
.page {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.block {
  padding: 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
}
</style>
