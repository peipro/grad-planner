import { Solar, Lunar } from 'lunar-javascript'
import { Birthday } from '../types'

export interface LunarDate {
  month: number
  day: number
  isLeap: boolean
}

/** 阳历日期 → 农历(月/日/是否闰月) */
export function solarToLunar(year: number, month: number, day: number): LunarDate | null {
  try {
    const lunar = Solar.fromYmd(year, month, day).getLunar()
    const m = lunar.getMonth()
    return { month: Math.abs(m), day: lunar.getDay(), isLeap: m < 0 }
  } catch {
    return null
  }
}

/** 某年农历月日 → 对应公历日期;闰月年份无该闰月时回退非闰月;不存在返回 null */
export function lunarToSolar(year: number, lunarMonth: number, lunarDay: number, isLeap: boolean = false): Date | null {
  try {
    const lunar = Lunar.fromYmd(year, isLeap ? -lunarMonth : lunarMonth, lunarDay)
    const s = lunar.getSolar()
    return new Date(s.getYear(), s.getMonth() - 1, s.getDay())
  } catch {
    if (isLeap) {
      try {
        const lunar = Lunar.fromYmd(year, lunarMonth, lunarDay)
        const s = lunar.getSolar()
        return new Date(s.getYear(), s.getMonth() - 1, s.getDay())
      } catch {
        return null
      }
    }
    return null
  }
}

/** 计算某生日今年/明年最近一次对应的公历日期 */
export function nextBirthdayDate(b: Birthday, today: Date = new Date()): Date | null {
  const y = today.getFullYear()
  if (b.calendarType === 'solar' && b.solarMonth && b.solarDay) {
    const tryYear = (yr: number): Date | null => {
      const d = new Date(yr, b.solarMonth! - 1, b.solarDay!)
      return isNaN(d.getTime()) ? null : d
    }
    let d = tryYear(y)
    if (!d) return null
    if (d < today) {
      const nd = tryYear(y + 1)
      d = nd ?? d
    }
    return d
  }
  if (b.lunarMonth && b.lunarDay) {
    for (const yr of [y, y + 1]) {
      const d = lunarToSolar(yr, b.lunarMonth, b.lunarDay, !!b.isLeapMonth)
      if (d && d >= today) return d
    }
  }
  return null
}

/** 计算距最近一次生日的剩余天数(0 表示今天) */
export function daysUntilBirthday(b: Birthday, today: Date = new Date()): number | null {
  const next = nextBirthdayDate(b, today)
  if (!next) return null
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const n = new Date(next.getFullYear(), next.getMonth(), next.getDate())
  return Math.round((n.getTime() - t.getTime()) / 86400000)
}

/** 生日描述文本:农历/阳历信息 */
export function birthdayDesc(b: Birthday): string {
  if (b.calendarType === 'solar' && b.solarMonth && b.solarDay) {
    return `阳历 ${b.solarMonth}月${b.solarDay}日`
  }
  if (b.lunarMonth && b.lunarDay) {
    return `农历${b.isLeapMonth ? '闰' : ''}${b.lunarMonth}月${b.lunarDay}日`
  }
  return ''
}

const MONTH_CN = ['', '正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
const DAY_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十', '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十']

/** 农历中文描述,如"八月廿四" */
export function lunarCn(month: number, day: number, isLeap: boolean = false): string {
  const m = month >= 1 && month <= 12 ? MONTH_CN[month] : String(month)
  const d = day >= 1 && day <= 30 ? DAY_CN[day] : String(day)
  return `${isLeap ? '闰' : ''}${m}月${d}`
}

/** 排序:按距最近生日的剩余天数升序 */
export function sortByUpcoming(birthdays: Birthday[], today: Date = new Date()): Birthday[] {
  return [...birthdays].sort((a, b) => {
    const da = daysUntilBirthday(a, today) ?? 99999
    const db = daysUntilBirthday(b, today) ?? 99999
    return da - db
  })
}
