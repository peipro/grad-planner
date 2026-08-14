// 外部 URL 判断（renderer 侧）
// Electron 模式：统一走主进程 open-external，由主进程 url-security.cjs 白名单校验（单一路径）。
// 本工具仅用于 web 降级模式的 window.open 分支（浏览器环境），保持协议一致拒绝非 http(s)。

export const isHttpUrl = (url: string): boolean => {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
