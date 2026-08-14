# 未来改进规划（Future Improvements）

> 本文档记录**当前阶段（Phase 0：数据可靠性与数据安全止血修复）明确不做**的事项，以及后续 Phase 的规划。
> 原则：不为重构而重构、不为 AI 而 AI、不为"架构高级"而迁移数据库。

---

## Phase 1 — Sync Consistency（同步一致性）

### Phase 1B 已完成（不再列为待办）

- ~~reload 时未 blur 输入缓冲丢失~~ ✅ Renderer Flush Protocol（prepare-reload → 草稿提交 → 队列排空 → ACK → reload）
- ~~fs.watch 800ms 时间窗口~~ ✅ 已移除，改为 envelope.writeId 来源判断（sync-watch.cjs）
- ~~无设备标识~~ ✅ deviceId（desktop/tablet 持久化）
- ~~无 revision / 旧数据静默覆盖~~ ✅ Storage Envelope + 乐观并发（expectedRevision 校验，stale → 409）
- ~~双端修改不同实体互相覆盖~~ ✅ 最小实体级 merge（changedIds 声明 + entityVersions 判定，不同实体自动合并）
- ~~同实体冲突静默覆盖~~ ✅ 409 + sync-conflict 事件 + toast 提示
- ~~删除冲突静默丢失~~ ✅ deletedIds + entityVersions 冲突检测
- ~~同步循环~~ ✅ writeId 防循环（自己的写盘跳过）
- ~~旧数据无法迁移~~ ✅ unwrapEnvelope 兼容旧格式（revision=0）
- ~~LAN 与 IPC 语义不一致~~ ✅ 共用 sync-merge.cjs applySubmit

### Phase 1B 遗留（PARTIALLY FIXED / 后续）

1. **冲突 UI 完整版**：当前为 toast 提示 + 重新加载；"保留本机/使用远程"对话框留后续（sync-conflict 事件已携带 serverData/clientData）
2. **无刷新 hot merge**：外部写入目前仍走 reload（reload 前已过 flush 协议）；直接 merge 到 renderer 内存留后续
3. **TodoView/其他视图输入缓冲**：NotesView 已接入 flush；TodoView 快速输入（未 Enter）与编辑表单为提交式/直接更新 store，剩余输入缓冲场景记录为已知限制
4. **`sync-storage-set` IPC 的 data 结构校验**：applySubmit 已校验 submit 结构，entity 级校验覆盖数组字段（validateStorageShape）

## Phase 2 — 产品与知识层

以下均**不在 Phase 0 范围**，仅记录：

- **Research Question / Goal 实体**：科研闭环"知识→研究问题→任务"断链的根因。
- **Dashboard**：当前 StatsView 只是统计卡片，未回答"今天最重要的是什么"。
- **Review / 复盘**：执行→复盘断链。
- **文献 ↔ 笔记反链**：Paper 无 noteId 反链、Note 无 paperId；阅读产出无结构化落点。
- **知识图谱 / 双链**（参考 SiYuan / Logseq / Obsidian）。
- **重复任务 / 重复日程**。
- **甘特图 / 项目目标**：Project 目前只是"名字+颜色"弱实体。
- **PDF 管理 / 附件**。

## Phase 3 — AI 与长期 OS

- **AI 内建**：当前 AI 只是"外部 AI 生成 JSON → 手动导入"外挂；建议主进程调用、密钥不出主进程、只读提案+用户确认写入、引用真实性校验。
- **云同步**（WebDAV/Git）+ 冲突解决。
- **Semantic Search / Vector**：先证明 keyword 检索不足再引入。

## 数据库选型（审计结论：暂不迁移）

- JSON 单文件在 **1000 条以内无碍、5000 条可感知、10000 条不可用**（每次 setState 全量序列化+整文件重写）。
- 若数据规模长期可控（单机 + 局域网双端、个人使用），继续 JSON 合理。
- 若未来要云同步 / 多人 / 大规模，再评估 SQLite（本地）+ 增量同步；**明确收益大于迁移成本时再动**。

## 已知但本阶段未处理的低风险项

- `lan-access.log` 无限增长（无轮转）。

## 安全项状态（Phase 1A 已完成，不再列为待办）

- ~~News 模块 SSRF~~ ✅ 已修复（url-security.cjs + news.cjs 全入口校验）
- ~~无 CSP / `setWindowOpenHandler` 无协议白名单~~ ✅ 已修复（CSP 单一来源 + isAllowedExternalUrl）
- ~~X 密钥明文回传 renderer~~ ✅ 已修复（get-x-credentials 仅返回 configured）
- ~~LAN 写请求 CSRF~~ ✅ 已修复（Origin 校验）
- ~~read-clipboard 无权限边界~~ ✅ 已修复（仅翻译小窗可调用）
- ~~同窗口导航无防护~~ ✅ 已修复（will-navigate 守卫）
- ~~Electron sandbox 未开启~~ ✅ 已开启（preload 仅 contextBridge/ipcRenderer，兼容）
