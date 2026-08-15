import { addDays, addWeeks, addMonths, addYears, addHours, format } from 'date-fns'
import { TaskArea } from '../types'
import { localDateKey, AREA_LABELS } from './today'

export interface ParsedQuickAdd {
  title: string
  date?: string
  time?: string
  priority?: 'high' | 'medium' | 'low'
  type?: 'deadline' | 'meeting' | 'course' | 'personal'
  area?: TaskArea
}

const WEEKDAYS: Record<string, number> = {
  日: 0, 天: 0,
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
}

// 中文数字 → 整数（仅单个字符：一~十 + 两）。固定映射，供「两周半」等中文数字相对日期使用
const CN_NUM: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

// 星期枚举（必须显式枚举！历史 bug：[一-日天] 是 Unicode 范围 U+4E00..U+65E5，
// 会把「半/周/两」等汉字误判为星期字符）
const WEEKDAY_CHARS = '[一二三四五六日天]'

/** 解析输入文本中的自然语言，返回结构化结果（title 为去除日期关键词后的标题） */
export function parseQuickAdd(text: string): ParsedQuickAdd {
  const result: ParsedQuickAdd = { title: text.trim() }
  let rest = text.trim()

  // ---- 优先级 ----
  // 低优先级优先匹配（避免"不急"误匹配"急"）
  const lowPrio = rest.match(/(不急|不着急|有空再说|低优先级|低优先|次要|琐事|随便)/)
  if (lowPrio) {
    result.priority = 'low'
    rest = rest.replace(lowPrio[0], '')
  }
  const highPrio = rest.match(/(紧急|很重要|非常重要|高优先级|高优先|优先|尽快|加急|最重要|马上|立即|asap)/i)
  if (!result.priority && highPrio) {
    result.priority = 'high'
    rest = rest.replace(highPrio[0], '')
  }
  const medPrio = rest.match(/(中优先级|中优先|一般|普通)/)
  if (!result.priority && medPrio) {
    result.priority = 'medium'
    rest = rest.replace(medPrio[0], '')
  }

  // ---- area 领域分类（Phase 2B）：仅识别开头词 + 后跟空白/结尾，避免误伤标题内关键词 ----
  const areaRules: Array<[RegExp, TaskArea]> = [
    [/^(科研|研究)(?=\s|$)/, 'research'],
    [/^(学习|课程|作业)(?=\s|$)/, 'study'],
    [/^(生活|家务)(?=\s|$)/, 'life'],
    [/^(杂务|杂事)(?=\s|$)/, 'other'],
  ]
  for (const [re, area] of areaRules) {
    const m = rest.match(re)
    if (m) {
      const after = rest.slice(m[0].length).trim()
      if (after) {
        result.area = area
        rest = after
        break
      }
    }
  }

  // ---- 任务类型 ----
  if (/组会|会议|开会|meeting/i.test(rest)) result.type = 'meeting'
  else if (/截止|提交|ddl|交稿/i.test(rest)) result.type = 'deadline'
  else if (/课程|上课|lecture|exam|考试/i.test(rest)) result.type = 'course'

  // ---- 相对日期 ----
  let date: Date | undefined
  let time: string | undefined

  const today = (d: Date) => d
  const tomorrow = (d: Date) => addDays(d, 1)

  // 今天是X月X日/星期X 时，直接给基准日
  const now = new Date()

  // "N天后" / "N天以后" / "N个星期后" / "N个月后"
  const ndays = rest.match(/(\d+)\s*(天|日)后/)
  if (ndays) {
    date = addDays(now, Number(ndays[1]))
    rest = rest.replace(ndays[0], '')
  }
  const nweeks = rest.match(/(\d+)\s*个?星期后|(\d+)\s*个?周后|下(个)?周后/)
  const nmonths = rest.match(/(\d+)\s*个?月后/)

  if (!date && nmonths) {
    date = addMonths(now, Number(nmonths[1]))
    rest = rest.replace(nmonths[0], '')
  }
  if (!date && nweeks) {
    const n = Number(nweeks[1] ?? nweeks[2] ?? 1)
    date = addWeeks(now, isNaN(n) ? 1 : n)
    rest = rest.replace(nweeks[0], '')
  }

  // ---- 相对日期扩展（Phase 2C Quick Capture）----
  // 固定语义（已在测试注释中锁定，勿随意更改）：
  //   「半个月后 / 半月后」= +15 天（固定，不随月长变化）
  //   「N周半后 / N星期半后」= N×7 + 3 天（半周固定按 3 天，避免半天时区边界）
  //   「下个月」= addMonths(now, 1)（日历月对齐，date-fns 语义）
  //   「明年」= addYears(now, 1)
  const halfMonth = rest.match(/半个?月(后)?/)
  if (!date && halfMonth) {
    date = addDays(now, 15)
    rest = rest.replace(halfMonth[0], '')
  }
  const weekHalf = rest.match(/([0-9一两二三四五六七八九十])\s*个?(星期|周)半(后)?/)
  if (!date && weekHalf) {
    const n = Number(weekHalf[1]) || CN_NUM[weekHalf[1]] || 0
    date = addDays(now, n * 7 + 3)
    rest = rest.replace(weekHalf[0], '')
  }
  const nextMonth = rest.match(/下个?月/)
  if (!date && nextMonth) {
    date = addMonths(now, 1)
    rest = rest.replace(nextMonth[0], '')
  }
  const nextYear = rest.match(/明年/)
  if (!date && nextYear) {
    date = addYears(now, 1)
    rest = rest.replace(nextYear[0], '')
  }

  // 下周X（「下个礼拜三」与「下个星期三」等价）
  // 语义：下周X = 本周周一 + 7 + 周X偏移（周一为一周起点）
  // 历史 bug：diff+7 在周四~周日会多跳一周 → 识别成下下周（如周六说「下周三」跳到下下周三）
  const nextWeek = rest.match(new RegExp('下(个)?(星期|礼拜)(' + WEEKDAY_CHARS + ')|下(个)?周(' + WEEKDAY_CHARS + ')'))
  if (!date && nextWeek) {
    const wd = (nextWeek[3] ?? nextWeek[5])!
    const target = WEEKDAYS[wd]
    const monday = addDays(now, -((now.getDay() + 6) % 7)) // 本周周一（周一=0 偏移）
    date = addDays(monday, 7 + ((target + 6) % 7))
    rest = rest.replace(nextWeek[0], '')
  }

  // 这周X
  const thisWeek = rest.match(new RegExp('(这个|本)?(星期|礼拜)(' + WEEKDAY_CHARS + ')|(这个|本)?周(' + WEEKDAY_CHARS + ')'))
  if (!date && thisWeek) {
    const wd = (thisWeek[3] ?? thisWeek[5])!
    const target = WEEKDAYS[wd]
    const diff = (target - now.getDay() + 7) % 7
    date = addDays(now, diff === 0 && !thisWeek[1] && !thisWeek[4] ? 0 : diff)
    rest = rest.replace(thisWeek[0], '')
  }

  // 明天 / 后天 / 大后天 / 今天 / 昨天
  const rel = rest.match(/大后天|后天|明天|今天|昨天/)
  if (!date && rel) {
    const map: Record<string, (d: Date) => Date> = {
      大后天: (d) => addDays(d, 3),
      后天: (d) => addDays(d, 2),
      明天: tomorrow,
      今天: today,
      昨天: (d) => addDays(d, -1),
    }
    date = map[rel[0]](now)
    rest = rest.replace(rel[0], '')
  }

  // 明早/明晚/今晚/今早 → 日期 + 时段(若紧跟具体时间则把时段留给时间解析)
  const periodRel = rest.match(/明早|明上午|明晚|明中午|今晚|今早|今上午|今中午/)
  if (!date && periodRel) {
    const map: Record<string, { days: number; period: string; time: string }> = {
      明早: { days: 1, period: '早上', time: '08:00' },
      明上午: { days: 1, period: '上午', time: '09:00' },
      明中午: { days: 1, period: '中午', time: '12:00' },
      明晚: { days: 1, period: '晚上', time: '19:00' },
      今晚: { days: 0, period: '晚上', time: '19:00' },
      今早: { days: 0, period: '早上', time: '08:00' },
      今上午: { days: 0, period: '上午', time: '09:00' },
      今中午: { days: 0, period: '中午', time: '12:00' },
    }
    const entry = map[periodRel[0]]
    date = addDays(now, entry.days)
    const after = rest.slice(periodRel.index! + periodRel[0].length)
    if (/^\s*\d{1,2}[:：点时]/.test(after)) {
      rest = rest.replace(periodRel[0], entry.period)
    } else {
      if (!time) time = entry.time
      rest = rest.replace(periodRel[0], '')
    }
  }

  // 具体日期 "X月X日"
  const md = rest.match(/(\d{1,2})月(\d{1,2})[日号]/)
  if (!date && md) {
    date = new Date(now.getFullYear(), Number(md[1]) - 1, Number(md[2]))
    rest = rest.replace(md[0], '')
  }

  // 时间 "早上8点" "下午3点半" "15:00" "晚上7点" "凌晨12点" "3点一刻"
  const timeMatch = rest.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(\d{1,2})[:：点时](半|[一两二三四五六七八]刻|\d{1,2})?分?/)
  if (timeMatch) {
    let h = Number(timeMatch[2])
    const minRaw = timeMatch[3]
    const KE: Record<string, number> = { 一: 15, 两: 30, 二: 30, 三: 45 }
    let min = 0
    if (minRaw) {
      if (minRaw === '半') min = 30
      else if (minRaw.endsWith('刻')) min = KE[minRaw[0]] ?? 0
      else min = Number(minRaw)
    }
    const period = timeMatch[1]
    if (period === '凌晨') {
      if (h === 12) h = 0
    } else if (period === '中午') {
      if (h < 12) h += 12
    } else if (period === '下午' || period === '傍晚' || period === '晚上') {
      if (h < 12) h += 12
      else if (h === 12 && period === '晚上') h = 0
    }
    h = ((h % 24) + 24) % 24
    time = `${String(h).padStart(2, '0')}:${String(Math.min(min, 59)).padStart(2, '0')}`
    rest = rest.replace(timeMatch[0], '')
  }

  // 仅时段词在开头且无具体数字（如「后天上午去办事」的「上午」）→ 时段默认时间
  // 只在 rest 开头匹配，避免误伤标题中间的时段词（如「商量一下下午的安排」）
  // 固定默认（已在测试注释中锁定）：早上 08:00 · 上午 09:00 · 中午 12:00 · 下午 15:00 · 傍晚 18:00 · 晚上 19:00
  const periodStart = rest.match(/^(早上|上午|中午|下午|傍晚|晚上)/)
  if (!time && periodStart) {
    const DEFAULT_TIME: Record<string, string> = {
      早上: '08:00', 上午: '09:00', 中午: '12:00', 下午: '15:00', 傍晚: '18:00', 晚上: '19:00',
    }
    time = DEFAULT_TIME[periodStart[0]]
    rest = rest.replace(periodStart[0], '')
  }

  // 清理空白和标点
  rest = rest.replace(/[，。！？\s]+/g, ' ').trim()
  if (rest) result.title = rest

  if (date) result.date = format(date, "yyyy-MM-dd")
  if (time) result.time = time

  return result
}

