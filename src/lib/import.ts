import { Paper, PaperStatus, Task, TaskStatus, Priority, CalEvent, EventType } from '../types'
import { uid } from '../store'

export interface ImportPreview {
  module: 'papers' | 'tasks' | 'events' | 'unknown'
  title: string
  count: number
  raw: unknown
}

const MODULE_TITLE: Record<string, string> = {
  papers: '文献',
  tasks: '待办',
  events: '日历',
}

const isItem = (x: unknown): x is Record<string, unknown> => {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.title === 'string' && o.title.length > 0
}

const normalizeStatus = (v: unknown): PaperStatus => {
  if (v === 'reading' || v === 'read') return v
  return 'unread'
}

const normalizePriority = (v: unknown): Priority => {
  if (v === 'high' || v === 'low') return v
  return 'medium'
}

const normalizeTaskStatus = (v: unknown): TaskStatus => {
  if (v === 'doing' || v === 'done') return v
  return 'todo'
}

const normalizeEventType = (v: unknown): EventType => {
  if (v === 'course' || v === 'meeting' || v === 'deadline') return v
  return 'personal'
}

const toPaper = (item: Record<string, unknown>): Paper => ({
  id: uid(),
  title: String(item.title),
  authors: typeof item.authors === 'string' ? item.authors : undefined,
  year: typeof item.year === 'number' ? item.year : undefined,
  venue: typeof item.venue === 'string' ? item.venue : undefined,
  stage: typeof item.stage === 'string' ? item.stage : '默认',
  category: typeof item.category === 'string' ? item.category : '其他',
  plannedDate: typeof item.plannedDate === 'string' ? item.plannedDate : undefined,
  note: typeof item.note === 'string' ? item.note : undefined,
  status: normalizeStatus(item.status),
  link: typeof item.link === 'string' ? item.link : undefined,
  createdAt: new Date().toISOString(),
})

const toTask = (item: Record<string, unknown>): Task => ({
  id: uid(),
  title: String(item.title),
  due: typeof item.due === 'string' ? item.due : undefined,
  priority: normalizePriority(item.priority),
  status: normalizeTaskStatus(item.status),
  projectId: typeof item.projectId === 'string' ? item.projectId : undefined,
  subtasks: [],
  createdAt: new Date().toISOString(),
})

const toEvent = (item: Record<string, unknown>): CalEvent => ({
  id: uid(),
  title: String(item.title),
  start: typeof item.start === 'string' ? item.start : '',
  end: typeof item.end === 'string' ? item.end : '',
  type: normalizeEventType(item.type),
  note: typeof item.note === 'string' ? item.note : undefined,
})

// 解析 AI 生成的 JSON（统一 schema：{ version, module, items }），返回预览
export const parseImportJson = (text: string): ImportPreview => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('JSON 解析失败，请检查文件内容')
  }
  if (typeof data !== 'object' || data === null) throw new Error('JSON 根节点必须是对象')

  const root = data as Record<string, unknown>
  const module = typeof root.module === 'string' ? root.module : 'papers'
  const items = Array.isArray(root.items) ? root.items : []

  if (module === 'papers' || module === 'tasks' || module === 'events') {
    const valid = items.filter(isItem)
    return { module, title: MODULE_TITLE[module], count: valid.length, raw: items }
  }
  return { module: 'unknown', title: '未知模块', count: items.length, raw: items }
}

// 将 items 转换为 Paper 列表（文献模块）
export const papersFromImport = (preview: ImportPreview): Paper[] => {
  const items = Array.isArray(preview.raw) ? preview.raw : []
  return items.filter(isItem).map(toPaper)
}

// 将 items 转换为 Task 列表（待办模块）
export const tasksFromImport = (preview: ImportPreview): Task[] => {
  const items = Array.isArray(preview.raw) ? preview.raw : []
  return items.filter(isItem).map(toTask)
}

// 将 items 转换为 CalEvent 列表（日历模块，要求 start 非空）
export const eventsFromImport = (preview: ImportPreview): CalEvent[] => {
  const items = Array.isArray(preview.raw) ? preview.raw : []
  return items
    .filter(isItem)
    .map(toEvent)
    .filter((e) => e.start)
}

// 生成 AI 填写用的空模板（文献模块）
export const papersTemplateJson = (): string =>
  JSON.stringify(
    {
      version: 1,
      module: 'papers',
      items: [
        {
          title: '论文标题（必填）',
          authors: '作者列表，逗号分隔',
          year: 2025,
          venue: '会议/期刊名',
          stage: '阶段0 基础模型架构 / 阶段1 一般场景攻击 / 阶段2 推荐攻击·经典线 / 阶段3 推荐攻击·前沿线',
          category: '类别，如 启发式 / 优化式 / GAN / 扩散模型 / 强化学习 / 大模型 / 联邦学习',
          plannedDate: 'YYYY-MM-DD',
          note: '阅读要点，一句话',
          status: 'unread | reading | read',
          link: 'https://arxiv.org/abs/xxxx',
        },
      ],
    },
    null,
    2,
  )

// 生成待办模块空模板
export const tasksTemplateJson = (): string =>
  JSON.stringify(
    {
      version: 1,
      module: 'tasks',
      items: [
        {
          title: '任务内容（必填）',
          due: 'YYYY-MM-DD',
          priority: 'high | medium | low',
          status: 'todo | doing | done',
        },
      ],
    },
    null,
    2,
  )

// 生成日历模块空模板
export const eventsTemplateJson = (): string =>
  JSON.stringify(
    {
      version: 1,
      module: 'events',
      items: [
        {
          title: '日程标题（必填）',
          start: 'YYYY-MM-DDTHH:MM',
          end: 'YYYY-MM-DDTHH:MM',
          type: 'course | meeting | deadline | personal',
          note: '备注',
        },
      ],
    },
    null,
    2,
  )
