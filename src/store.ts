import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CalEvent, Task, Milestone, Note, PomodoroRecord, Birthday, Habit, ThemeMode, Paper, PaperStatus } from './types'

const DEFAULT_PAPER_STAGES = ['阶段0 基础模型架构', '阶段1 一般场景攻击', '阶段2 推荐攻击·经典线', '阶段3 推荐攻击·前沿线']

export interface Project {
  id: string
  name: string
  color: string
  version?: number
  // Phase 2A：研究关系
  paperIds?: string[]
  noteIds?: string[]
}

interface NewsConfig {
  xKey: string
  xSecret: string
  includeX: boolean
  rssKeys: string[] | null
  includeHot: boolean
}

export interface PomodoroState {
  mode: 'countdown' | 'stopwatch'
  focusMin: number
  breakMin: number
  remaining: number
  running: boolean
  phase: 'focus' | 'break'
  taskTitle: string
  taskId?: string
  swSec: number
  swRunning: boolean
  endAt?: number
  swStartedAt?: number
}

export interface ReminderConfig {
  enabled: boolean
  eventLeadMin: number
  birthdayLeadDays: number
  taskLeadDays: number
}

export interface PlannerState {
  events: CalEvent[]
  tasks: Task[]
  milestones: Milestone[]
  notes: Note[]
  pomodoros: PomodoroRecord[]
  birthdays: Birthday[]
  habits: Habit[]
  projects: Project[]
  papers: Paper[]
  paperStages: string[]
  pomo: PomodoroState
  theme: ThemeMode
  activeView: string
  autoBackup: boolean
  lastBackup: string
  newsConfig: NewsConfig
  reminders: ReminderConfig

  setView: (view: string) => void
  setThemeMode: (mode: ThemeMode['mode']) => void
  setAccent: (accent: ThemeMode['accent']) => void
  setAutoBackup: (enabled: boolean) => void
  setLastBackup: (ts: string) => void
  setNewsConfig: (cfg: Partial<NewsConfig>) => void
  setReminders: (cfg: Partial<ReminderConfig>) => void

  addEvent: (e: CalEvent) => void
  updateEvent: (e: CalEvent) => void
  deleteEvent: (id: string) => void

  addTask: (t: Task) => void
  updateTask: (t: Task) => void
  deleteTask: (id: string) => void

  addMilestone: (m: Milestone) => void
  updateMilestone: (m: Milestone) => void
  deleteMilestone: (id: string) => void

  addNote: (n: Note) => void
  updateNote: (n: Note) => void
  deleteNote: (id: string) => void

  addPomodoro: (p: PomodoroRecord) => void
  deletePomodoro: (id: string) => void
  clearPomodoros: () => void
  setPomodoro: (p: Partial<PomodoroState>) => void
  resetPomodoro: () => void

  addBirthday: (b: Birthday) => void
  updateBirthday: (b: Birthday) => void
  deleteBirthday: (id: string) => void

  addProject: (p: Project) => void
  updateProject: (p: Project) => void
  deleteProject: (id: string) => void

  addHabit: (h: Habit) => void
  updateHabit: (h: Habit) => void
  deleteHabit: (id: string) => void
  toggleHabitDate: (id: string, date: string) => void

  importPapers: (papers: Paper[]) => void
  importTasks: (tasks: Task[]) => void
  importEvents: (events: CalEvent[]) => void
  updatePaper: (p: Paper) => void
  deletePaper: (id: string) => void
  batchSetPaperStatus: (ids: string[], status: PaperStatus) => void
  addPaperStage: (name: string) => void
  deletePaperStage: (name: string) => void

  resetAll: () => void
}

// 数据自愈：里程碑去重 + 补齐缺失 id + 过滤无效检查点
// 历史数据曾出现"里程碑被复制成 N 份相同、且丢失 id"的异常，载入时统一修复
export const repairMilestones = (list: unknown): Milestone[] => {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: Milestone[] = []
  for (const m of list) {
    if (!m || typeof (m as Milestone).title !== 'string' || !(m as Milestone).title.trim()) continue
    const mm = m as Milestone
    const key = mm.id ? String(mm.id) : `${mm.title}|${mm.startDate}|${mm.endDate}`
    if (seen.has(key)) continue // 完全相同（或同 id）的重复项只保留第一条
    seen.add(key)
    out.push({
      ...mm,
      id: mm.id ? String(mm.id) : Math.random().toString(36).slice(2) + Date.now().toString(36),
      checkpoints: Array.isArray(mm.checkpoints) ? mm.checkpoints.filter((c) => c && c.id && c.title) : [],
    })
  }
  return out
}

