import { describe, it, expect } from 'vitest'
import { STORAGE_ARRAY_FIELDS } from './schema'
import { validateStorageShape } from './validate'

// 动态加载 LAN 侧 CJS 实现（vitest 运行在 Node 环境）
// @ts-expect-error - CJS 模块无类型声明，运行时由 vitest 解析
const cjs: any = await import('../../electron/storage-schema.cjs')

describe('数据校验层：TS 与 LAN(CJS) 一致性', () => {
  it('数组字段清单一致', () => {
    expect([...STORAGE_ARRAY_FIELDS]).toEqual(cjs.STORAGE_ARRAY_FIELDS)
  })

  it('两个 validate 实现行为一致（同输入同结果）', () => {
    const samples = [
      { events: [], tasks: [] },
      { events: 'bad' },
      { tasks: [1, 2] },
      { paperStages: ['a', 3] },
      { milestones: [{}, {}] },
      {},
      null,
      42,
      'str',
      [],
    ]
    for (const s of samples) {
      const a = validateStorageShape(s)
      const b = cjs.validateStorageShape(s)
      expect(a.ok).toBe(b.ok)
      expect(a.errors).toEqual(b.errors)
    }
  })
})

describe('validateStorageShape', () => {
  it('根节点非对象报错', () => {
    expect(validateStorageShape(null).ok).toBe(false)
    expect(validateStorageShape('x').ok).toBe(false)
    expect(validateStorageShape(42).ok).toBe(false)
    expect(validateStorageShape([]).ok).toBe(false)
  })

  it('数组字段必须是数组', () => {
    expect(validateStorageShape({ events: 'x' }).ok).toBe(false)
    expect(validateStorageShape({ tasks: {} }).ok).toBe(false)
    expect(validateStorageShape({ papers: 5 }).ok).toBe(false)
  })

  it('缺失字段合法（兼容老版本数据）', () => {
    expect(validateStorageShape({}).ok).toBe(true)
    expect(validateStorageShape({ events: [], tasks: [] }).ok).toBe(true)
    // 只含一个合法数组字段也通过
    expect(validateStorageShape({ notes: [] }).ok).toBe(true)
  })

  it('paperStages 元素必须是字符串', () => {
    expect(validateStorageShape({ paperStages: ['a', 'b'] }).ok).toBe(true)
    expect(validateStorageShape({ paperStages: ['a', 3] }).ok).toBe(false)
  })

  it('合法完整数据通过', () => {
    const data = {
      events: [], tasks: [], milestones: [], notes: [], pomodoros: [],
      birthdays: [], habits: [], projects: [], papers: [], paperStages: [],
    }
    expect(validateStorageShape(data).ok).toBe(true)
  })
})
