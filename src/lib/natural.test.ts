import { describe, it, expect } from 'vitest'
import { addDays, format } from 'date-fns'
import { parseQuickAdd, combineDateTime, hasDateHint, addHoursToDatetime } from './natural'

describe('parseQuickAdd 时间解析', () => {
  it('解析「下午3点半」为 15:30', () => {
    const r = parseQuickAdd('下午3点半开会')
    expect(r.time).toBe('15:30')
  })

  it('解析「晚上7点」为 19:00 并识别组会', () => {
    const r = parseQuickAdd('晚上7点组会')
    expect(r.time).toBe('19:00')
    expect(r.type).toBe('meeting')
  })

  it('解析「凌晨12点」为 00:00', () => {
    const r = parseQuickAdd('凌晨12点出发')
    expect(r.time).toBe('00:00')
  })

  it('解析「凌晨1点」为 01:00', () => {
    const r = parseQuickAdd('凌晨1点')
    expect(r.time).toBe('01:00')
  })

  it('解析「15:00」为 15:00', () => {
    const r = parseQuickAdd('15:00 提交')
    expect(r.time).toBe('15:00')
  })

  it('解析「上午10点15分」为 10:15', () => {
    const r = parseQuickAdd('上午10点15分')
    expect(r.time).toBe('10:15')
  })

  it('解析「中午12点半」为 12:30', () => {
    const r = parseQuickAdd('中午12点半')
    expect(r.time).toBe('12:30')
  })

  it('解析「中午1点」为 13:00', () => {
    const r = parseQuickAdd('中午1点')
    expect(r.time).toBe('13:00')
  })

  it('解析「下午3点」为 15:00', () => {
    const r = parseQuickAdd('下午3点')
    expect(r.time).toBe('15:00')
  })

  it('解析「晚上12点」为 00:00', () => {
    const r = parseQuickAdd('晚上12点')
    expect(r.time).toBe('00:00')
  })

  it('「半」不残留进标题', () => {
    const r = parseQuickAdd('下午3点半开会')
    expect(r.title).not.toContain('半')
  })
})

describe('parseQuickAdd 优先级', () => {
  it('「紧急」→ high', () => {
    expect(parseQuickAdd('紧急 交报告').priority).toBe('high')
  })

  it('「不急」→ low', () => {
    expect(parseQuickAdd('不急 看文献').priority).toBe('low')
  })
})

describe('parseQuickAdd 日期', () => {
  it('「明天」解析出次日日期', () => {
    const r = parseQuickAdd('明天交报告')
    expect(r.date).toBeTruthy()
    expect(r.date).toBe(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
  })
})

describe('combineDateTime', () => {
  it('日期+时间拼接', () => {
    expect(combineDateTime('2025-01-02', '15:30')).toBe('2025-01-02T15:30')
  })

  it('仅日期默认 09:00', () => {
    expect(combineDateTime('2025-01-02')).toBe('2025-01-02T09:00')
  })
})

describe('hasDateHint', () => {
  it('检测到日期线索', () => {
    expect(hasDateHint('明天3点')).toBe(true)
    expect(hasDateHint('写完论文')).toBe(false)
  })
})

describe('addHoursToDatetime', () => {
  it('普通时间 +1 小时', () => {
    expect(addHoursToDatetime('2025-01-02T15:00')).toBe('2025-01-02T16:00')
  })

  it('23 点加 1 小时跨天到次日 00:00', () => {
    expect(addHoursToDatetime('2025-01-02T23:00')).toBe('2025-01-03T00:00')
  })

  it('跨月边界', () => {
    expect(addHoursToDatetime('2025-01-31T23:30')).toBe('2025-02-01T00:30')
  })

  it('非法输入原样返回', () => {
    expect(addHoursToDatetime('invalid')).toBe('invalid')
  })
})

describe('相对时段 明早/明晚/今晚/今早', () => {
  it('「明早9点」→ 明天 09:00', () => {
    const r = parseQuickAdd('明早9点开会')
    expect(r.date).toBe(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
    expect(r.time).toBe('09:00')
    expect(r.title).toBe('开会')
  })

  it('「明晚组会」→ 明天 19:00 默认时段 + 识别组会', () => {
    const r = parseQuickAdd('明晚组会')
    expect(r.date).toBe(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
    expect(r.time).toBe('19:00')
    expect(r.type).toBe('meeting')
  })

  it('「今晚8点」→ 今天 20:00', () => {
    const r = parseQuickAdd('今晚8点')
    expect(r.date).toBe(format(new Date(), 'yyyy-MM-dd'))
    expect(r.time).toBe('20:00')
  })
})

describe('「刻」时间解析', () => {
  it('「下午3点一刻」→ 15:15', () => {
    expect(parseQuickAdd('下午3点一刻').time).toBe('15:15')
  })

  it('「下午3点三刻」→ 15:45', () => {
    expect(parseQuickAdd('下午3点三刻').time).toBe('15:45')
  })
})

describe('parseQuickAdd area 领域分类（Phase 2B）', () => {
  it('「生活 买洗衣液」→ area=life，标题不含前缀', () => {
    const r = parseQuickAdd('生活 买洗衣液')
    expect(r.area).toBe('life')
    expect(r.title).toBe('买洗衣液')
  })

  it('「科研 读LSTM论文」→ area=research', () => {
    const r = parseQuickAdd('科研 读LSTM论文')
    expect(r.area).toBe('research')
    expect(r.title).toBe('读LSTM论文')
  })

  it('「学习 复习高数」→ area=study', () => {
    const r = parseQuickAdd('学习 复习高数')
    expect(r.area).toBe('study')
  })

  it('「杂务 交水电费」→ area=other', () => {
    const r = parseQuickAdd('杂务 交水电费')
    expect(r.area).toBe('other')
  })

  it('「研究一下LSTM」不作为 area（词后非空白，避免误伤标题）', () => {
    const r = parseQuickAdd('研究一下LSTM的注意力机制')
    expect(r.area).toBeUndefined()
    expect(r.title).toContain('研究一下')
  })

  it('area 前缀与日期/优先级并存', () => {
    const r = parseQuickAdd('生活 明天下午3点紧急取快递')
    expect(r.area).toBe('life')
    expect(r.priority).toBe('high')
    expect(r.date).toBe(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
    expect(r.time).toBe('15:00')
    expect(r.title).toBe('取快递')
  })

  it('无 area 前缀时 area 为空', () => {
    expect(parseQuickAdd('买洗衣液').area).toBeUndefined()
  })
})
