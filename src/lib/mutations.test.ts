// Phase 1B-1 · sync-adapter mutation 集成测试（真实 persist payload）
// 关键原则（docs L 与 §19）：禁止"测试 mock 裸 AppState 而生产用 {state,version}"的格式分裂。
// 本测试全部使用真实 zustand persist 格式：JSON.stringify({ state, version: 0 })。
// sync-adapter 用 new Function 加载（与生产 <script> 加载一致，防止 vite 转换破坏 IIFE 语义）。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { useStore } from '../store'
import { refreshFromAuthority, REFRESH_ON_ERROR } from './mutations'

const SYNC_KEY = 'grad-planner-storage'

function loadAdapter() {
  // 注意：必须用变量传路径，vite 会静态重写 new URL(字面量, import.meta.url) 为 dev server URL
  const rel = '../../public/sync-adapter.js'
  const src = readFileSync(new URL(rel, import.meta.url), 'utf-8')
  new Function(src)()
}

// 真实 persist 序列化
const persistStr = (state: unknown) => JSON.stringify({ state, version: 0 })

function makeTask(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, title: `Task ${id}`, priority: 'medium', status: 'todo',
    createdAt: '2026-08-14T00:00:00.000Z', ...overrides,
  }
}

function makeNote(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, title: `Note ${id}`, content: 'c', tags: [],
    createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', ...overrides,
  }
}

// 触发 sync-adapter 的 pagehide flush 并等待提交完成
async function flushAndWait() {
  window.dispatchEvent(new Event('pagehide'))
  await vi.waitFor(() => { expect(mockCalls.length).toBeGreaterThanOrEqual(1) })
}

let mockCalls: Array<{ mutations: unknown[] }>
let mockResult: any

// 原生 Storage 方法（模块首次加载时捕获，未被 patch 污染）
let ORIG_STORAGE: { getItem: any; setItem: any; removeItem: any } | null = null

function restoreNativeStorage() {
  if (!ORIG_STORAGE) {
    ORIG_STORAGE = {
      getItem: Storage.prototype.getItem,
      setItem: Storage.prototype.setItem,
      removeItem: Storage.prototype.removeItem,
    }
  }
  Storage.prototype.getItem = ORIG_STORAGE.getItem
  Storage.prototype.setItem = ORIG_STORAGE.setItem
  Storage.prototype.removeItem = ORIG_STORAGE.removeItem
  // 清除实例上可能被 sync-adapter 直接赋值的遮蔽属性
  const inst = window.localStorage as any
  delete inst.getItem
  delete inst.setItem
  delete inst.removeItem
}

beforeEach(async () => {
  mockCalls = []
  mockResult = { ok: true, results: [] }
  window.localStorage.clear()
  ;(window as any).electronAPI = {
    syncStorageGet: async () => ({ found: true, data: persistStr({ tasks: [], notes: [], pomo: { running: false } }) }),
    syncStorageSet: async () => ({ ok: true }),
    syncStorageRemove: async () => ({ ok: true }),
    syncMutate: async (payload: unknown) => { mockCalls.push(payload as any); return mockResult },
  }
  restoreNativeStorage()
  loadAdapter()
  // hydration：建立权威 baseState
  await window.localStorage.getItem(SYNC_KEY)
  mockCalls.length = 0
})

