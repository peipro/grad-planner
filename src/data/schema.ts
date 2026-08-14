// 研途计划 · 共享数据顶层结构定义（renderer 侧）
// 注意：electron/storage-schema.cjs 中维护同一字段清单（LAN 服务器校验用）
// 一致性由 src/data/schema.test.ts 锁定。

// 顶层必须是数组的持久化字段
export const STORAGE_ARRAY_FIELDS = [
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
] as const

export type StorageArrayField = (typeof STORAGE_ARRAY_FIELDS)[number]

// persist（partialize）持久化的全部顶层字段
export const STORAGE_TOP_LEVEL_FIELDS = [
  ...STORAGE_ARRAY_FIELDS,
  'pomo',
  'theme',
  'activeView',
  'autoBackup',
  'lastBackup',
  'newsConfig',
  'reminders',
] as const

export type StorageTopLevelField = (typeof STORAGE_TOP_LEVEL_FIELDS)[number]
