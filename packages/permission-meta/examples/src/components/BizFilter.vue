<!-- 另一个业务组件：同样黑盒。 -->
<template>
  <div class="filter">
    <label>关键字</label>
    <input v-model="keyword" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const keyword = ref('')
defineExpose({ keyword })
</script>