/** 把解析结果组合成完整 datetime-local 字符串 */
export function combineDateTime(date?: string, time?: string): string {
  if (date && time) return `${date}T${time}`
  if (date) return `${date}T09:00`
  if (time) return `${format(new Date(), 'yyyy-MM-dd')}T${time}`
  return format(new Date(), "yyyy-MM-dd'T'HH:mm")
}

/** 计算一个 datetime-local 字符串加上 N 小时后的结果(正确处理跨天、越界) */
export function addHoursToDatetime(datetime: string, hours = 1): string {
  const d = new Date(datetime)
  if (isNaN(d.getTime())) return datetime
  return format(addHours(d, hours), "yyyy-MM-dd'T'HH:mm")
}

/** 判断字符串里是否含有可解析的日期线索 */
export function hasDateHint(text: string): boolean {
  return /(天|周|星期|月|号|日|点|时|:\d)/.test(text)
}

/**
 * 把解析结果组合成 Task 的 due（datetime-local 字符串）。
 * 固定语义（QuickCapture / TodoView / Today 快速添加共用，禁止各自造 due 逻辑）：
 *   - date + time → dateTtime（时间不丢失）
 *   - 仅 time     → 今天 + time（时间隐含今天）
 *   - 仅 date     → dateT12:00:00（产品默认正午）
 *   - 都无        → defaultToToday ? 今天 12:00 : undefined
 */
