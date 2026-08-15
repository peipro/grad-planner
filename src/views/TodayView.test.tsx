// Today 2.0 组件测试（Phase 2B）
// 覆盖：时间线聚合展示、area 区分、内联完成 Task、内联 Habit 打卡、逾期侧栏、底部快速添加。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import TodayView from './TodayView'
import { useStore } from '../store'

// 固定系统时间到 2026-08-15（周六）上午 8 点，让「今日」可断言
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-15T08:00:00'))
  useStore.setState({
    tasks: [
      { id: 't1', title: '买洗衣液', priority: 'medium', status: 'todo', due: '2026-08-15T12:00:00', area: 'life', createdAt: '' },
      { id: 't2', title: '读LSTM论文', priority: 'high', status: 'todo', due: '2026-08-15T15:30:00', area: 'research', createdAt: '' },
      { id: 't3', title: '全天任务', priority: 'low', status: 'todo', due: '2026-08-15', createdAt: '' },
      { id: 't4', title: '逾期任务', priority: 'medium', status: 'todo', due: '2026-08-10T12:00:00', createdAt: '' },
      { id: 't5', title: '已完成任务', priority: 'low', status: 'done', due: '2026-08-15T09:00:00', createdAt: '' },
      { id: 't6', title: '明天的任务', priority: 'low', status: 'todo', due: '2026-08-16T10:00:00', createdAt: '' },
    ],
    events: [
      { id: 'e1', title: '组会汇报', start: '2026-08-15T09:00', end: '2026-08-15T10:00', type: 'meeting' },
      { id: 'e2', title: '明天的日程', start: '2026-08-16T09:00', end: '2026-08-16T10:00', type: 'personal' },
    ],
    habits: [
      { id: 'h1', name: '读文献', emoji: '📚', weeklyTarget: 5, records: [], createdAt: '' },
      { id: 'h2', name: '运动', emoji: '🏃', weeklyTarget: 3, records: ['2026-08-15'], createdAt: '' },
    ],
    pomodoros: [
      { id: 'p1', taskTitle: '专注', minutes: 25, completedAt: '2026-08-15T10:00:00.000Z' },
      { id: 'p2', taskTitle: '昨天的', minutes: 50, completedAt: '2026-08-14T10:00:00.000Z' },
    ],
    projects: [],
    pomo: { mode: 'countdown', focusMin: 25, breakMin: 5, remaining: 1500, running: false, phase: 'focus', taskTitle: '', taskId: undefined, swSec: 0, swRunning: false },
  } as any)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TodayView 时间线（主栏）', () => {
  it('展示今天的日程与任务，不展示明天的', () => {
    render(<TodayView />)
    expect(screen.getByText('组会汇报')).toBeTruthy()
    expect(screen.getByText('买洗衣液')).toBeTruthy()
    expect(screen.getByText('读LSTM论文')).toBeTruthy()
    expect(screen.getByText('全天任务')).toBeTruthy()
    expect(screen.queryByText('明天的任务')).toBeNull()
    expect(screen.queryByText('明天的日程')).toBeNull()
  })

  it('同一任务只出现一次', () => {
    render(<TodayView />)
    expect(screen.getAllByText('买洗衣液')).toHaveLength(1)
  })

  it('任务按 area 显示轻量标签（科研 / 生活 / 其他）', () => {
    render(<TodayView />)
    expect(screen.getByText('科研')).toBeTruthy()
    expect(screen.getByText('生活')).toBeTruthy()
    expect(screen.getAllByText('其他').length).toBeGreaterThanOrEqual(1)
  })

  it('已完成任务在时间线中展示为完成态', () => {
    render(<TodayView />)
    expect(screen.getByText('已完成任务')).toBeTruthy()
    const t = useStore.getState().tasks.find((x) => x.id === 't5')
    expect(t?.status).toBe('done')
  })

  it('顶部概览统计今日待办/日程/习惯/专注', () => {
    render(<TodayView />)
    const stat = (name: string) => document.querySelector(`[data-stat="${name}"]`)!.textContent!
    // 待办：t1/t2/t3 未完成 = 3；完成 t5 = 1；逾期 t4 = 1
    expect(stat('todo')).toContain('3')
    expect(stat('todo')).toContain('完成 1 · 逾期 1')
    expect(stat('event')).toContain('1 项日程')
    expect(stat('habit')).toContain('1/2 已打卡')
    expect(stat('focus')).toContain('25 min')
  })
})

