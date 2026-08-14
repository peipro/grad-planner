import { addDays, addWeeks, addMonths, addHours, format } from 'date-fns'

export interface ParsedQuickAdd {
  title: string
  date?: string
  time?: string
  priority?: 'high' | 'medium' | 'low'
  type?: 'deadline' | 'meeting' | 'course' | 'personal'
}

const WEEKDAYS: Record<string, number> = {
  日: 0, 天: 0,
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
}

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

  // 下周X
  const nextWeek = rest.match(/下(个)?星期([一-日天])|下(个)?周([一-日天])/)
  if (!date && nextWeek) {
    const wd = (nextWeek[2] ?? nextWeek[4])!
    const target = WEEKDAYS[wd]
    const diff = (target - now.getDay() + 7) % 7
    date = addDays(now, diff + 7) // 跳到下周
    rest = rest.replace(nextWeek[0], '')
  }

  // 这周X
  const thisWeek = rest.match(/(这个|本)?星期([一-日天])|(这个|本)?周([一-日天])/)
  if (!date && thisWeek) {
    const wd = (thisWeek[2] ?? thisWeek[4])!
    const target = WEEKDAYS[wd]
    const diff = (target - now.getDay() + 7) % 7
    date = addDays(now, diff === 0 && !thisWeek[1] && !thisWeek[3] ? 0 : diff)
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

  // 清理空白和标点
  rest = rest.replace(/[，。！？\s]+/g, ' ').trim()
  if (rest) result.title = rest

  if (date) result.date = format(date, 'yyyy-MM-dd')
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
