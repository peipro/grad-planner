import { useEffect, useRef, useState } from 'react'
import { Download, Upload, Trash2, Sun, Moon, Monitor, Palette, History, Newspaper, Bell, Wifi, KeyRound, Copy } from 'lucide-react'
import { useStore, mergePersistedState } from '../store'
import { validateStorageShape } from '../data/validate'
import { useToast } from '../lib/toast'

const RSS_SOURCES = [
  { key: 'qbitai', name: '量子位', category: 'AI' },
  { key: 'infoq', name: 'InfoQ AI', category: 'AI' },
  { key: 'openai', name: 'OpenAI', category: '官方' },
  { key: 'deepmind', name: 'DeepMind', category: '官方' },
  { key: 'huggingface', name: 'Hugging Face', category: '官方' },
  { key: 'langchain', name: 'LangChain', category: 'Agent' },
  { key: 'techcrunch-ai', name: 'TechCrunch AI', category: 'AI' },
  { key: 'venturebeat', name: 'VentureBeat AI', category: 'AI' },
  { key: 'marktechpost', name: 'MarkTechPost', category: 'AI' },
  { key: 'gradient', name: 'The Gradient', category: '深度' },
  { key: 'mit', name: 'MIT News AI', category: '学术' },
  { key: 'hn', name: 'Hacker News', category: '聚合' },
]