describe('TodayView 内联操作', () => {
  it('内联完成 Task：点击后状态变为 done，再点恢复', () => {
    render(<TodayView />)
    const row = screen.getByText('买洗衣液').closest('.tl-row')! as HTMLElement
    fireEvent.click(within(row).getByTitle('完成'))
    expect(useStore.getState().tasks.find((x) => x.id === 't1')?.status).toBe('done')
    fireEvent.click(within(row).getByTitle('标记为未完成'))
    expect(useStore.getState().tasks.find((x) => x.id === 't1')?.status).toBe('todo')
  })

  it('内联 Habit 打卡：未打卡的打卡成功，已打卡的可取消', () => {
    render(<TodayView />)
    const h1Row = screen.getByText('读文献').closest('.habit-row')! as HTMLElement
    fireEvent.click(within(h1Row).getByText('打卡'))
    expect(useStore.getState().habits.find((x) => x.id === 'h1')?.records).toContain('2026-08-15')
    fireEvent.click(within(h1Row).getByText('✓ 已打卡'))
    expect(useStore.getState().habits.find((x) => x.id === 'h1')?.records).not.toContain('2026-08-15')
  })
})

describe('TodayView 侧栏（今日习惯 + 逾期）', () => {
  it('逾期任务出现在侧栏并显示逾期天数', () => {
    render(<TodayView />)
    expect(screen.getByText('逾期任务')).toBeTruthy()
    expect(screen.getByText('逾期 5 天')).toBeTruthy()
  })

  it('逾期任务可一键完成', () => {
    render(<TodayView />)
    const odRow = screen.getByText('逾期任务').closest('.od-row')! as HTMLElement
    fireEvent.click(within(odRow).getByTitle('完成'))
    expect(useStore.getState().tasks.find((x) => x.id === 't4')?.status).toBe('done')
  })
})

describe('TodayView 底部轻操作', () => {
  it('快速添加待办：无日期 → 默认今天 12:00，并识别 area', () => {
    render(<TodayView />)
    fireEvent.click(screen.getByText('添加待办'))
    const input = document.querySelector('.bar-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '生活 取快递' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const created = useStore.getState().tasks.find((x) => x.title === '取快递')
    expect(created).toBeTruthy()
    expect(created?.area).toBe('life')
    expect(created?.due).toBe('2026-08-15T12:00:00')
  })

  it('快速添加带日期 → 按解析日期落点', () => {
    render(<TodayView />)
    fireEvent.click(screen.getByText('添加待办'))
    const input = document.querySelector('.bar-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '明天交实验报告' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const created = useStore.getState().tasks.find((x) => x.title === '交实验报告')
    expect(created?.due).toBe('2026-08-16T12:00:00')
  })

  it('时间不丢失：快速添加「生活 下午3点取快递」→ 今天 15:00 + area=life（与 Quick Capture 同逻辑）', () => {
    render(<TodayView />)
    fireEvent.click(screen.getByText('添加待办'))
    const input = document.querySelector('.bar-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '生活 下午3点取快递' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const created = useStore.getState().tasks.find((x) => x.title === '取快递')
    expect(created).toBeTruthy()
    expect(created?.area).toBe('life')
    expect(created?.due).toBe('2026-08-15T15:00:00') // 不再是 12:00
  })

  it('时间不丢失：快速添加「明天下午3点读 LSTM」→ 明天 15:00（不得落成 12:00）', () => {
    render(<TodayView />)
    fireEvent.click(screen.getByText('添加待办'))
    const input = document.querySelector('.bar-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '明天下午3点读 LSTM' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const created = useStore.getState().tasks.find((x) => x.title === '读 LSTM')
    expect(created?.due).toBe('2026-08-16T15:00:00')
  })

  it('Today 提供「快速记录」入口：点击唤起 Quick Capture（无需记忆快捷键）', () => {
    const spy = vi.fn()
    render(<TodayView onQuickCapture={spy} />)
    fireEvent.click(screen.getByText('快速记录'))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('开始专注：未运行时点击启动番茄钟倒计时', () => {
    render(<TodayView />)
    fireEvent.click(screen.getByText('开始专注'))
    const s = useStore.getState().pomo
    expect(s.running).toBe(true)
    expect(s.phase).toBe('focus')
    expect(s.remaining).toBe(25 * 60)
  })
})

describe('Pomodoro ↔ Task（Phase 3 #4）', () => {
  it('任务行 🍅 按钮：启动绑定该任务的番茄钟', () => {
    render(<TodayView />)
    const row = screen.getByText('买洗衣液').closest('.tl-row') as HTMLElement
    fireEvent.click(within(row).getByTitle('专注这个任务'))
    const s = useStore.getState().pomo
    expect(s.running).toBe(true)
    expect(s.taskId).toBe('t1')
    expect(s.taskTitle).toBe('买洗衣液')
  })

  it('任务行显示今日该任务专注分钟', () => {
    useStore.setState({
      pomodoros: [
        { id: 'pf1', taskTitle: '买洗衣液', minutes: 25, completedAt: '2026-08-15T04:00:00.000Z', taskId: 't1' },
      ],
    } as any)
    render(<TodayView />)
    expect(screen.getByText('🍅 25 min')).toBeTruthy()
  })
})
