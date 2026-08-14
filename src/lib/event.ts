import { CalEvent } from '../types'

/** 判断事件是否覆盖某一天(YYYY-MM-DD)——支持跨天日程 */
export function eventSpansDay(e: CalEvent, dateStr: string): boolean {
  if (!e.start) return false
  const start = e.start.slice(0, 10)
  if (start === dateStr) return true
  const end = e.end ? e.end.slice(0, 10) : start
  return start < dateStr && end >= dateStr
}
