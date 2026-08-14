// 研途计划 · 生产 CSP 单一来源
// 使用方：
//   - vite.config.ts：build 时注入 HTML meta（覆盖 Electron prod + 平板 LAN 模式）
//   - main.cjs：生产模式注入响应头（纵深防御，与 meta 双保险）
// 依据实际使用分析（Phase 1A Task 4）：
//   - script 全同源（sync-adapter.js + assets/*.js），无 inline script → script-src 'self'
//   - React style prop + 各视图 <style> 标签为 inline 样式 → style-src 必须 'unsafe-inline'
//   - 无外部字体 / 无外部图片（lucide SVG 组件）→ font/img 仅 self + data:
//   - renderer 网络请求仅同源（LAN /api/storage）→ connect-src 'self'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ')

module.exports = { CSP }
