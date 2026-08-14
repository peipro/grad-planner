// 构建并部署到桌面端 D:\研途计划
// 用法: npm run deploy:desktop
const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const TARGET = 'D:\\研途计划'
const SRC = path.resolve(__dirname, '..', 'release', 'win-unpacked')

function fail(msg) {
  console.error(`\x1b[31m${msg}\x1b[0m`)
  process.exit(1)
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
  return r.status
}

// 1. 目标目录检查
if (!fs.existsSync(TARGET)) {
  fail(`错误: 未找到 ${TARGET}`)
}

// 2. 检查研途计划是否在运行
const probe = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Process -Name 研途计划'], { stdio: 'ignore' })
if (probe.status === 0) {
  fail('研途计划正在运行，请先关闭后再部署')
}

// 3. 构建前端(tsc + vite)
console.log('\x1b[36m>>> 构建前端...\x1b[0m')
if (run('npm', ['run', 'build']) !== 0) fail('构建失败')

// 4. 打包 win-unpacked(不打 nsis 安装包)
console.log('\x1b[36m>>> 打包 electron...\x1b[0m')
if (run('npx', ['electron-builder', '--dir']) !== 0) fail('打包失败')

// 5. 覆盖到桌面端(保留 data 目录和用户文件)
console.log(`\x1b[36m>>> 部署到 ${TARGET} ...\x1b[0m`)
const rc = run('robocopy', [SRC, TARGET, '/E', '/IS', '/IT', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD', 'data'])
if (rc >= 8) fail(`部署失败(robocopy 退出码 ${rc})`)

console.log('\x1b[32m>>> 部署完成，可从桌面启动新版\x1b[0m')
