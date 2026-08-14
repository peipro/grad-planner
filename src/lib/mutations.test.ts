// Phase 1B-1 · sync-adapter mutation 集成测试（真实 persist payload）
// 关键原则（docs L 与 §19）：禁止"测试 mock 裸 AppState 而生产用 {state,version}"的格式分裂。
// 本测试全部使用真实 zustand persist 格式：JSON.stringify({ state, version: 0 })。
// sync-adapter 用 new Function 加载（与生产 <script> 加载一致，防止 vite 转换破坏 IIFE 语义）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { useStore } from '../store'
import { refreshFromAuthority, REFRESH_ON_ERROR, mergeAuthoritativeState, applyAuthoritativeState } from './mutations'

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

let mockCalls: any[][]  // IPC 契约：syncMutate 收到 Mutation[] 数组
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
    syncMutate: async (payload: unknown) => {
      // 模拟真实 main.cjs 的 sync-mutate 校验（IPC 契约：Mutation[]，禁止对象包装——与生产一致）
      if (!Array.isArray(payload)) return { ok: false, error: 'invalid_mutation', detail: 'mutations 必须是数组' }
      mockCalls.push(payload as any)
      return mockResult
    },
  }
  restoreNativeStorage()
  loadAdapter()
  // hydration：建立权威 baseState
  await window.localStorage.getItem(SYNC_KEY)
  mockCalls.length = 0
})

afterEach(async () => {
  // 排空上一测试可能遗留的 sync-adapter 节流 timer（旧实例闭包跨测试无法直接清除）：
  // 触发 flush + 等待一个节流周期，避免旧实例异步提交污染下一测试的 mockCalls
  window.dispatchEvent(new Event('pagehide'))
  await new Promise((r) => setTimeout(r, 320))
})

