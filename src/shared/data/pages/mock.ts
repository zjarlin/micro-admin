// 浏览器端页面后端：把通用引擎接到 localStorage 上。
//
// 只有这两件事和「真实后端」不同：存储介质、HTTP 传输。
// schema 注册表、查询/分页/校验/唯一性、树筛选，全部走 `createPageEngine` 的同一份实现。
import { createPageEngine, type PageData, type PageEngine, type PageStore } from '../engine.ts'
import { seedPages } from '../seed.ts'
import { PAGE_SCHEMA_VERSION, pageRegistry } from './registry.ts'

const STORAGE_KEY = 'micro-admin.pages.v2'

function createLocalStore(): PageStore {
  return {
    read(): PageData {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return JSON.parse(raw) as PageData
      } catch {
        // 本地演示数据损坏不能阻塞页面，直接回落到种子。
      }
      return {}
    },
    write(data: PageData): void {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    },
  }
}

/** 清空演示数据，下次进入页面时重新种入。 */
export function resetPagesMock(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function createPagesEngine(): PageEngine {
  return createPageEngine({
    registry: pageRegistry,
    version: PAGE_SCHEMA_VERSION,
    store: createLocalStore(),
    seed: seedPages,
  })
}