export default function SettingsView() {
  const theme = useStore((s) => s.theme)
  const setThemeMode = useStore((s) => s.setThemeMode)
  const setAccent = useStore((s) => s.setAccent)
  const resetAll = useStore((s) => s.resetAll)
  const autoBackup = useStore((s) => s.autoBackup)
  const lastBackup = useStore((s) => s.lastBackup)
  const setAutoBackup = useStore((s) => s.setAutoBackup)
  const setLastBackup = useStore((s) => s.setLastBackup)
  const newsConfig = useStore((s) => s.newsConfig)
  const setNewsConfig = useStore((s) => s.setNewsConfig)
  const reminders = useStore((s) => s.reminders)
  const setReminders = useStore((s) => s.setReminders)
  const fileRef = useRef<HTMLInputElement>(null)
  const [xKey, setXKey] = useState('')
  const [xSecret, setXSecret] = useState('')
  const toast = useToast((s) => s.show)
  const [lanInfo, setLanInfo] = useState<{ port: number | null; token: string; addresses: string[] } | null>(null)
  const [lanCopied, setLanCopied] = useState(false)

  useEffect(() => {
    const api = (window as any).electronAPI
    if (api?.getXCredentials) {
      api.getXCredentials().then((c: { key: string; secret: string }) => {
        if (c) { setXKey(c.key || ''); setXSecret(c.secret || '') }
      }).catch(() => {})
    }
    if (api?.lanInfo) {
      api.lanInfo().then((info: { port: number | null; token: string; addresses: string[] }) => {
        if (info) setLanInfo(info)
      }).catch(() => {})
    }
  }, [])

  const lanUrl = lanInfo && lanInfo.port && lanInfo.addresses.length > 0
    ? `http://${lanInfo.addresses[0]}:${lanInfo.port}/?token=${lanInfo.token}`
    : null

  const copyLan = () => {
    if (!lanUrl) return
    navigator.clipboard.writeText(lanUrl).then(() => {
      setLanCopied(true)
      toast('已复制局域网访问地址')
      setTimeout(() => setLanCopied(false), 2000)
    }).catch(() => {})
  }

  const resetLanToken = () => {
    if (!confirm('重置令牌后，已连接的平板/手机会立即失效，需要用新地址重新打开。确定重置？')) return
    const api = (window as any).electronAPI
    if (!api?.lanResetToken) return
    api.lanResetToken().then((res: { ok: boolean; token?: string }) => {
      if (res?.ok && res.token && lanInfo) setLanInfo({ ...lanInfo, token: res.token })
      toast('局域网令牌已重置')
    }).catch(() => {})
  }

  const saveXCred = (key: string, secret: string) => {
    ;(window as any).electronAPI?.setXCredentials(key, secret)
  }

  const modeOptions = [
    { id: 'light', label: '浅色', icon: Sun },
    { id: 'dark', label: '深色', icon: Moon },
    { id: 'system', label: '跟随系统', icon: Monitor },
  ] as const

  const accentOptions = [
    { id: 'blue', label: '学术蓝', color: '#4f6ef7' },
    { id: 'green', label: '清新绿', color: '#2f9e6e' },
    { id: 'purple', label: '丁香紫', color: '#8b5cf6' },
    { id: 'orange', label: '暖橙', color: '#f58d2a' },
  ] as const

  const exportData = () => {
    const data = JSON.stringify(useStore.getState(), null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `grad-planner-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ===== 数据导入 / 恢复安全流程 =====
  // 统一流程：读取 → JSON.parse → Schema 校验 → 数据摘要 → 自动备份当前数据 → 用户确认 → 应用（配置字段保真）→ 重新校验
  // 任何失败：当前数据不受影响。

  const summarizeData = (data: Record<string, unknown>): string => {
    const count = (k: string) => (Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0)
    return [
      `日历 ${count('events')}`,
      `待办 ${count('tasks')}`,
      `里程碑 ${count('milestones')}`,
      `笔记 ${count('notes')}`,
      `文献 ${count('papers')}`,
      `番茄钟 ${count('pomodoros')}`,
      `生日 ${count('birthdays')}`,
      `习惯 ${count('habits')}`,
      `项目 ${count('projects')}`,
    ].join(' · ')
  }

  // 替换数据前自动备份当前数据（桌面版写磁盘，Web 版写 localStorage），失败不阻塞流程
  const backupCurrent = (): Promise<void> =>
    new Promise((resolve) => {
      const api = (window as any).electronAPI
      if (api?.saveBackup) {
        api.saveBackup(JSON.stringify(useStore.getState(), null, 2))
          .then(() => { setLastBackup(new Date().toISOString()); resolve() })
          .catch(() => resolve())
      } else {
        try {
          localStorage.setItem('grad-planner-autobackup', JSON.stringify({ time: new Date().toISOString(), data: useStore.getState() }))
        } catch {}
        resolve()
      }
    })

  // 应用数据：与 persist merge 同一语义（mergePersistedState），配置字段（theme/reminders/autoBackup/newsConfig/pomo 等）完整保留
  const applyData = (data: unknown): boolean => {
    const current = useStore.getState()
    useStore.setState(mergePersistedState(data, current))
    const recheck = validateStorageShape(useStore.getState())
    if (!recheck.ok) {
      console.error('[data] 应用后校验未通过:', recheck.errors)
      return false
    }
    return true
  }

  const importData = (file: File) => {
    const reader = new FileReader()
    reader.onload = async () => {
      let data: unknown
      try {
        data = JSON.parse(reader.result as string)
      } catch {
        alert('解析失败：文件不是合法 JSON，当前数据未受影响')
        return
      }
      const v = validateStorageShape(data)
      if (!v.ok) {
        alert(`文件格式不正确，当前数据未受影响：\n${v.errors.join('\n')}`)
        return
      }
      const root = data as Record<string, unknown>
      if (!confirm(`导入将替换当前全部数据。\n\n导入内容：${summarizeData(root)}\n\n导入前会自动备份当前数据。是否继续？`)) return
      await backupCurrent()
      const ok = applyData(data)
      alert(ok ? '导入成功！' : '导入后校验未通过，请检查数据')
    }
    reader.readAsText(file)
  }

  // 自动备份：每 10 分钟一次，仅当启用时；桌面版写入磁盘文件
  useEffect(() => {
    if (!autoBackup) return
    const backup = () => {
      const json = JSON.stringify(useStore.getState(), null, 2)
      const api = (window as any).electronAPI
      if (api?.saveBackup) {
        api.saveBackup(json).then(() => setLastBackup(new Date().toISOString())).catch(() => {})
      } else {
        localStorage.setItem('grad-planner-autobackup', JSON.stringify({ time: new Date().toISOString(), data: useStore.getState() }))
        setLastBackup(new Date().toISOString())
      }
    }
    backup()
    const id = window.setInterval(backup, 10 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [autoBackup, setLastBackup])

  // 备份文件列表（桌面版）
  const [backupList, setBackupList] = useState<{ name: string; size: number; mtime: string }[]>([])
  useEffect(() => {
    const api = (window as any).electronAPI
    if (api?.listBackups) {
      api.listBackups().then((list: { name: string; size: number; mtime: string }[]) => setBackupList(list)).catch(() => {})
    }
  }, [autoBackup])

  const restoreBackup = (name: string) => {
    const api = (window as any).electronAPI
    if (!api?.loadBackup) return
    if (!confirm(`从备份 ${name} 恢复？将覆盖当前全部数据（恢复前会自动备份当前数据）。`)) return
    api.loadBackup(name).then(async (raw: string | null) => {
      if (!raw) { alert('读取备份失败'); return }
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        alert('备份文件解析失败，当前数据未受影响')
        return
      }
      const v = validateStorageShape(data)
      if (!v.ok) {
        alert(`备份文件格式不正确，当前数据未受影响：\n${v.errors.join('\n')}`)
        return
      }
      const root = data as Record<string, unknown>
      if (!confirm(`恢复内容：${summarizeData(root)}。确定恢复？`)) return
      await backupCurrent()
      const ok = applyData(data)
      useStore.getState().setView('calendar')
      alert(ok ? '恢复成功！' : '恢复后校验未通过，请检查备份文件')
      // 刷新备份列表：磁盘上的备份文件仍然存在，不应从列表移除
      api.listBackups().then((list: { name: string; size: number; mtime: string }[]) => setBackupList(list)).catch(() => {})
    })
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">设置</div>
          <div className="page-sub">外观与数据管理</div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card setting-card">
          <div className="setting-title">外观模式</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {modeOptions.map((m) => {
              const Icon = m.icon
              return (
                <button key={m.id} className={`btn ${theme.mode === m.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setThemeMode(m.id)}>
                  <Icon size={15} /> {m.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="card setting-card">
          <div className="setting-title"><Palette size={15} /> 主题色</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {accentOptions.map((a) => (
              <button key={a.id} onClick={() => setAccent(a.id)} title={a.label}
                style={{
                  width: 30, height: 30, borderRadius: 8, background: a.color,
                  border: theme.accent === a.id ? '3px solid var(--text-1)' : 'none',
                  boxShadow: 'var(--shadow)',
                }} />
            ))}
          </div>
        </div>

        <div className="card setting-card">
          <div className="setting-title">数据管理</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={exportData}><Download size={15} /> 导出备份</button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={15} /> 导入备份</button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          </div>
        </div>

        <div className="card setting-card">
          <div className="setting-title"><Wifi size={15} /> 局域网共享</div>
          {lanInfo && lanInfo.port ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
                平板 / 手机浏览器（同一局域网）打开下面地址，即可与桌面端共享同一份数据：
              </div>
              <div style={{ fontSize: 11.5, fontFamily: 'monospace', wordBreak: 'break-all', padding: '8px 10px', background: 'var(--bg-hover)', borderRadius: 8, color: 'var(--accent-text)' }}>
                {lanUrl}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={copyLan}><Copy size={13} /> {lanCopied ? '已复制' : '复制地址'}</button>
                <button className="btn btn-ghost btn-sm" onClick={resetLanToken}><KeyRound size={13} /> 重置令牌</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>重置令牌后已连接的设备会立即失效，需用新地址重新打开</div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>仅桌面版支持（端口 8899），当前服务不可用</div>
          )}
        </div>

        <div className="card setting-card">
          <div className="setting-title"><Bell size={15} /> 提醒设置</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <button
              className={`btn ${reminders.enabled ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setReminders({ enabled: !reminders.enabled })}
            >
              {reminders.enabled ? '已开启系统提醒' : '开启系统提醒'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>需允许通知权限</span>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              日历事件提前{' '}
              <select
                value={reminders.eventLeadMin}
                onChange={(e) => setReminders({ eventLeadMin: Number(e.target.value) })}
                style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-1)' }}
              >
                <option value={5}>5</option>
                <option value={15}>15</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>{' '}
              分钟提醒
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              生日提前{' '}
              <select
                value={reminders.birthdayLeadDays}
                onChange={(e) => setReminders({ birthdayLeadDays: Number(e.target.value) })}
                style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-1)' }}
              >
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={7}>7</option>
                <option value={14}>14</option>
              </select>{' '}
              天提醒
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              任务到期提前{' '}
              <select
                value={reminders.taskLeadDays}
                onChange={(e) => setReminders({ taskLeadDays: Number(e.target.value) })}
                style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-1)' }}
              >
                <option value={0}>0（当天）</option>
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={7}>7</option>
              </select>{' '}
              天提醒
            </div>
          </div>
        </div>

        <div className="card setting-card" style={{ gridColumn: '1 / -1' }}>
          <div className="setting-title"><Newspaper size={15} /> 资讯设置</div>

          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
            <b>数据源开关</b> · 每天 09:00 / 15:00 自动抓取，也可在资讯页手动刷新
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: 13, color: 'var(--text-2)' }}>
              <input
                type="checkbox"
                checked={newsConfig.includeHot}
                onChange={(e) => setNewsConfig({ includeHot: e.target.checked })}
                style={{ marginRight: 6 }}
              />
              包含热搜榜（微博热搜 + 知乎热榜）
            </label>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>RSS 源：</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {RSS_SOURCES.map((src) => {
              const active = !newsConfig.rssKeys || newsConfig.rssKeys.includes(src.key)
              const toggle = () => {
                const cur = newsConfig.rssKeys ?? RSS_SOURCES.map((s) => s.key)
                const next = active ? cur.filter((k) => k !== src.key) : [...cur, src.key]
                setNewsConfig({ rssKeys: next.length ? next : null })
              }
              return (
                <button key={src.key} className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`} onClick={toggle}>
                  {src.name}
                </button>
              )
            })}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
            X（推特）来源 <span style={{ color: '#f08c00' }}>· 可选，需要 API 额度</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="password"
              placeholder="X API Key"
              value={xKey}
              onChange={(e) => setXKey(e.target.value)}
              onBlur={() => saveXCred(xKey, xSecret)}
              style={{ flex: 1, minWidth: 200, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text-1)', fontSize: 13 }}
            />
            <input
              type="password"
              placeholder="X API Secret"
              value={xSecret}
              onChange={(e) => setXSecret(e.target.value)}
              onBlur={() => saveXCred(xKey, xSecret)}
              style={{ flex: 1, minWidth: 200, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text-1)', fontSize: 13 }}
            />
          </div>
          <label style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 10, display: 'block' }}>
            <input
              type="checkbox"
              checked={newsConfig.includeX}
              onChange={(e) => setNewsConfig({ includeX: e.target.checked })}
              style={{ marginRight: 6 }}
            />
            启用 X 来源（需填写 Key + Secret，且账号有 API 读取额度）
          </label>
        </div>

        <div className="card setting-card">
          <div className="setting-title"><History size={15} /> 自动备份</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className={`btn ${autoBackup ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setAutoBackup(!autoBackup)}
            >
              {autoBackup ? '已开启（每10分钟）' : '开启自动备份'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
            桌面版备份写入磁盘：软件目录 data\backups\
          </div>
          {lastBackup && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
              最近备份：{new Date(lastBackup).toLocaleString('zh-CN')}
            </div>
          )}
          {backupList.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>磁盘备份文件：</div>
              <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {backupList.map((b) => (
                  <div key={b.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-hover)' }}>
                    <span style={{ color: 'var(--text-2)', fontFamily: 'monospace' }}>{b.name.replace('backup-', '').replace('.json', '')}</span>
                    <button className="btn btn-sm btn-ghost" onClick={() => restoreBackup(b.name)}>恢复</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card setting-card" style={{ borderColor: '#e5484d33' }}>
          <div className="setting-title" style={{ color: '#e5484d' }}>危险操作</div>
          <button className="btn" style={{ color: '#e5484d', border: '1px solid #e5484d66' }}
            onClick={() => {
              if (!confirm('确定清空所有数据？此操作不可恢复！')) return
              // 清空前自动备份一次，防止误操作后无法找回
              const api = (window as any).electronAPI
              if (api?.saveBackup) {
                api.saveBackup(JSON.stringify(useStore.getState(), null, 2))
                  .then(() => setLastBackup(new Date().toISOString()))
                  .catch(() => {})
              }
              resetAll()
            }}>
            <Trash2 size={15} /> 清空所有数据
          </button>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>清空前会自动备份一次，可从上方备份列表恢复</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20, padding: 18 }}>
        <div className="setting-title">关于</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.8 }}>
          <div>研途计划 v0.2.0 — 研究生计划与日程管理工具</div>
          <div>功能：日历 / 待办 / 里程碑 / 笔记 / 番茄钟 / 生日 / 统计 / 资讯 / 翻译</div>
          <div>数据保存在本地，开启自动备份后写入磁盘（软件目录 data\backups\），可在本页恢复</div>
        </div>
      </div>

      <style>{`
        .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .setting-card { padding: 18px; }
        .setting-title { font-size: 14px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
      `}</style>
    </div>
  )
}
