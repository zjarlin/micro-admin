import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const collapsed = ref(localStorage.getItem('micro-admin.sidebar') === 'collapsed')
  const dark = ref(localStorage.getItem('micro-admin.dark') === '1')

  function toggleSidebar(): void {
    collapsed.value = !collapsed.value
    localStorage.setItem('micro-admin.sidebar', collapsed.value ? 'collapsed' : 'expanded')
  }

  function toggleDark(): void {
    dark.value = !dark.value
    localStorage.setItem('micro-admin.dark', dark.value ? '1' : '0')
    document.documentElement.classList.toggle('dark', dark.value)
  }

  function apply(): void {
    document.documentElement.classList.toggle('dark', dark.value)
  }

  return { collapsed, dark, toggleSidebar, toggleDark, apply }
})
