// 研途计划 · 共享数据顶层结构校验（LAN 服务器 / 主进程侧，CJS）
// 权威字段清单：src/data/schema.ts 必须与之一致（由 src/data/schema.test.ts 锁定）

const STORAGE_ARRAY_FIELDS = [
  'events',
  'tasks',
  'milestones',
  'notes',
  'pomodoros',
  'birthdays',
  'habits',
  'projects',
  'papers',
  'paperStages',
]

// 宽松校验：根必须是对象；已存在的数组字段必须是数组；paperStages 元素必须是字符串。
// 缺失字段视为合法（老版本数据），由上层 merge / 默认值补齐。
function validateStorageShape(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['根节点必须是对象'] }
  }
  const errors = []
  for (const field of STORAGE_ARRAY_FIELDS) {
    const v = value[field]
    if (v === undefined) continue
    if (!Array.isArray(v)) {
      errors.push(`字段 ${field} 必须是数组`)
      continue
    }
    if (field === 'paperStages') {
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] !== 'string') {
          errors.push(`paperStages[${i}] 必须是字符串`)
          break
        }
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

module.exports = { STORAGE_ARRAY_FIELDS, validateStorageShape }
