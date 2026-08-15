// Phase 2C · Quick Capture 组件测试
// 覆盖：Task/Event/Note 类型、日期解析落库、area、时间不丢失、auto 安全回落、边界

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { addDays, addMonths, addYears, format } from 'date-fns'
import QuickCapture from './QuickCapture'
import { useStore } from '../store'
import { useToast } from '../lib/toast'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-15T08:00:00'))
  useStore.setState({ tasks: [], events: [], notes: [] } as any)
  useToast.setState({ toasts: [] } as any)
})

afterEach(() => {
  vi.useRealTimers()
})

const now = () => new Date('2026-08-15T08:00:00')
const FMT = (d: Date) => format(d, 'yyyy-MM-dd')

let onClose: ReturnType<typeof vi.fn>

function open(mode?: 'auto' | 'task' | 'event' | 'note') {
  onClose = vi.fn()
  render(<QuickCapture onClose={onClose} />)
  if (mode && mode !== 'auto') fireEvent.click(screen.getByText({ auto: '自动识别', task: '任务', event: '日程', note: '笔记' }[mode]))
  return document.getElementById('qc-input') as HTMLInputElement
}

function submit(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('类型（显式选择优先）', () => {
  it('任务：「生活 买洗衣液」→ Task + area=life', () => {
    submit(open('task'), '生活 买洗衣液')
    const t = useStore.getState().tasks[0]
    expect(t).toBeTruthy()
    expect(t.title).toBe('买洗衣液')
    expect(t.area).toBe('life')
    expect(onClose).toHaveBeenCalled()
  })

  it('日程：「后天上午去办事」→ Event 后天 09:00-10:00', () => {
    submit(open('event'), '后天上午去办事')
    const e = useStore.getState().events[0]
    expect(e).toBeTruthy()
    expect(e.title).toBe('去办事')
    expect(e.start).toBe(`${FMT(addDays(now(), 2))}T09:00`)
    expect(e.end).toBe(`${FMT(addDays(now(), 2))}T10:00`)
  })

  it('笔记：「记录一下刚才想到的问题」→ Note，title 与 content 正确', () => {
    submit(open('note'), '记录一下刚才想到的问题')
    const n = useStore.getState().notes[0]
    expect(n).toBeTruthy()
    expect(n.title).toBe('记录一下刚才想到的问题')
    expect(n.content).toBe('记录一下刚才想到的问题')
    expect(n.tags).toEqual([])
  })
})

describe('日期解析落库', () => {
  it('auto：「半个月后复习 LSTM」→ Event +15 天', () => {
    submit(open(), '半个月后复习 LSTM')
    const e = useStore.getState().events[0]
    expect(e).toBeTruthy()
    expect(e.start.slice(0, 10)).toBe(FMT(addDays(now(), 15)))
    expect(e.title).toBe('复习 LSTM')
  })

  it('任务：「两周半后提交实验」→ due +17 天', () => {
    submit(open('task'), '两周半后提交实验')
    const t = useStore.getState().tasks[0]
    expect(t.due).toBe(`${FMT(addDays(now(), 17))}T12:00:00`)
  })

  it('任务：「下个月组会」→ due 下个月同一天 12:00', () => {
    submit(open('task'), '下个月组会')
    const t = useStore.getState().tasks[0]
    expect(t.due).toBe(`${FMT(addMonths(now(), 1))}T12:00:00`)
  })

  it('任务：「明年毕业论文」→ due +1 年', () => {
    submit(open('task'), '明年毕业论文')
    const t = useStore.getState().tasks[0]
    expect(t.due).toBe(`${FMT(addYears(now(), 1))}T12:00:00`)
  })

  it('任务：「下个礼拜三下午给导师发实验结果」→ 下周三 15:00（礼拜=星期，时间不丢失）', () => {
    submit(open('task'), '下个礼拜三下午给导师发实验结果')
    const monday = addDays(now(), -((now().getDay() + 6) % 7))
    const nextWed = addDays(monday, 9) // 下周一 + 3 天偏移（周一为起点，周三=索引2）
    const t = useStore.getState().tasks[0]
    expect(t.due).toBe(`${FMT(nextWed)}T15:00:00`)
    expect(t.title).toBe('给导师发实验结果')
  })

  it('任务：「明天下午3点交实验报告」→ 明天 15:00（数字时段优先于默认时段）', () => {
    submit(open('task'), '明天下午3点交实验报告')
    const t = useStore.getState().tasks[0]
    expect(t.due).toBe(`${FMT(addDays(now(), 1))}T15:00:00`)
  })
})

describe('area（科研/学习/生活/杂务）', () => {
  const cases: Array<[string, string]> = [
    ['科研 读LSTM论文', 'research'],
    ['学习 复习高数', 'study'],
    ['生活 买洗衣液', 'life'],
    ['杂务 交水电费', 'other'],
  ]
  it.each(cases)('「%s」→ area=%s', (input, area) => {
    submit(open('task'), input)
    const t = useStore.getState().tasks[0]
    expect(t.area).toBe(area)
  })
})

describe('边界与安全回落', () => {
  it('空输入：无任何写入', () => {
    const input = open('task')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useStore.getState().tasks).toHaveLength(0)
    expect(useStore.getState().events).toHaveLength(0)
    expect(useStore.getState().notes).toHaveLength(0)
  })

  it('无日期文本：「买洗衣液」→ Task 无 due（产品约定：不设日期）', () => {
    submit(open(), '买洗衣液')
    const t = useStore.getState().tasks[0]
    expect(t).toBeTruthy()
    expect(t.due).toBeUndefined()
  })

  it('auto 日期提示但解析失败：「下周组会」→ 安全回落 Task，不建错误 Event，并反馈', () => {
    submit(open(), '下周组会')
    const s = useStore.getState()
    expect(s.events).toHaveLength(0)
    expect(s.tasks[0].title).toBe('下周组会')
    expect(s.tasks[0].due).toBeUndefined()
    expect(useToast.getState().toasts.some((t) => t.message.includes('未能识别日期'))).toBe(true)
  })

  it('保存成功有反馈（任务）', () => {
    submit(open('task'), '买洗衣液')
    expect(useToast.getState().toasts.some((t) => t.message === '已保存为任务')).toBe(true)
  })

  it('保存成功有反馈（笔记）', () => {
    submit(open('note'), '记一下想法')
    expect(useToast.getState().toasts.some((t) => t.message === '已保存为笔记')).toBe(true)
  })
})

