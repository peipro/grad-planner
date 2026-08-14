import { describe, it, expect } from 'vitest'
import { parseImportJson, tasksFromImport, eventsFromImport, papersFromImport } from './import'

describe('parseImportJson', () => {
  it('解析 papers 模块', () => {
    const p = parseImportJson('{"version":1,"module":"papers","items":[{"title":"论文A"}]}')
    expect(p.module).toBe('papers')
    expect(p.count).toBe(1)
  })

  it('解析 tasks 模块', () => {
    const p = parseImportJson('{"module":"tasks","items":[{"title":"写报告","due":"2025-01-02","priority":"high"}]}')
    expect(p.module).toBe('tasks')
    expect(p.title).toBe('待办')
  })

  it('解析 events 模块', () => {
    const p = parseImportJson('{"module":"events","items":[{"title":"组会"}]}')
    expect(p.module).toBe('events')
  })

  it('未知模块', () => {
    const p = parseImportJson('{"module":"hoge","items":[{"title":"x"}]}')
    expect(p.module).toBe('unknown')
  })

  it('无 title 的条目不计入 count', () => {
    const p = parseImportJson('{"module":"papers","items":[{"foo":"bar"},{"title":"有效"}]}')
    expect(p.count).toBe(1)
  })

  it('非法 JSON 抛错', () => {
    expect(() => parseImportJson('{not json')).toThrow()
  })
})

describe('tasksFromImport', () => {
  it('转换任务并归一化优先级/状态', () => {
    const p = parseImportJson('{"module":"tasks","items":[{"title":"A","priority":"high","due":"2025-01-02"}]}')
    const tasks = tasksFromImport(p)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('A')
    expect(tasks[0].priority).toBe('high')
    expect(tasks[0].status).toBe('todo')
  })
})

describe('eventsFromImport', () => {
  it('过滤缺失 start 的条目', () => {
    const p = parseImportJson('{"module":"events","items":[{"title":"A","start":"2025-01-02T09:00"},{"title":"B"}]}')
    const events = eventsFromImport(p)
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('A')
  })

  it('归一化事件类型', () => {
    const p = parseImportJson('{"module":"events","items":[{"title":"A","start":"2025-01-02T09:00","type":"meeting"}]}')
    const events = eventsFromImport(p)
    expect(events[0].type).toBe('meeting')
  })
})

// ===== Task 5: 导入边界（valid / invalid / partial / empty / wrong types） =====

describe('parseImportJson 边界', () => {
  it('items 缺失 / null / 空数组 → count 0，不抛错', () => {
    expect(parseImportJson('{"module":"papers"}').count).toBe(0)
    expect(parseImportJson('{"module":"papers","items":null}').count).toBe(0)
    expect(parseImportJson('{"module":"papers","items":[]}').count).toBe(0)
  })

  it('items 非数组（对象/字符串）→ count 0', () => {
    expect(parseImportJson('{"module":"papers","items":{}}').count).toBe(0)
    expect(parseImportJson('{"module":"papers","items":"x"}').count).toBe(0)
  })

  it('部分条目无 title 时只计有效条目', () => {
    const p = parseImportJson('{"module":"tasks","items":[{"title":"A"},{"foo":1},{"title":""},{"title":"B"}]}')
    expect(p.count).toBe(2)
  })

  it('高版本号仍可解析（当前无版本门控——记录为已知设计）', () => {
    const p = parseImportJson('{"version":999,"module":"papers","items":[{"title":"A"}]}')
    expect(p.count).toBe(1)
  })
})

describe('wrong types 归一化', () => {
  it('year 为字符串被丢弃为 undefined（仅接受 number）', () => {
    const p = parseImportJson('{"module":"papers","items":[{"title":"A","year":"2024"}]}')
    const papers = papersFromImport(p)
    expect(papers[0].year).toBeUndefined()
  })

  it('非法 status / priority / type 归一化为安全默认值', () => {
    const p = parseImportJson('{"module":"tasks","items":[{"title":"A","status":"explode","priority":"urgent"}]}')
    const tasks = tasksFromImport(p)
    expect(tasks[0].status).toBe('todo')
    expect(tasks[0].priority).toBe('medium')
  })

  it('非法事件类型归一化为 personal', () => {
    const p = parseImportJson('{"module":"events","items":[{"title":"A","start":"2025-01-02T09:00","type":"hack"}]}')
    const events = eventsFromImport(p)
    expect(events[0].type).toBe('personal')
  })
})
