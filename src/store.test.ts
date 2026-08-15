import { describe, it, expect, vi } from 'vitest'
import { mergePersistedState, repairMilestones, uid, useStore } from './store'
import type { PlannerState } from './store'

const currentState = (): PlannerState => useStore.getState()

describe('mergePersistedState（持久化 merge 语义，hydration/导入/恢复共用）', () => {
  it('persisted 覆盖同名字段，缺失字段由 current 默认值补齐（兼容老版本数据）', () => {
    const current = currentState()
    const persisted = {
      events: [{ id: 'e1', title: '组会', start: '2026-01-01T09:00', end: '2026-01-01T10:00', type: 'meeting' as const }],
    }
    const merged = mergePersistedState(persisted, current)
    expect(merged.events).toHaveLength(1)
    expect(merged.events[0].title).toBe('组会')
    expect(merged.tasks).toEqual(current.tasks) // 缺失字段用 current 默认值
    expect(merged.notes).toEqual(current.notes)
    expect(merged.papers).toEqual(current.papers)
  })

  it('配置字段完整保留：theme/reminders/autoBackup/lastBackup/newsConfig/pomo/activeView 不静默丢失', () => {
    const current = currentState()
    const persisted = {
      theme: { mode: 'dark' as const, accent: 'green' as const },
      reminders: { enabled: false, eventLeadMin: 60, birthdayLeadDays: 14, taskLeadDays: 3 },
      autoBackup: true,
      lastBackup: '2026-08-14T10:00:00.000Z',
      newsConfig: { xKey: '', xSecret: '', includeX: true, rssKeys: ['openai'] as string[] | null, includeHot: false },
      pomo: { mode: 'countdown' as const, focusMin: 50, breakMin: 10, remaining: 3000, running: false, phase: 'focus' as const, taskTitle: 'x', swSec: 0, swRunning: false },
      activeView: 'notes',
    }
    const merged = mergePersistedState(persisted, current)
    expect(merged.theme).toEqual(persisted.theme)
    expect(merged.reminders).toEqual(persisted.reminders)
    expect(merged.autoBackup).toBe(true)
    expect(merged.lastBackup).toBe('2026-08-14T10:00:00.000Z')
    expect(merged.activeView).toBe('notes')
    expect(merged.pomo.focusMin).toBe(50)
    expect(merged.newsConfig.rssKeys).toEqual(['openai'])
  })

  it('Phase 2B：旧默认视图 calendar 迁移到 today（Today 成为每日入口）', () => {
    const merged = mergePersistedState({ activeView: 'calendar' }, currentState())
    expect(merged.activeView).toBe('today')
  })

  it('Phase 2B：非默认视图（如 notes）保持原值，不做迁移', () => {
    const merged = mergePersistedState({ activeView: 'notes' }, currentState())
    expect(merged.activeView).toBe('notes')
  })

  it('Phase 2B：activeView 默认值为 today', () => {
    expect(currentState().activeView).toBe('today')
  })

  it('newsConfig 密钥强制清空（与 partialize 对称，密钥不回写存储）', () => {
    const current = currentState()
    const persisted = {
      newsConfig: { xKey: 'secret-key', xSecret: 'secret-secret', includeX: true, rssKeys: null, includeHot: true },
    }
    const merged = mergePersistedState(persisted, current)
    expect(merged.newsConfig.xKey).toBe('')
    expect(merged.newsConfig.xSecret).toBe('')
    expect(merged.newsConfig.includeX).toBe(true)
  })

  it('pomo 运行时状态强制复位（running/endAt 不跨会话）', () => {
    const current = currentState()
    const persisted = {
      pomo: { mode: 'countdown' as const, focusMin: 25, breakMin: 5, remaining: 1500, running: true, phase: 'focus' as const, taskTitle: '', swSec: 10, swRunning: true, endAt: 12345, swStartedAt: 67890 },
    }
    const merged = mergePersistedState(persisted, current)
    expect(merged.pomo.running).toBe(false)
    expect(merged.pomo.swRunning).toBe(false)
    expect(merged.pomo.endAt).toBeUndefined()
    expect(merged.pomo.swStartedAt).toBeUndefined()
  })

  it('milestones 经 repair 自愈（与 persist merge 行为一致）', () => {
    const current = currentState()
    const persisted = {
      milestones: [
        { id: 'm1', title: 'A', startDate: '2026-01-01', endDate: '2026-02-01', progress: 0, color: '#fff' },
        { id: 'm1', title: 'A', startDate: '2026-01-01', endDate: '2026-02-01', progress: 0, color: '#fff' },
      ],
    }
    const merged = mergePersistedState(persisted, current)
    expect(merged.milestones).toHaveLength(1)
  })

  it('null / 非对象 persisted 安全降级为 current', () => {
    const current = currentState()
    const merged = mergePersistedState(null, current)
    expect(merged.events).toEqual(current.events)
    expect(merged.tasks).toEqual(current.tasks)
  })
})

describe('repairMilestones（数据自愈：防误删是关键）', () => {
  it('同 id 重复只保留第一条', () => {
    const list = [
      { id: 'm1', title: 'A', startDate: '1', endDate: '2', progress: 0, color: 'c' },
      { id: 'm1', title: 'A副本', startDate: '1', endDate: '2', progress: 0, color: 'c' },
    ]
    const out = repairMilestones(list)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('A')
  })

  it('非数组输入返回 [] —— 已知行为：静默清空，风险在调用方必须先用 validate 拦截', () => {
    expect(repairMilestones({})).toEqual([])
    expect(repairMilestones(null)).toEqual([])
    expect(repairMilestones('x')).toEqual([])
    expect(repairMilestones(42)).toEqual([])
  })

  it('无 id 条目补全新 id；同输入两次调用生成不同 id（id 不稳定，Phase 1 改进）', () => {
    const list = [{ title: '无id', startDate: '1', endDate: '2', progress: 0, color: 'c' }]
    const a = repairMilestones(list)
    const b = repairMilestones(list)
    expect(a[0].id).toBeTruthy()
    expect(a[0].id).not.toBe(b[0].id)
  })

  it('checkpoint 缺 id / 缺 title 被过滤（合法检查点保留）', () => {
    const list = [
      {
        id: 'm1', title: 'A', startDate: '1', endDate: '2', progress: 0, color: 'c',
        checkpoints: [
          { id: 'c1', title: 'ok', done: false },
          { id: 'c2' },
          { title: '无id' },
        ],
      },
    ]
    const out = repairMilestones(list)
    expect(out[0].checkpoints).toHaveLength(1)
    expect(out[0].checkpoints![0].id).toBe('c1')
  })

  it('非法条目（无有效 title）被丢弃', () => {
    const out = repairMilestones([
      { id: 'x' },
      { title: '   ' },
      { title: '合法', startDate: '1', endDate: '2', progress: 0, color: 'c' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('合法')
  })
})

describe('uid（ID 生成）', () => {
  it('正常随机情况下不重复（1000 条）', () => {
    const set = new Set(Array.from({ length: 1000 }, () => uid()))
    expect(set.size).toBe(1000)
  })

  it('mock 固定 Math.random + Date.now 时必然碰撞 —— 证明依赖随机熵，应改用 crypto.randomUUID', () => {
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const now = vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    expect(uid()).toBe(uid())
    rand.mockRestore()
    now.mockRestore()
  })
})
