// 研途计划 · 数据迁移层
// 当前 schema 版本为 1，暂无历史迁移；未来字段增删在此集中处理。
// 输入必须已通过 validateStorageShape；缺失字段由上层 merge（store）以默认值补齐。

export const STORAGE_SCHEMA_VERSION = 1

export interface MigrationResult<T> {
  data: T
  migrated: boolean
}

export function migrateStorage<T>(data: T): MigrationResult<T> {
  // 预留：根据版本号执行逐级迁移。当前仅有一版，直接透传。
  return { data, migrated: false }
}