describe('保存前解析预览（Phase 3 #2）', () => {
  const previewText = () => document.querySelector('.qc-preview')?.textContent ?? ''

  it('输入后实时显示「类型 · 日期 · 时间 · area」', () => {
    const input = open('task')
    fireEvent.change(input, { target: { value: '生活 明天下午3点取快递' } })
    expect(previewText()).toContain('任务')
    expect(previewText()).toContain('明天 · 15:00 · 生活')
  })

  it('切换类型按钮 → 预览随之更新（显式选择优先）', () => {
    const input = open('task')
    fireEvent.change(input, { target: { value: '后天组会' } })
    expect(previewText()).toContain('任务')
    fireEvent.click(screen.getByText('日程'))
    expect(previewText()).toContain('日程')
    expect(previewText()).toContain('09:00') // 日程无时间默认 09:00
  })

  it('auto 解析失败 → 明确 warning，不静默', () => {
    const input = open()
    fireEvent.change(input, { target: { value: '下周组会' } })
    expect(previewText()).toContain('未能识别日期')
  })

  it('笔记模式 → 预览显示笔记', () => {
    const input = open('note')
    fireEvent.change(input, { target: { value: '记录一下刚才的想法' } })
    expect(previewText()).toContain('笔记')
  })

  it('空输入 → 无预览', () => {
    open('task')
    expect(document.querySelector('.qc-preview')).toBeNull()
  })
})
