/** 四舍五入到 1 位小数，消除浮点累积误差（46.599999999999994 → 46.6） */
export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 将分钟数格式化为时长文本：46.6 min · 1h 25m · 2h，最多保留 1 位小数 */
export function formatMinutes(min: number): string {
  const r = round1(min)
  if (r < 60) {
    const whole = Math.floor(r)
    const frac = Math.round((r - whole) * 10) / 10
    return frac > 0 ? `${r} min` : `${whole} min`
  }
  const h = Math.floor(r / 60)
  const m = Math.round((r - h * 60) * 10) / 10
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
