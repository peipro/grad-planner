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

describe('日历任务操作面板（Phase 3 #3：无需跳待办页）', () => {
  const seedTask = (over: Record<string, unknown> = {}) =>
    useStore.setState({ tasks: [{ id: 't1', title: '下午的文献', priority: 'medium', status: 'todo', due: '2026-08-15T15:00:00', createdAt: '', ...over }] } as any)

  it('点击任务 chip → 打开操作面板（不再跳待办页）', () => {
    seedTask()
    render(<CalendarView />)
    fireEvent.click(screen.getByText('日')) // 月视图格子最多 3 chip，任务可能被截断；日视图完整
    fireEvent.click(screen.getByText('📌 下午的文献'))
    expect(screen.getByText('📌 任务操作')).toBeTruthy()
    expect((document.querySelector('.modal input') as HTMLInputElement).value).toBe('下午的文献')
  })

  it('标记完成 → done；再点取消完成 → todo', () => {
    seedTask()
    render(<CalendarView />)
    fireEvent.click(screen.getByText('日'))
    fireEvent.click(screen.getByText('📌 下午的文献'))
    fireEvent.click(screen.getByText('✓ 标记完成'))
    expect(useStore.getState().tasks.find((x) => x.id === 't1')?.status).toBe('done')
    // 面板保持打开，可直接撤销（任务完成后会从日历消失）
    expect(screen.getByText('↩ 取消完成')).toBeTruthy()
    fireEvent.click(screen.getByText('↩ 取消完成'))
    expect(useStore.getState().tasks.find((x) => x.id === 't1')?.status).toBe('todo')
  })

  it('改期（选明天）→ 保留原时间 15:00，仅换日期', () => {
    seedTask()
    render(<CalendarView />)
    fireEvent.click(screen.getByText('日'))
    fireEvent.click(screen.getByText('📌 下午的文献'))
    fireEvent.click(document.querySelector('.dp-trigger') as HTMLElement) // 打开日期选择器
    fireEvent.click(screen.getByText('明天')) // dp-foot 快捷
    fireEvent.click(screen.getByText('保存修改'))
    const t = useStore.getState().tasks.find((x) => x.id === 't1')!
    expect(t.due).toBe('2026-08-16T15:00:00')
  })

  it('编辑标题 + 保存 → store 更新', () => {
    seedTask()
    render(<CalendarView />)
    fireEvent.click(screen.getByText('日'))
    fireEvent.click(screen.getByText('📌 下午的文献'))
    const titleInput = document.querySelector('.modal input') as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: '改后的标题' } })
    fireEvent.click(screen.getByText('保存修改'))
    const t = useStore.getState().tasks.find((x) => x.id === 't1')!
    expect(t.title).toBe('改后的标题')
    expect(t.due).toBe('2026-08-15T15:00:00')
  })
})
