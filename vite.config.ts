import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import csp from './electron/csp.cjs'

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${csp.CSP}" />`

// 仅生产构建注入 CSP meta（dev 模式 HMR 需要额外来源，不应污染生产策略）
function injectCsp(): Plugin {
  return {
    name: 'grad-planner:inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    ${CSP_META}`)
    },
  }
}

export default defineConfig({
  plugins: [react(), injectCsp()],
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        translate: 'translate.html',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
