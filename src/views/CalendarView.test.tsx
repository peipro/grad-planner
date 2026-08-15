// Phase 2B UX 修复 · 日历悬浮卡片测试
// 覆盖：显示延迟 / 锚定日期格不跟随鼠标 / 隐藏宽限（鼠标可移入卡片）/ 快速扫过不闪烁

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import CalendarView from './CalendarView'
import { useStore } from '../store'

const T = (h: number, m = 0) => `2026-08-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-15T08:00:00'))
  useStore.setState({
    events: [
      { id: 'e1', title: '早会', start: T(9), end: T(10), type: 'meeting' },
      { id: 'e2', title: '课程A', start: T(10), end: T(11), type: 'course' },
      { id: 'e3', title: '截止报告', start: T(14), end: T(15), type: 'deadline' },
      { id: 'e4', title: '生活事务', start: T(16), end: T(17), type: 'personal' },
      { id: 'e5', title: '明天的事', start: '2026-08-16T09:00', end: '2026-08-16T10:00', type: 'personal' },
    ],
    tasks: [],
    birthdays: [],
    milestones: [],
  } as any)
})

afterEach(() => {
  vi.useRealTimers()
})

const cellOf = (dayText: string): HTMLElement => {
  const el = screen.getByText(dayText).closest('.cal-cell') as HTMLElement
  if (!el) throw new Error(`未找到日期格 ${dayText}`)
  return el
}

const card = () => document.querySelector('.cal-hover-card') as HTMLElement | null

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('日历悬浮卡片（>3 项触发）', () => {
  it('悬停 >3 事件的日期格：延迟 150ms 后显示卡片，包含全部条目', () => {
    render(<CalendarView />)
    fireEvent.mouseOver(cellOf('15'))
    expect(card()).toBeNull() // 延迟期内不显示
    advance(150)
    const c = card()
    expect(c).not.toBeNull()
    expect(within(c!).getByText('早会')).toBeTruthy()
    expect(within(c!).getByText('生活事务')).toBeTruthy()
    expect(within(c!).getByText(/共 4 项/)).toBeTruthy()
  })

  it('悬停 ≤3 事件的日期格：不显示卡片', () => {
    render(<CalendarView />)
    fireEvent.mouseOver(cellOf('16')) // 只有 1 个事件
    advance(200)
    expect(card()).toBeNull()
  })

  it('卡片锚定日期格位置，不跟随鼠标移动（无 chase 效应）', () => {
    render(<CalendarView />)
    fireEvent.mouseOver(cellOf('15'))
    advance(150)
    const c = card()!
    const posBefore = `${c.style.left}|${c.style.top}`
    fireEvent.mouseMove(cellOf('15'), { clientX: 400, clientY: 300 })
    expect(`${c.style.left}|${c.style.top}`).toBe(posBefore) // 位置不变
  })

  it('隐藏宽限：离开日期格后卡片不立即消失，鼠标可移入卡片', () => {
    render(<CalendarView />)
    fireEvent.mouseOver(cellOf('15'))
    advance(150)
    expect(card()).not.toBeNull()
    fireEvent.mouseOut(cellOf('15'))
    advance(100) // 宽限期内
    expect(card()).not.toBeNull()
    fireEvent.mouseOver(card()!) // 移入卡片 → 取消隐藏
    advance(300)
    expect(card()).not.toBeNull()
    fireEvent.mouseOut(card()!)
    advance(50)
    expect(card()).toBeNull() // 离开卡片才消失
  })

  it('快速扫过日期格：不弹出闪烁卡片', () => {
    render(<CalendarView />)
    fireEvent.mouseOver(cellOf('15'))
    advance(50) // 未到 150ms
    fireEvent.mouseOut(cellOf('15'))
    advance(300)
    expect(card()).toBeNull()
  })
})

describe('日历任务时间显示（Phase 3：按实际到期时间）', () => {
  it('「下午3点」到期任务在日历时间线显示 15:00（历史 bug：硬编码 09:00）', () => {
    useStore.setState({
      tasks: [{ id: 'task15', title: '下午的文献', priority: 'medium', status: 'todo', due: '2026-08-15T15:00:00', createdAt: '' }],
    } as any)
    render(<CalendarView />)
    fireEvent.click(screen.getByText('日')) // 日视图时间线
    const el = screen.getByText('📌 下午的文献').closest('.tl-event') as HTMLElement
    expect(within(el).getByText('15:00')).toBeTruthy()
  })

  it('无时间（纯日期 due）任务仍显示为 09:00 默认', () => {
    useStore.setState({
      tasks: [{ id: 'taskAllday', title: '全天事项', priority: 'medium', status: 'todo', due: '2026-08-15', createdAt: '' }],
    } as any)
    render(<CalendarView />)
    fireEvent.click(screen.getByText('日'))
    const el = screen.getByText('📌 全天事项').closest('.tl-event') as HTMLElement
    expect(within(el).getByText('09:00')).toBeTruthy()
  })
})
