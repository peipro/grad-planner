import { describe, it, expect, vi, afterEach } from 'vitest'
import { addDays, addMonths, addYears, format } from 'date-fns'
import { parseQuickAdd, combineDateTime, hasDateHint, addHoursToDatetime, taskDueOf, resolveCapturePlan, quickCapturePreview } from './natural'

// 「下周X」正确期望值（与实现语义一致：本周周一 + 7 + 周X偏移，周一为一周起点）
const nextWeekday = (target: number, base: Date = new Date()) =>
  addDays(addDays(base, -((base.getDay() + 6) % 7)), 7 + ((target + 6) % 7))

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

describe('相对日期扩展（Phase 2C 固定语义，勿更改解释）', () => {
  // 固定语义：半个月 = +15 天（不随月长变化，确定性取值）
  it('「半个月后」→ +15 天', () => {
    const r = parseQuickAdd('半个月后复习 LSTM')
    expect(r.date).toBe(format(addDays(new Date(), 15), 'yyyy-MM-dd'))
    expect(r.title).toBe('复习 LSTM')
  })

  it('「半月后」→ +15 天', () => {
    const r = parseQuickAdd('半月后提交报告')
    expect(r.date).toBe(format(addDays(new Date(), 15), 'yyyy-MM-dd'))
  })

  // 固定语义：N周半 = N×7 + 3 天（半周按 3 天整算，避免半天时区边界）
  it('「两周半后」→ +17 天（2×7+3）', () => {
    const r = parseQuickAdd('两周半后提交实验')
    expect(r.date).toBe(format(addDays(new Date(), 17), 'yyyy-MM-dd'))
    expect(r.title).toBe('提交实验')
  })

  it('「一周半后」→ +10 天（1×7+3）', () => {
    const r = parseQuickAdd('一周半后交作业')
    expect(r.date).toBe(format(addDays(new Date(), 10), 'yyyy-MM-dd'))
  })

  // 固定语义：下个月 = date-fns addMonths(+1)（日历月对齐）
  it('「下个月」→ addMonths +1（日历月对齐）', () => {
    const r = parseQuickAdd('下个月组会')
    expect(r.date).toBe(format(addMonths(new Date(), 1), 'yyyy-MM-dd'))
  })

  // 固定语义：明年 = date-fns addYears(+1)
  it('「明年」→ +1 年', () => {
    const r = parseQuickAdd('明年毕业论文')
    expect(r.date).toBe(format(addYears(new Date(), 1), 'yyyy-MM-dd'))
  })

  it('「下个礼拜三」与「下个星期三」完全等价', () => {
    const r1 = parseQuickAdd('下个礼拜三开会')
    const r2 = parseQuickAdd('下个星期三开会')
    expect(r1.date).toBe(r2.date)
    expect(r1.date).toBeTruthy()
  })

  it('「下礼拜二」也能识别（无「个」）', () => {
    const r = parseQuickAdd('下礼拜二交表')
    expect(r.date).toBeTruthy()
    expect(r.title).toBe('交表')
  })
})

describe('时段默认时间（无具体数字，Phase 2C 固定语义）', () => {
  // 固定默认：早上 08:00 · 上午 09:00 · 中午 12:00 · 下午 15:00 · 傍晚 18:00 · 晚上 19:00
  it('「后天上午去办事」→ 后天 + 09:00', () => {
    const r = parseQuickAdd('后天上午去办事')
    expect(r.date).toBe(format(addDays(new Date(), 2), 'yyyy-MM-dd'))
    expect(r.time).toBe('09:00')
    expect(r.title).toBe('去办事')
  })

  it('「明天上午」→ 明天 + 09:00（与「明上午」行为一致）', () => {
    const r = parseQuickAdd('明天上午组会')
    expect(r.date).toBe(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
    expect(r.time).toBe('09:00')
  })

  it('「下周三下午给导师发实验结果」→ 下周三 + 15:00', () => {
    const r = parseQuickAdd('下周三下午给导师发实验结果')
    expect(r.date).toBe(format(nextWeekday(3), 'yyyy-MM-dd'))
    expect(r.time).toBe('15:00')
    expect(r.title).toBe('给导师发实验结果')
  })

  it('「下个礼拜三下午开会」→ 礼拜三 + 15:00', () => {
    const r = parseQuickAdd('下个礼拜三下午开会')
    expect(r.date).toBe(format(nextWeekday(3), 'yyyy-MM-dd'))
    expect(r.time).toBe('15:00')
    expect(r.title).toBe('开会')
  })

  it('「今天晚上开会」→ 今天 + 19:00', () => {
    const r = parseQuickAdd('今天晚上开会')
    expect(r.date).toBe(format(new Date(), 'yyyy-MM-dd'))
    expect(r.time).toBe('19:00')
    expect(r.title).toBe('开会')
  })

  it('标题中间的时段词不误伤：「商量一下下午的安排」不设时间', () => {
    const r = parseQuickAdd('商量一下下午的安排')
    expect(r.time).toBeUndefined()
    expect(r.title).toBe('商量一下下午的安排')
  })
})

describe('下周X 跨周边界（回归：周四周末不再跳到下下周）', () => {
  afterEach(() => vi.useRealTimers())

  it('周六说「下周三」→ 下周周三（此前会跳到下下周三）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T08:00:00')) // 周六
    const r = parseQuickAdd('下周三组会')
    expect(r.date).toBe('2026-08-19')
    expect(r.title).toBe('组会')
  })

  it('周日说「下周一」→ 次日周一', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-16T08:00:00')) // 周日
    const r = parseQuickAdd('下周一开会')
    expect(r.date).toBe('2026-08-17')
  })

  it('周三说「下周三」→ 7 天后', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T08:00:00')) // 周三
    const r = parseQuickAdd('下周三开会')
    expect(r.date).toBe('2026-08-19')
  })

  it('周四说「下周五」→ 8 天后', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T08:00:00')) // 周四
    const r = parseQuickAdd('下周五交表')
    expect(r.date).toBe('2026-08-21')
  })
})

