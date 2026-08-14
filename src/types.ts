export type EventType = 'course' | 'meeting' | 'deadline' | 'personal'

export interface CalEvent {
  id: string
  title: string
  start: string
  end: string
  type: EventType
  note?: string
  version?: number
}

export type Priority = 'high' | 'medium' | 'low'
export type TaskStatus = 'todo' | 'doing' | 'done'

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  due?: string
  priority: Priority
  status: TaskStatus
  projectId?: string
  subtasks?: Subtask[]
  createdAt: string
  version?: number
}

export interface MilestoneCheckpoint {
  id: string
  title: string
  done: boolean
}

export interface Milestone {
  id: string
  title: string
  description?: string
  startDate: string
  endDate: string
  progress: number
  color: string
  projectId?: string
  checkpoints?: MilestoneCheckpoint[]
  version?: number
}

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
  version?: number
  // Phase 2A：研究关系
  paperIds?: string[]
  projectIds?: string[]
}

export interface PomodoroRecord {
  id: string
  taskTitle: string
  minutes: number
  completedAt: string
  taskId?: string
  version?: number
}

export interface Habit {
  id: string
  name: string
  emoji: string
  weeklyTarget: number
  records: string[]
  createdAt: string
  version?: number
}

export interface Birthday {
  id: string
  name: string
  calendarType: 'lunar' | 'solar'
  lunarMonth?: number
  lunarDay?: number
  isLeapMonth?: boolean
  solarMonth?: number
  solarDay?: number
  note?: string
  emoji: string
  originalInput?: string
  createdAt: string
  version?: number
}

export interface ThemeMode {
  mode: 'light' | 'dark' | 'system'
  accent: 'blue' | 'green' | 'purple' | 'orange'
}

export type PaperStatus = 'unread' | 'reading' | 'read'

export interface Paper {
  id: string
  title: string
  authors?: string
  year?: number
  venue?: string
  stage: string
  category: string
  plannedDate?: string
  note?: string
  status: PaperStatus
  link?: string
  focus?: 'core' | 'skim'
  createdAt: string
  version?: number
  // Phase 2A：研究关系（双向 ID 引用）
  projectIds?: string[]
  noteIds?: string[]
}

export interface NewsItem {
  title: string
  link: string
  summary: string
  pubTime: string
  source: string
  sourceKey: string
  category: string
  ai: boolean
}
