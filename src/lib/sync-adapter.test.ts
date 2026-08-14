import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// sync-adapter 集成测试（jsdom）：验证客户端提交语义。
// 注意：sync-adapter/sync-core 为 IIFE/UMD 脚本，vite 转换会破坏 UMD 全局挂载，
// 测试用 new Function 模拟浏览器 <script> 加载（与生产加载方式一致）。

const SYNC_KEY = 'grad-planner-storage'

function evalBrowserScript(relPath: string) {
  const src = readFileSync(new URL(relPath, import.meta.url), 'utf-8')
  new Function(src)()
}

function loadAdapter() {
  evalBrowserScript('../../public/sync-core.js')
  evalBrowserScript('../../public/sync-adapter.js')
}

describe('sync-adapter（Phase 1B 客户端提交语义）', () => {
  let calls: any[]
  let submitSeq: number

  beforeEach(async () => {
    calls = []
    submitSeq = 0
    window.localStorage.clear()
    ;(window as any).electronAPI = {
      syncStorageGet: async () => ({ found: true, data: JSON.stringify({ tasks: [{ id: 't1', title: 'A' }] }), revision: 3, deviceId: 'desktop-1' }),
      syncStorageSet: async (submit: any) => { calls.push(submit); submitSeq += 1; return { ok: true, revision: 10 + submitSeq } },
      syncStorageRemove: async () => ({ ok: true }),
    }
    loadAdapter()
  })

  it('完整客户端流程：GET 记录 revision → setItem 构造 submit → 串行提交 → 409 冲突事件 → 删除 diff', async () => {
    const flush = () => (window as any).__gradSyncFlush()

    // 1. GET：返回 data，记录服务端 revision
    const value = await window.localStorage.getItem(SYNC_KEY)
    expect(value).toBe(JSON.stringify({ tasks: [{ id: 't1', title: 'A' }] }))
    expect((window as any).__gradSyncKnownRevision()).toBe(3)

    // 2. 修改 t1：submit 携带 expectedRevision=3 / deviceId / data
    await flush()
    calls.length = 0
    window.localStorage.setItem(SYNC_KEY, JSON.stringify({ tasks: [{ id: 't1', title: 'A2' }] }))
    await flush()
    const s1 = calls[0]
    expect(s1).toBeTruthy()
    expect(s1.expectedRevision).toBe(3) // GET 记录的服务端 revision
    expect(s1.deviceId).toMatch(/^(desktop|tablet)-/)
    expect(s1.data.tasks[0].title).toBe('A2')
    expect((window as any).__gradSyncKnownRevision()).toBe(11) // 响应后 revision 更新

    // 3. 新增 t2：changedIds 包含新实体；expectedRevision 基于上一次响应（串行）
    calls.length = 0
    window.localStorage.setItem(SYNC_KEY, JSON.stringify({ tasks: [{ id: 't1', title: 'A2' }, { id: 't2', title: 'B' }] }))
    await flush()
    const s2 = calls[0]
    expect(s2.expectedRevision).toBe(11) // 基于上一次响应（串行提交）
    expect(s2.changedIds).toContain('tasks:t2')

    // 4. 修改 t2：changedIds 包含修改的实体
    calls.length = 0
    window.localStorage.setItem(SYNC_KEY, JSON.stringify({ tasks: [{ id: 't1', title: 'A2' }, { id: 't2', title: 'B2' }] }))
    await flush()
    const s3 = calls[0]
    expect(s3.changedIds).toContain('tasks:t2')

    // 5. 删除 t2：deletedIds 包含被删实体
    calls.length = 0
    window.localStorage.setItem(SYNC_KEY, JSON.stringify({ tasks: [{ id: 't1', title: 'A2' }] }))
    await flush()
    const s4 = calls[0]
    expect(s4.deletedIds).toContain('tasks:t2')

    // 6. 409 → dispatch sync-conflict 事件（不静默覆盖）
    ;(window as any).electronAPI.syncStorageSet = async () => ({
      ok: false, status: 409, serverRevision: 99, serverData: { tasks: [{ id: 't1', title: 'server' }] },
      conflicts: [{ id: 'tasks:t1' }],
    })
    const conflicts: any[] = []
    const onConflict = (e: Event) => conflicts.push((e as CustomEvent).detail)
    window.addEventListener('sync-conflict', onConflict)
    window.localStorage.setItem(SYNC_KEY, JSON.stringify({ tasks: [{ id: 't1', title: 'client' }] }))
    await flush()
    expect(conflicts.length).toBe(1)
    expect(conflicts[0].conflicts[0].id).toBe('tasks:t1')
    window.removeEventListener('sync-conflict', onConflict)
  })

  it('flush 协议接口就绪（__gradSyncFlush / knownRevision）', () => {
    expect(typeof (window as any).__gradSyncFlush).toBe('function')
    expect(typeof (window as any).__gradSyncKnownRevision).toBe('function')
  })
})
