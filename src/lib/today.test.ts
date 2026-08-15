import { describe, it, expect } from 'vitest'
import { localDateKey, todayItems, isAllDayDue, overdueTasks, todayFocusMinutes } from './today'
import { Task, CalEvent } from '../types'

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: 'T' + id, priority: 'medium', status: 'todo', createdAt: '2026-01-01T00:00:00', ...over,
})

const event = (id: string, start: string, over: Partial<CalEvent> = {}): CalEvent => ({
  id, title: 'E' + id, start, end: start, type: 'meeting', ...over,
})

describe('localDateKey', () => {
  it('生成本地时区的 yyyy-MM-dd', () => {
    expect(localDateKey(new Date(2026, 7, 15))).toBe('2026-08-15')
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('isAllDayDue', () => {
  it('纯日期 / 00:00 视为全天，带时间不算', () => {
    expect(isAllDayDue(task('a', { due: '2026-08-15' }), '2026-08-15')).toBe(true)
    expect(isAllDayDue(task('b', { due: '2026-08-15T00:00' }), '2026-08-15')).toBe(true)
    expect(isAllDayDue(task('c', { due: '2026-08-15T09:00' }), '2026-08-15')).toBe(false)
    expect(isAllDayDue(task('d', { due: '2026-08-15T12:00:00' }), '2026-08-15')).toBe(false)
  })
})

describe('todayItems 时间线聚合', () => {
  it('仅收集今天到期的任务与今天开始的事件（不含其他日期）', () => {
    const tasks = [
      task('a', { due: '2026-08-15T12:00:00' }),
      task('b', { due: '2026-08-16T12:00:00' }), // 明天，不出现
      task('c', { due: '2026-08-15' }), // 全天
    ]
    const events = [event('e1', '2026-08-15T09:00', { title: '组会' })]
    const { allDay, timed } = todayItems(tasks, events, '2026-08-15')
    expect(allDay.map((i) => i.id)).toEqual(['tsk-c'])
    expect(timed.map((i) => i.id)).toEqual(['evt-e1', 'tsk-a'])
  })

  it('时间线按时间升序（事件与任务混合排序）', () => {
    const tasks = [task('a', { due: '2026-08-15T14:00:00' }), task('b', { due: '2026-08-15T10:30:00' })]
    const events = [event('e1', '2026-08-15T09:00')]
    const { timed } = todayItems(tasks, events, '2026-08-15')
    expect(timed.map((i) => i.time)).toEqual(['09:00', '10:30', '14:00'])
  })

  it('同一任务只出现一次（不重复展示）', () => {
    const tasks = [task('a', { due: '2026-08-15T09:00:00' })]
    const { allDay, timed } = todayItems(tasks, [], '2026-08-15')
    const all = allDay.concat(timed).filter((i) => i.raw.id === 'a')
    expect(all).toHaveLength(1)
    expect(timed[0].kind).toBe('task')
  })

  it('跨天事件（非今天开始）不进入今天时间线', () => {
    const events = [event('e1', '2026-08-14T23:00', { end: '2026-08-15T02:00' })]
    const { timed } = todayItems([], events, '2026-08-15')
    expect(timed).toHaveLength(0)
  })

  it('任务携带 area 供 Today 分区展示', () => {
    const tasks = [task('a', { due: '2026-08-15T09:00:00', area: 'research' })]
    const { timed } = todayItems(tasks, [], '2026-08-15')
    expect(timed[0].area).toBe('research')
  })
})

describe('overdueTasks', () => {
  it('返回未完成且截止早于今天的任务，按截止升序', () => {
    const tasks = [
      task('a', { due: '2026-08-10T12:00:00' }),
      task('b', { due: '2026-08-15T12:00:00' }), // 今天，不算逾期
      task('c', { due: '2026-08-09T12:00:00', status: 'done' }), // 已完成，排除
    ]
    const od = overdueTasks(tasks, '2026-08-15')
    expect(od.map((x) => x.id)).toEqual(['a'])
  })

  it('无 due 的任务不算逾期', () => {
    expect(overdueTasks([task('a')], '2026-08-15')).toHaveLength(0)
  })
})

describe('todayFocusMinutes', () => {
  it('只统计今天完成的番茄钟分钟数', () => {
    const pomodoros = [
      { id: 'p1', taskTitle: 'x', minutes: 25, completedAt: '2026-08-15T10:00:00.000Z' },
      { id: 'p2', taskTitle: 'x', minutes: 50, completedAt: '2026-08-14T10:00:00.000Z' },
    ]
    expect(todayFocusMinutes(pomodoros as any, '2026-08-15')).toBe(25)
  })
})
