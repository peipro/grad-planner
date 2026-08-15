import { describe, it, expect } from 'vitest'
import { localDateKey, todayItems, isAllDayDue, overdueTasks, todayFocusMinutes, focusMinutesForTask } from './today'
import { Task, CalEvent } from '../types'

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: 'T' + id, priority: 'medium', status: 'todo', createdAt: '2026-01-01T00:00:00', ...over,
})

const event = (id: string, start: string, over: Partial<CalEvent> = {}): CalEvent => ({
  id, title: 'E' + id, start, end: start, type: 'meeting', ...over,
})

// 本地时刻 → UTC ISO（测试机器时区无关：断言在任何时区都成立）
const localIso = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min).toISOString()

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
  it('只统计当天（本地日期）完成的番茄钟分钟数', () => {
    const pomodoros = [
      { id: 'p1', taskTitle: 'x', minutes: 25, completedAt: localIso(2026, 8, 15, 18, 0) }, // 本地 8-15
      { id: 'p2', taskTitle: 'x', minutes: 50, completedAt: localIso(2026, 8, 14, 18, 0) }, // 本地 8-14
    ]
    expect(todayFocusMinutes(pomodoros as any, '2026-08-15')).toBe(25)
    expect(todayFocusMinutes(pomodoros as any, '2026-08-14')).toBe(50)
  })

  // Phase 3 #5：跨午夜归属——completedAt 是 UTC ISO，必须按本地日期归属
  // （历史 bug：UTC 字符串 startsWith 本地键，UTC+8 的 00:00-08:00 会记到前一天）
  it.each(['00:30', '02:00', '07:30', '08:00', '23:30'])('本地 %s 完成的番茄记到当天（非前一天）', (hm) => {
    const [h, m] = hm.split(':').map(Number)
    const completedAt = localIso(2026, 8, 15, h, m)
    expect(todayFocusMinutes([{ id: 'x', taskTitle: 't', minutes: 25, completedAt }] as any, '2026-08-15')).toBe(25)
    expect(todayFocusMinutes([{ id: 'x', taskTitle: 't', minutes: 25, completedAt }] as any, '2026-08-14')).toBe(0)
  })

  it('跨午夜边界：本地 8-15 00:30 与 8-14 23:30 分属各自日期', () => {
    const pomodoros = [
      { id: 'a', taskTitle: 'x', minutes: 25, completedAt: localIso(2026, 8, 15, 0, 30) },
      { id: 'b', taskTitle: 'x', minutes: 25, completedAt: localIso(2026, 8, 14, 23, 30) },
    ]
    expect(todayFocusMinutes(pomodoros as any, '2026-08-15')).toBe(25)
    expect(todayFocusMinutes(pomodoros as any, '2026-08-14')).toBe(25)
  })
})

describe('focusMinutesForTask（Phase 3 #4：Pomodoro ↔ Task 聚合）', () => {
  const pomos = [
    { id: 'p1', taskTitle: '读LSTM', minutes: 25, completedAt: localIso(2026, 8, 15, 12, 0), taskId: 't1' },
    { id: 'p2', taskTitle: '读LSTM', minutes: 50, completedAt: localIso(2026, 8, 15, 14, 0), taskId: 't1' },
    { id: 'p3', taskTitle: '买洗衣液', minutes: 25, completedAt: localIso(2026, 8, 14, 18, 0) },
    { id: 'p4', taskTitle: '读LSTM', minutes: 25, completedAt: localIso(2026, 8, 14, 18, 0) }, // 旧记录：无 taskId 仅标题
  ]

  it('按 taskId 聚合：同 id 新记录 + 无 id 旧记录（标题一致）', () => {
    const f = focusMinutesForTask(pomos as any, 't1', '读LSTM')
    expect(f.minutes).toBe(100) // p1+p2（id 匹配）+ p4（旧记录标题匹配）
    expect(f.count).toBe(3)
  })

  it('无 taskId 时按标题匹配全部', () => {
    const f = focusMinutesForTask(pomos as any, undefined, '读LSTM')
    expect(f.minutes).toBe(100)
  })

  it('dateKey 限定当天（本地日期换算，非 UTC 字符串比对）', () => {
    expect(focusMinutesForTask(pomos as any, 't1', '读LSTM', '2026-08-15').minutes).toBe(75) // p1+p2 在 8-15 本地日
    expect(focusMinutesForTask(pomos as any, undefined, '读LSTM', '2026-08-14').minutes).toBe(25) // p4 在 8-14 本地日
  })

  it('不匹配的任务 → 0', () => {
    expect(focusMinutesForTask(pomos as any, 't999', '不存在').minutes).toBe(0)
  })
})