describe('taskDueOf（Phase 3 统一 due 构造：QuickCapture/TodoView/Today 共用，禁止各入口自造逻辑）', () => {
  afterEach(() => vi.useRealTimers())
  const setNow = () => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-15T08:00:00')) }

  it('date + time → dateTtime（时间不丢失）', () => {
    expect(taskDueOf({ title: 'x', date: '2026-08-19', time: '15:00' })).toBe('2026-08-19T15:00:00')
  })

  it('仅 time → 今天 + time（时间隐含今天）', () => {
    setNow()
    expect(taskDueOf({ title: 'x', time: '15:00' })).toBe('2026-08-15T15:00:00')
  })

  it('仅 date → dateT12:00:00（产品默认正午）', () => {
    expect(taskDueOf({ title: 'x', date: '2026-08-19' })).toBe('2026-08-19T12:00:00')
  })

  it('都无 → undefined（不设日期）', () => {
    expect(taskDueOf({ title: 'x' })).toBeUndefined()
  })

  it('都无 + defaultToToday → 今天 12:00（Today 入口默认，其余入口不默认）', () => {
    setNow()
    expect(taskDueOf({ title: 'x' }, true)).toBe('2026-08-15T12:00:00')
    expect(taskDueOf({ title: 'x' })).toBeUndefined()
  })
})

describe('resolveCapturePlan（Phase 3 #2：预览与保存共用同一决策）', () => {
  it('auto：日期提示 + 解析成功 → 日程', () => {
    const plan = resolveCapturePlan('明天组会', 'auto')
    expect(plan.kind).toBe('event')
    expect(plan.dateHintFailed).toBe(false)
  })

  it('auto：无日期提示 → 任务', () => {
    const plan = resolveCapturePlan('买洗衣液', 'auto')
    expect(plan.kind).toBe('task')
  })

  it('auto：有日期提示但解析失败 → 任务 + dateHintFailed（不得静默生成错误日程）', () => {
    const plan = resolveCapturePlan('下周组会', 'auto')
    expect(plan.kind).toBe('task')
    expect(plan.dateHintFailed).toBe(true)
  })

  it('显式选择优先：task 模式下带日期也是任务', () => {
    expect(resolveCapturePlan('下周三组会', 'task').kind).toBe('task')
  })

  it('显式选择优先：event 模式下无日期也是日程', () => {
    expect(resolveCapturePlan('随便记个日程', 'event').kind).toBe('event')
  })

  it('note 模式 → 笔记', () => {
    expect(resolveCapturePlan('记录一下想法', 'note').kind).toBe('note')
  })
})

describe('quickCapturePreview 保存前预览（Phase 3 #2）', () => {
  afterEach(() => vi.useRealTimers())

  it('任务：date+time+area → 「任务 · 明天 · 15:00 · 生活」', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-15T08:00:00'))
    const p = resolveCapturePlan('生活 明天下午3点取快递', 'task')
    const v = quickCapturePreview(p)
    expect(v.kind).toBe('任务')
    expect(v.detail).toBe('明天 · 15:00 · 生活')
    expect(v.warning).toBeUndefined()
  })

  it('任务：仅日期 → 12:00 默认', () => {
    const p = resolveCapturePlan('8月19日交报告', 'task')
    const v = quickCapturePreview(p)
    expect(v.detail).toContain('12:00')
  })

  it('任务：无日期无时间 → 「未设日期」', () => {
    const v = quickCapturePreview(resolveCapturePlan('买洗衣液', 'task'))
    expect(v.detail).toBe('未设日期')
  })

  it('日程：仅日期 → 09:00 默认', () => {
    const p = resolveCapturePlan('后天组会', 'event')
    const v = quickCapturePreview(p)
    expect(v.kind).toBe('日程')
    expect(v.detail).toContain('09:00')
  })

  it('解析失败 → 明确 warning（不静默）', () => {
    const p = resolveCapturePlan('下周组会', 'auto')
    const v = quickCapturePreview(p)
    expect(v.warning).toContain('未能识别日期')
    expect(v.detail).toBe('未设日期')
  })

  it('笔记 → 无明细', () => {
    const v = quickCapturePreview(resolveCapturePlan('记一下', 'note'))
    expect(v.kind).toBe('笔记')
    expect(v.detail).toBe('')
  })
})
