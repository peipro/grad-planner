import { describe, it, expect } from 'vitest'
import { eventSpansDay } from './event'
import { CalEvent } from '../types'

const ev = (start: string, end: string): CalEvent => ({ id: '1', title: 'x', start, end, type: 'personal' })

describe('eventSpansDay', () => {
  it('当天事件覆盖当天', () => {
    expect(eventSpansDay(ev('2025-01-01T09:00', '2025-01-01T10:00'), '2025-01-01')).toBe(true)
  })

  it('跨天事件覆盖结束日', () => {
    expect(eventSpansDay(ev('2025-01-01T23:00', '2025-01-02T02:00'), '2025-01-02')).toBe(true)
  })

  it('跨天事件覆盖中间日', () => {
    expect(eventSpansDay(ev('2025-01-01T23:00', '2025-01-03T02:00'), '2025-01-02')).toBe(true)
  })

  it('不覆盖无关日期', () => {
    expect(eventSpansDay(ev('2025-01-01T09:00', '2025-01-01T10:00'), '2025-01-02')).toBe(false)
  })
})
