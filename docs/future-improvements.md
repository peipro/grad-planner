# 未来改进规划（Future Improvements）

> 本文档记录**当前阶段（Phase 0：数据可靠性与数据安全止血修复）明确不做**的事项，以及后续 Phase 的规划。
> 原则：不为重构而重构、不为 AI 而 AI、不为"架构高级"而迁移数据库。

---

## Phase 1 — Sync Consistency（同步一致性）

本阶段（Phase 0）已确认属于 Phase 1 架构修复、**未在本阶段实施**的问题：

1. **fs.watch 800ms 自写跳过窗口**（`electron/main.cjs`）
   - 问题：`if (Date.now() - lastDesktopWrite < 800) return` 无法区分写入来源，平板在桌面端写盘后 800ms 内的写入会被静默忽略。
   - 建议：写入来源标记（writeSource）/ revision / deviceId。
2. **双端并发冲突（Lost Update / Last-Write-Wins）**
   - 现状：桌面端与平板同时修改不同对象时，后写入方整体覆盖先写入方。
   - 建议：实体级冲突合并或版本号（revision）检测；评估 CRDT 是否必要（用户规模小，可能版本号+手动合并足够）。
3. **reload 时未 blur 的输入缓冲丢失**（Task 1 Test C 的残余限制）
   - 现状：`NotesView`/`TodoView` 部分编辑为 `onBlur` 写入。主进程 reload 前已 flush 进入 store 的数据，但 **reload 时正在输入、尚未 blur 的缓冲区无法被主进程捕获**（IPC 异步，beforeunload 同步发送不可靠）。
   - 建议：reload 前 renderer 侧 flush 协议（主进程广播 before-reload → renderer 同步持久化 → 确认后 reload）；或编辑即时写入（onChange 防抖写 store）。
4. **`sync-storage-set` IPC 不校验 JSON**（与 LAN PUT 对称的缺陷，可信通道、风险较低）
   - 建议：与 LAN PUT 共用同一套 validate（renderer 侧可接入 `validateStorageShape`）。
5. **uid() 使用 Math.random + Date.now**
   - 建议：改用 `crypto.randomUUID()`（renderer 与主进程均支持）。

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