describe('sync-adapter mutation（真实 {state, version} payload）', () => {
  it('task.create → 提交正确的 mutation（diff 基于权威 baseState）', async () => {
    const next = { tasks: [makeTask('t1')], notes: [], pomo: { running: false } }
    window.localStorage.setItem(SYNC_KEY, persistStr(next))
    await flushAndWait()
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0].mutations).toEqual([{ type: 'task.create', payload: makeTask('t1') }])
  })

  it('task.update（同 id 内容变化）→ task.update 全量实体', async () => {
    ;(window as any).electronAPI.syncStorageGet = async () => ({
      found: true,
      data: persistStr({ tasks: [makeTask('t1')], notes: [], pomo: {} }),
    })
    await window.localStorage.getItem(SYNC_KEY) // 重新 hydration（baseState 含 t1）
    mockCalls.length = 0
    const next = { tasks: [makeTask('t1', { title: 'T1 updated' })], notes: [], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next))
    await flushAndWait()
    expect(mockCalls[0].mutations).toEqual([
      { type: 'task.update', id: 't1', entity: makeTask('t1', { title: 'T1 updated' }) },
    ])
  })

  it('task.delete → task.delete', async () => {
    ;(window as any).electronAPI.syncStorageGet = async () => ({
      found: true,
      data: persistStr({ tasks: [makeTask('t1')], notes: [], pomo: {} }),
    })
    await window.localStorage.getItem(SYNC_KEY)
    mockCalls.length = 0
    const next = { tasks: [], notes: [], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next))
    await flushAndWait()
    expect(mockCalls[0].mutations).toEqual([{ type: 'task.delete', id: 't1' }])
  })

  it('note.create / note.update / note.delete 同样成立', async () => {
    // create
    const next1 = { tasks: [], notes: [makeNote('n1')], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next1))
    await flushAndWait()
    expect(mockCalls[0].mutations).toEqual([{ type: 'note.create', payload: makeNote('n1') }])
    mockCalls.length = 0
    // update
    const next2 = { tasks: [], notes: [makeNote('n1', { content: 'changed' })], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next2))
    await flushAndWait()
    expect(mockCalls[0].mutations).toEqual([
      { type: 'note.update', id: 'n1', entity: makeNote('n1', { content: 'changed' }) },
    ])
    mockCalls.length = 0
    // delete
    const next3 = { tasks: [], notes: [], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next3))
    await flushAndWait()
    expect(mockCalls[0].mutations).toEqual([{ type: 'note.delete', id: 'n1' }])
  })

  it('连续 setItem 合并：提交只保留最新全量 diff（不重复提交）', async () => {
    // 第一次 setItem（未到 300ms 节流）
    window.localStorage.setItem(SYNC_KEY, persistStr({ tasks: [makeTask('t1')], notes: [], pomo: {} }))
    // 第二次 setItem（覆盖 pending）
    window.localStorage.setItem(SYNC_KEY, persistStr({ tasks: [makeTask('t1'), makeTask('t2')], notes: [], pomo: {} }))
    await flushAndWait()
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0].mutations).toEqual([
      { type: 'task.create', payload: makeTask('t1') },
      { type: 'task.create', payload: makeTask('t2') },
    ])
  })

  it('非 Task/Note 字段变化（如番茄钟 setPomodoro）→ 不产生 mutation、不上传', async () => {
    ;(window as any).electronAPI.syncStorageGet = async () => ({
      found: true,
      data: persistStr({ tasks: [makeTask('t1')], notes: [], pomo: { running: false } }),
    })
    await window.localStorage.getItem(SYNC_KEY)
    mockCalls.length = 0
    // 只有 pomo 变化（任务/笔记未变）
    const next = { tasks: [makeTask('t1')], notes: [], pomo: { running: true, remaining: 100 } }
    window.localStorage.setItem(SYNC_KEY, persistStr(next))
    // 不触发 flush（pending 为空）——即使触发也无提交
    window.dispatchEvent(new Event('pagehide'))
    await new Promise((r) => setTimeout(r, 20))
    expect(mockCalls).toHaveLength(0)
  })

  it('本地缓存兜底：setItem 后 localStorage 保留真实 payload（离线 hydration 可用）', () => {
    const state = { tasks: [makeTask('t1')], notes: [], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(state))
    // 用原生 getItem 读取真实缓存（patch 后的 getItem 走远端）
    const cached = (ORIG_STORAGE!.getItem.call(window.localStorage, SYNC_KEY)) as string
    expect(JSON.parse(cached)).toEqual({ state, version: 0 })
  })

  it('提交成功 → 基准推进（下一次 diff 基于新权威）', async () => {
    window.localStorage.setItem(SYNC_KEY, persistStr({ tasks: [makeTask('t1')], notes: [], pomo: {} }))
    await flushAndWait() // 提交成功
    mockCalls.length = 0
    // 再改 t1 标题 → 应只产生 update（而非 create + update）
    const next = { tasks: [makeTask('t1', { title: 'v2' })], notes: [], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next))
    await flushAndWait()
    expect(mockCalls[0].mutations).toEqual([
      { type: 'task.update', id: 't1', entity: makeTask('t1', { title: 'v2' }) },
    ])
  })
})

describe('mutation 失败分类（L4：不搞一刀切 refresh）', () => {
  it('validation_failure → dispatch sync-mutation-failed，detail.error 正确', async () => {
    const errors: string[] = []
    window.addEventListener('sync-mutation-failed', (e) => {
      errors.push(((e as CustomEvent).detail || {}).error)
    })
    mockResult = { ok: false, error: 'validation_failure', detail: 'title 非法' }
    window.localStorage.setItem(SYNC_KEY, persistStr({ tasks: [makeTask('t1')], notes: [], pomo: {} }))
    await flushAndWait()
    expect(errors).toEqual(['validation_failure'])
  })

  it('persistence_failure → dispatch persistence_failure（App 层据此 refresh）', async () => {
    const errors: string[] = []
    window.addEventListener('sync-mutation-failed', (e) => {
      errors.push(((e as CustomEvent).detail || {}).error)
    })
    mockResult = { ok: false, error: 'persistence_failure', detail: 'disk full' }
    window.localStorage.setItem(SYNC_KEY, persistStr({ tasks: [makeTask('t1')], notes: [], pomo: {} }))
    await flushAndWait()
    expect(errors).toEqual(['persistence_failure'])
  })

  it('REFRESH_ON_ERROR 只包含 persistence_failure（其余错误不刷新整个 state）', () => {
    expect([...REFRESH_ON_ERROR]).toEqual(['persistence_failure'])
    expect(REFRESH_ON_ERROR.has('validation_failure')).toBe(false)
    expect(REFRESH_ON_ERROR.has('entity_not_found')).toBe(false)
    expect(REFRESH_ON_ERROR.has('invalid_mutation')).toBe(false)
    expect(REFRESH_ON_ERROR.has('network_error')).toBe(false)
    expect(REFRESH_ON_ERROR.has('internal_error')).toBe(false)
  })
})

describe('refreshFromAuthority', () => {
  it('从权威（IPC）重新拉取并覆盖 store', async () => {
    useStore.setState({ tasks: [makeTask('local', { title: '本地乐观' })], notes: [] } as any)
    ;(window as any).electronAPI.syncStorageGet = async () => ({
      found: true,
      data: persistStr({ tasks: [makeTask('authority', { title: '权威' })], notes: [], pomo: {} }),
    })
    const ok = await refreshFromAuthority()
    expect(ok).toBe(true)
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['authority'])
    expect(useStore.getState().tasks[0].title).toBe('权威')
  })

  it('权威不可用（not found）→ 返回 false，不覆盖本地', async () => {
    useStore.setState({ tasks: [makeTask('keep')] } as any)
    ;(window as any).electronAPI.syncStorageGet = async () => ({ found: false, data: null })
    const ok = await refreshFromAuthority()
    expect(ok).toBe(false)
    expect(useStore.getState().tasks.map((t) => t.id)).toEqual(['keep'])
  })
})