export function taskDueOf(parsed: ParsedQuickAdd, defaultToToday = false): string | undefined {
  const today = localDateKey()
  // 统一输出格式（含秒）：HH:mm → HH:mm:00，保证所有入口 due 一致可预测
  if (parsed.time) {
    const t = `${parsed.time}:00`
    return parsed.date ? `${parsed.date}T${t}` : `${today}T${t}`
  }
  if (parsed.date) return `${parsed.date}T12:00:00`
  return defaultToToday ? `${today}T12:00:00` : undefined
}

// ===== Quick Capture 类型判定 + 保存前预览（Phase 3 #2）=====
// 预览与保存共用 resolveCapturePlan，保证「所见即所存」

export type QuickCaptureMode = 'auto' | 'task' | 'event' | 'note'

export interface CapturePlan {
  kind: 'task' | 'event' | 'note'
  parsed: ParsedQuickAdd
  /** auto 模式：有日期提示但解析失败（回落任务且不设日期，需明确提示） */
  dateHintFailed: boolean
}

/** 类型判定：显式选择 > auto 规则（auto：日期提示 + 解析成功 → 日程；否则 → 任务） */
export function resolveCapturePlan(text: string, mode: QuickCaptureMode): CapturePlan {
  const parsed = parseQuickAdd(text)
  if (mode === 'note') return { kind: 'note', parsed, dateHintFailed: false }
  const hint = hasDateHint(text)
  const isEvent = mode === 'event' || (mode === 'auto' && hint && !!parsed.date)
  return { kind: isEvent ? 'event' : 'task', parsed, dateHintFailed: mode === 'auto' && hint && !parsed.date }
}

