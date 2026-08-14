import { describe, it, expect } from 'vitest'
import { parseImportJson, tasksFromImport, eventsFromImport } from './import'

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