describe('sync-adapter mutation（真实 {state, version} payload）', () => {
  it('task.create → 提交正确的 mutation（diff 基于权威 baseState）', async () => {
    const next = { tasks: [makeTask('t1')], notes: [], pomo: { running: false } }
    window.localStorage.setItem(SYNC_KEY, persistStr(next))
    await flushAndWait()
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]).toEqual([{ type: 'task.create', payload: makeTask('t1') }])
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
    expect(mockCalls[0]).toEqual([
      { type: 'task.update', id: 't1', entity: makeTask('t1', { title: 'T1 updated' }), baseVersion: 1 },
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
    expect(mockCalls[0]).toEqual([{ type: 'task.delete', id: 't1', baseVersion: 1 }])
  })

  it('note.create / note.update / note.delete 同样成立', async () => {
    // create
    const next1 = { tasks: [], notes: [makeNote('n1')], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next1))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'note.create', payload: makeNote('n1') }])
    mockCalls.length = 0
    // update
    const next2 = { tasks: [], notes: [makeNote('n1', { content: 'changed' })], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next2))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([
      { type: 'note.update', id: 'n1', entity: makeNote('n1', { content: 'changed' }), baseVersion: 1 },
    ])
    mockCalls.length = 0
    // delete
    const next3 = { tasks: [], notes: [], pomo: {} }
    window.localStorage.setItem(SYNC_KEY, persistStr(next3))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'note.delete', id: 'n1', baseVersion: 1 }])
  })

  it('连续 setItem 合并：提交只保留最新全量 diff（不重复提交）', async () => {
    // 第一次 setItem（未到 300ms 节流）
    window.localStorage.setItem(SYNC_KEY, persistStr({ tasks: [makeTask('t1')], notes: [], pomo: {} }))
    // 第二次 setItem（覆盖 pending）
    window.localStorage.setItem(SYNC_KEY, persistStr({ tasks: [makeTask('t1'), makeTask('t2')], notes: [], pomo: {} }))
    await flushAndWait()
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]).toEqual([
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
    expect(mockCalls[0]).toEqual([
      { type: 'task.update', id: 't1', entity: makeTask('t1', { title: 'v2' }), baseVersion: 1 },
    ])
  })

  // ===== Phase 1B-3A：通用实体 diff =====

  it('event 变更 → event.create / update / delete（真实 payload）', async () => {
    const ev = (id: string, o: Record<string, unknown> = {}) => ({ id, title: `Event ${id}`, start: 'x', end: 'y', type: 'meeting' as const, ...o })
    // create
    window.localStorage.setItem(SYNC_KEY, persistStr({ events: [ev('e1')], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'event.create', payload: ev('e1') }])
    mockCalls.length = 0
    // update
    ;(window as any).electronAPI.syncStorageGet = async () => ({
      found: true, data: persistStr({ events: [ev('e1')], pomo: {} }),
    })
    await window.localStorage.getItem(SYNC_KEY)
    mockCalls.length = 0
    window.localStorage.setItem(SYNC_KEY, persistStr({ events: [ev('e1', { title: 'E1 改了' })], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'event.update', id: 'e1', entity: ev('e1', { title: 'E1 改了' }), baseVersion: 1 }])
    mockCalls.length = 0
    // delete
    window.localStorage.setItem(SYNC_KEY, persistStr({ events: [], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'event.delete', id: 'e1', baseVersion: 1 }])
  })

  it('project 变更 → project.create；含关联 task 的 project.delete → project.delete + task.update（engine 侧事务保护）', async () => {
    const proj = (id: string) => ({ id, name: `Project ${id}`, color: 'blue' })
    const task = (id: string, projectId: string | undefined) => ({ id, title: `Task ${id}`, priority: 'medium', status: 'todo', createdAt: 'x', ...(projectId ? { projectId } : {}) })
    // 权威：project p1 + task t1（属于 p1）
    ;(window as any).electronAPI.syncStorageGet = async () => ({
      found: true, data: persistStr({ projects: [proj('p1')], tasks: [task('t1', 'p1')], pomo: {} }),
    })
    await window.localStorage.getItem(SYNC_KEY)
    mockCalls.length = 0
    // renderer 删除 project（store deleteProject 联动 tasks.projectId 清空）
    window.localStorage.setItem(SYNC_KEY, persistStr({ projects: [], tasks: [task('t1', undefined)], pomo: {} }))
    await flushAndWait()
    // diff 生成 project.delete + task.update（task 仅 projectId 变化）
    // engine 预扫描 project.delete → 该 task 的过期 update 被跳过（权威侧解引用）
    expect(mockCalls[0]).toEqual([
      { type: 'task.update', id: 't1', entity: task('t1', undefined), baseVersion: 1 },
      { type: 'project.delete', id: 'p1', baseVersion: 1 },
    ])
  })

  it('paperStages 变化 → paperStages.replace（整组）', async () => {
    window.localStorage.setItem(SYNC_KEY, persistStr({ paperStages: ['阶段0', '阶段1'], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'paperStages.replace', payload: ['阶段0', '阶段1'] }])
  })

  it('多实体同时变化 → 一个 batch 提交所有 mutation', async () => {
    const ev = { id: 'e1', title: 'E1', start: 'x', end: 'y', type: 'meeting' as const }
    const hab = { id: 'h1', name: 'H1', emoji: 'e', weeklyTarget: 3, records: [] as string[], createdAt: 'x' }
    window.localStorage.setItem(SYNC_KEY, persistStr({ events: [ev], habits: [hab], pomo: {} }))
    await flushAndWait()
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0]).toEqual([
      { type: 'event.create', payload: ev },
      { type: 'habit.create', payload: hab },
    ])
  })

  // ===== Phase 1B-3A-2：剩余实体 diff（真实 payload） =====

  it('paper 变更 → paper.create / update / delete', async () => {
    const paper = (id: string, o: Record<string, unknown> = {}) => ({ id, title: `P${id}`, stage: '未分类', category: 'x', status: 'unread' as const, createdAt: 'x', ...o })
    window.localStorage.setItem(SYNC_KEY, persistStr({ papers: [paper('pa1')], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'paper.create', payload: paper('pa1') }])
    mockCalls.length = 0
    ;(window as any).electronAPI.syncStorageGet = async () => ({ found: true, data: persistStr({ papers: [paper('pa1')], pomo: {} }) })
    await window.localStorage.getItem(SYNC_KEY)
    mockCalls.length = 0
    window.localStorage.setItem(SYNC_KEY, persistStr({ papers: [paper('pa1', { status: 'reading' })], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'paper.update', id: 'pa1', entity: paper('pa1', { status: 'reading' }), baseVersion: 1 }])
  })

  it('milestone 变更 → milestone.create（含 checkpoints 变化 → update）', async () => {
    const ms = (id: string, o: Record<string, unknown> = {}) => ({ id, title: `M${id}`, startDate: 'a', endDate: 'b', progress: 0, color: 'blue', ...o })
    window.localStorage.setItem(SYNC_KEY, persistStr({ milestones: [ms('m1')], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'milestone.create', payload: ms('m1') }])
    mockCalls.length = 0
    ;(window as any).electronAPI.syncStorageGet = async () => ({ found: true, data: persistStr({ milestones: [ms('m1')], pomo: {} }) })
    await window.localStorage.getItem(SYNC_KEY)
    mockCalls.length = 0
    window.localStorage.setItem(SYNC_KEY, persistStr({ milestones: [ms('m1', { progress: 60, checkpoints: [{ id: 'c1', title: 'cp', done: true }] })], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'milestone.update', id: 'm1', entity: ms('m1', { progress: 60, checkpoints: [{ id: 'c1', title: 'cp', done: true }] }), baseVersion: 1 }])
  })

  it('birthday / pomodoro 变更 → 正确 mutation', async () => {
    const bd = { id: 'b1', name: 'B1', calendarType: 'solar' as const, solarMonth: 1, solarDay: 1, emoji: 'e', createdAt: 'x' }
    window.localStorage.setItem(SYNC_KEY, persistStr({ birthdays: [bd], pomodoros: [], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([{ type: 'birthday.create', payload: bd }])
    mockCalls.length = 0
    // 删除生日 + 新增番茄钟（多实体一个 batch）
    const po = { id: 'po1', taskTitle: 'PT', minutes: 25, completedAt: 'c' }
    window.localStorage.setItem(SYNC_KEY, persistStr({ birthdays: [], pomodoros: [po], pomo: {} }))
    await flushAndWait()
    expect(mockCalls[0]).toEqual([
      { type: 'pomodoro.create', payload: po },
      { type: 'birthday.delete', id: 'b1', baseVersion: 1 },
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

// ===== Phase 1B-2: State Sync（Main → Renderer 就地更新） =====

describe('mergeAuthoritativeState（区分 authoritative 与 renderer-only）', () => {
  it('authoritative 实体字段覆盖 current；renderer-only 字段保留（§14）', () => {
    useStore.setState({
      tasks: [makeTask('old')],
      notes: [makeNote('n1', { title: '本地草稿相关' })],
      activeView: 'notes',
      pomo: { mode: 'countdown', focusMin: 25, breakMin: 5, remaining: 900, running: true, phase: 'focus', taskTitle: 'x', swSec: 12, swRunning: true, endAt: 9999 },
      newsConfig: { xKey: 'secret-in-memory', xSecret: 's', includeX: false, rssKeys: null, includeHot: true },
    } as any)
    const authority = {
      tasks: [makeTask('server', { title: '权威任务' })],
      notes: [makeNote('n1', { title: '服务端 Note' })],
      activeView: 'todo',
      pomo: { mode: 'stopwatch', focusMin: 50, remaining: 42, running: false },
      newsConfig: { xKey: '', xSecret: '', includeX: true, rssKeys: ['x'], includeHot: false },
    }
    const merged = mergeAuthoritativeState(authority, useStore.getState())
    // 实体字段来自权威
    expect(merged.tasks.map((t) => t.id)).toEqual(['server'])
    expect(merged.notes[0].title).toBe('服务端 Note')
    // renderer-only 保留
    expect(merged.activeView).toBe('notes')
    expect(merged.pomo.running).toBe(true)          // 番茄钟运行不被打断
    expect(merged.pomo.remaining).toBe(900)
    expect(merged.pomo.swSec).toBe(12)
    expect(merged.newsConfig.xKey).toBe('secret-in-memory') // 内存密钥不被清
  })

  it('配置字段（theme/reminders）来自权威', () => {
    useStore.setState({ theme: { mode: 'light', accent: 'blue' } } as any)
    const merged = mergeAuthoritativeState({ theme: { mode: 'dark', accent: 'green' } }, useStore.getState())
    expect(merged.theme).toEqual({ mode: 'dark', accent: 'green' })
  })

  it('milestones 自愈（与 persist merge 同语义）', () => {
    const merged = mergeAuthoritativeState({ milestones: [{ title: 'm1' }] }, useStore.getState())
    expect(merged.milestones.length).toBe(1)
    expect(typeof merged.milestones[0].id).toBe('string')
  })
})

describe('applyAuthoritativeState（state-sync 应用路径）', () => {
  it('应用权威 state 到 store（等价 Test A：Main mutation → state-sync → renderer 更新）', () => {
    useStore.setState({ tasks: [], notes: [] } as any)
    applyAuthoritativeState({ tasks: [makeTask('synced', { title: '从主进程同步' })], notes: [], paperStages: [] })
    const st = useStore.getState()
    expect(st.tasks.length).toBe(1)
    expect(st.tasks[0].title).toBe('从主进程同步')
  })

  it('防循环（Test F）：state-sync 应用后 persist 不产生 mutation 提交', async () => {
    // 准备：sync-adapter 已加载（beforeEach），mock syncMutate 记录调用
    useStore.setState({ tasks: [], notes: [] } as any)
    // 模拟 Main 广播权威 state（含 task t1）
    applyAuthoritativeState({ tasks: [makeTask('t1')], notes: [], paperStages: [] })
    // applyAuthoritativeState → setState → persist setItem → sync-adapter diff（基准已被标记）→ 不应提交
    expect(mockCalls).toHaveLength(0)
    // 稍等（模拟节流窗口）仍无提交
    await new Promise((r) => setTimeout(r, 20))
    expect(mockCalls).toHaveLength(0)
    // 但 store 已更新（用户看到了新数据）
    expect(useStore.getState().tasks.length).toBe(1)
  })

  it('state-sync 应用后，用户新操作仍能正常提交（diff 基准正确）', async () => {
    useStore.setState({ tasks: [], notes: [] } as any)
    applyAuthoritativeState({ tasks: [makeTask('t1')], notes: [], paperStages: [] })
    expect(mockCalls).toHaveLength(0)
    // 用户新增 task t2 → 应提交 create t2（不含 t1，避免重复 create）
    const cur = useStore.getState()
    useStore.setState({ tasks: [...cur.tasks, makeTask('t2')] } as any) // 触发 persist setItem
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => { expect(mockCalls.length).toBeGreaterThanOrEqual(1) })
    const ids = mockCalls[0].map((m: any) => m.id || (m.payload && m.payload.id))
    expect(ids).toEqual(['t2']) // 只提交新变化，不重放权威数据
  })

  it('非法 state 输入 → 忽略（不破坏 store）', () => {
    useStore.setState({ tasks: [makeTask('keep')] } as any)
    applyAuthoritativeState(null as any)
    applyAuthoritativeState('nope' as any)
    expect(useStore.getState().tasks.length).toBe(1)
  })
})