/** 相对日期展示：今天 / 明天 / 昨天 / M月d日 */
export function relativeDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((d.getTime() - todayStart.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export interface CapturePreviewText {
  kind: string
  detail: string
  warning?: string
}

/** 保存前预览文案（与 parse 共用 resolveCapturePlan，预览即最终保存内容） */
export function quickCapturePreview(plan: CapturePlan): CapturePreviewText {
  const p = plan.parsed
  if (plan.kind === 'note') return { kind: '笔记', detail: '' }

  if (plan.kind === 'event') {
    // 与 combineDateTime 语义一致：无 date → 今天；无 time 有 date → 09:00；都无 → 当前时刻
    const dateLabel = p.date ? relativeDateLabel(p.date) : '今天'
    const timeLabel = p.time ?? (p.date ? '09:00' : format(new Date(), 'HH:mm'))
    return { kind: '日程', detail: `${dateLabel} · ${timeLabel}` }
  }

  // task：与 taskDueOf 语义一致（time → 该时间；仅 date → 12:00）
  const parts: string[] = []
  if (p.date) parts.push(relativeDateLabel(p.date))
  if (p.time) parts.push(p.time)
  else if (p.date) parts.push('12:00')
  if (p.area) parts.push(AREA_LABELS[p.area] ?? '')
  const detail = parts.filter(Boolean).join(' · ') || '未设日期'
  return {
    kind: '任务',
    detail,
    warning: plan.dateHintFailed ? '未能识别日期，将保存为任务（未设日期）' : undefined,
  }
}