// 持久化 merge 语义（persist hydration / 导入 / 恢复共用同一份实现）：
//  - persisted 覆盖 current 的同名字段；缺失字段由 current 默认值补齐（兼容老版本数据）
//  - 配置字段（theme/reminders/autoBackup/lastBackup/newsConfig/pomo/activeView 等）完整保留，不静默丢失
//  - milestones 经自愈修复；pomo 运行时状态与 newsConfig 密钥强制复位（与 partialize 对称）
export const mergePersistedState = (persisted: unknown, current: PlannerState): PlannerState => {
  const p = (persisted || {}) as Partial<PlannerState>
  return {
    ...current,
    ...p,
    milestones: repairMilestones(p.milestones),
    pomo: { ...current.pomo, ...(p.pomo || {}), running: false, swRunning: false, endAt: undefined, swStartedAt: undefined },
    newsConfig: { ...current.newsConfig, ...(p.newsConfig || {}), xKey: '', xSecret: '' },
  }
}

export const useStore = create<PlannerState>()(
  persist(
    (set) => ({
      events: [],
      tasks: [],
      milestones: [],
      notes: [],
      pomodoros: [],
      birthdays: [],
      habits: [],
      projects: [],
      papers: [],
      paperStages: DEFAULT_PAPER_STAGES,
      pomo: {
        mode: 'countdown',
        focusMin: 25,
        breakMin: 5,
        remaining: 25 * 60,
        running: false,
        phase: 'focus',
        taskTitle: '',
        swSec: 0,
        swRunning: false,
      },
      theme: { mode: 'light', accent: 'blue' },
      activeView: 'calendar',
      autoBackup: false,
      lastBackup: '',
      newsConfig: { xKey: '', xSecret: '', includeX: false, rssKeys: null, includeHot: true },
      reminders: { enabled: true, eventLeadMin: 15, birthdayLeadDays: 7, taskLeadDays: 1 },

      setView: (view) => set({ activeView: view }),
      setThemeMode: (mode) => set((s) => ({ theme: { ...s.theme, mode } })),
      setAccent: (accent) => set((s) => ({ theme: { ...s.theme, accent } })),
      setAutoBackup: (enabled) => set({ autoBackup: enabled }),
      setLastBackup: (ts) => set({ lastBackup: ts }),
      setNewsConfig: (cfg) => set((s) => ({ newsConfig: { ...s.newsConfig, ...cfg } })),
      setReminders: (cfg) => set((s) => ({ reminders: { ...s.reminders, ...cfg } })),

      addEvent: (e) => set((s) => ({ events: [...s.events, e] })),
      updateEvent: (e) => set((s) => ({ events: s.events.map((x) => (x.id === e.id ? e : x)) })),
      deleteEvent: (id) => set((s) => ({ events: s.events.filter((x) => x.id !== id) })),

      addTask: (t) => set((s) => ({ tasks: [...s.tasks, t] })),
      updateTask: (t) => set((s) => ({ tasks: s.tasks.map((x) => (x.id === t.id ? t : x)) })),
      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) })),

      addMilestone: (m) => set((s) => ({ milestones: [...s.milestones, m] })),
      updateMilestone: (m) => set((s) => {
        if (!m.id) return s // 防御：无 id 时不更新，避免 x.id === undefined 匹配所有项
        return { milestones: s.milestones.map((x) => (x.id === m.id ? m : x)) }
      }),
      deleteMilestone: (id) => set((s) => {
        if (!id) return s // 防御：无 id 时不删除，避免误删所有无 id 项
        return { milestones: s.milestones.filter((x) => x.id !== id) }
      }),

      addNote: (n) => set((s) => ({ notes: [...s.notes, n] })),
      updateNote: (n) => set((s) => ({ notes: s.notes.map((x) => (x.id === n.id ? n : x)) })),
      deleteNote: (id) => set((s) => ({ notes: s.notes.filter((x) => x.id !== id) })),

      addPomodoro: (p) => set((s) => ({ pomodoros: [...s.pomodoros, p] })),
      deletePomodoro: (id) => set((s) => ({ pomodoros: s.pomodoros.filter((x) => x.id !== id) })),
      clearPomodoros: () => set({ pomodoros: [] }),
      setPomodoro: (p) => set((s) => ({ pomo: { ...s.pomo, ...p } })),
      resetPomodoro: () => set((s) => ({
        pomo: {
          ...s.pomo,
          remaining: (s.pomo.phase === 'focus' ? s.pomo.focusMin : s.pomo.breakMin) * 60,
          running: false,
          swSec: 0,
          swRunning: false,
        },
      })),

      addBirthday: (b) => set((s) => ({ birthdays: [...s.birthdays, b] })),
      updateBirthday: (b) => set((s) => ({ birthdays: s.birthdays.map((x) => (x.id === b.id ? b : x)) })),
      deleteBirthday: (id) => set((s) => ({ birthdays: s.birthdays.filter((x) => x.id !== id) })),

      addProject: (p) => set((s) => ({ projects: [...s.projects, p] })),
      updateProject: (p) => set((s) => ({ projects: s.projects.map((x) => (x.id === p.id ? p : x)) })),
      deleteProject: (id) => set((s) => ({
        projects: s.projects.filter((x) => x.id !== id),
        tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: undefined } : t)),
        milestones: s.milestones.map((m) => (m.projectId === id ? { ...m, projectId: undefined } : m)),
      })),

      addHabit: (h) => set((s) => ({ habits: [...s.habits, h] })),
      updateHabit: (h) => set((s) => ({ habits: s.habits.map((x) => (x.id === h.id ? h : x)) })),
      deleteHabit: (id) => set((s) => ({ habits: s.habits.filter((x) => x.id !== id) })),
      toggleHabitDate: (id, date) => set((s) => ({
        habits: s.habits.map((h) => {
          if (h.id !== id) return h
          const records = h.records.includes(date) ? h.records.filter((d) => d !== date) : [...h.records, date]
          return { ...h, records }
        }),
      })),

      importPapers: (papers) => set((s) => {
        const existing = new Set(s.papers.map((p) => p.title))
        const fresh = papers.filter((p) => !existing.has(p.title))
        return { papers: [...s.papers, ...fresh] }
      }),
      importTasks: (tasks) => set((s) => {
        const existing = new Set(s.tasks.map((t) => t.title))
        const fresh = tasks.filter((t) => !existing.has(t.title))
        return { tasks: [...s.tasks, ...fresh] }
      }),
      importEvents: (events) => set((s) => {
        const existing = new Set(s.events.map((e) => e.title))
        const fresh = events.filter((e) => !existing.has(e.title))
        return { events: [...s.events, ...fresh] }
      }),
      updatePaper: (p) => set((s) => ({ papers: s.papers.map((x) => (x.id === p.id ? p : x)) })),
      deletePaper: (id) => set((s) => ({ papers: s.papers.filter((x) => x.id !== id) })),
      batchSetPaperStatus: (ids, status) => set((s) => ({
        papers: s.papers.map((p) => (ids.includes(p.id) ? { ...p, status } : p)),
      })),
      addPaperStage: (name) => set((s) => {
        const n = name.trim()
        if (!n || s.paperStages.includes(n)) return s
        return { paperStages: [...s.paperStages, n] }
      }),
      deletePaperStage: (name) => set((s) => ({
        paperStages: s.paperStages.filter((x) => x !== name),
        papers: s.papers.map((p) => (p.stage === name ? { ...p, stage: '未分类' } : p)),
      })),

      resetAll: () => set({ events: [], tasks: [], milestones: [], notes: [], pomodoros: [], birthdays: [], habits: [], projects: [], papers: [], paperStages: DEFAULT_PAPER_STAGES }),
    }),
    { name: 'grad-planner-storage', partialize: (state) => ({
      ...state,
      pomo: {
        ...state.pomo,
        running: false,
        swRunning: false,
        endAt: undefined,
        swStartedAt: undefined,
      },
      newsConfig: { ...state.newsConfig, xKey: '', xSecret: '' },
    }), merge: (persisted, current) => mergePersistedState(persisted, current) },
  ),
)

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
