// 研途计划 · 统一数据校验层（renderer 侧）
// 供：LAN PUT（对应 CJS 版本）、导入、恢复、持久化 merge 使用同一套结构校验。
// 语义：宽松校验 —— 根必须是对象；已存在的数组字段必须是数组；paperStages 元素必须是字符串；
//       缺失字段视为合法（老版本数据），由上层 merge / 默认值补齐。

import { STORAGE_ARRAY_FIELDS } from './schema'

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

export function validateStorageShape(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['根节点必须是对象'] }
  }
  const errors: string[] = []
  const root = value as Record<string, unknown>
  for (const field of STORAGE_ARRAY_FIELDS) {
    const v = root[field]
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
