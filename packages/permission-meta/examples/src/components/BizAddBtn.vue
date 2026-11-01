<!--
  独立业务组件（场景 B）：内部封装了 el-button。
  它作为黑盒参与元树——插件只记它自身一个节点，不会打开本文件、也不会把
  这里的 el-button 或下面的 v-meta 扫进页面那棵树。
-->
<template>
  <el-button type="primary" @click="$emit('click')">
    <slot>新增</slot>
  </el-button>
</template>

<script setup lang="ts">
defineEmits<{ click: [] }>()
</script>
