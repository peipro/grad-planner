// Phase 1C Task 3 · 正文提取 HTML 清洗测试
const test = require('node:test')
const assert = require('node:assert')
const { extractArticleText } = require('./news.cjs')

test('提取 <p> 段落并移除脚本/样式/导航', () => {
  const html = [
    '<html><head><script>alert("x")</script><style>p{color:red}</style></head>',
    '<body>',
    '<nav>导航链接内容</nav>',
    '<header>页头内容</header>',
    '<p>第一段正文内容，这是一段足够长的正文段落文字，用于通过提取器的长度过滤条件。</p>',
    '<p>第二段正文内容，同样是一段足够长的段落，其中包含<strong>加粗</strong>文本和其他格式。</p>',
    '<p>第三段正文内容，继续保持足够长度以便三段同时被提取器保留下来。</p>',
    '<footer>页脚内容</footer>',
    '</body></html>',
  ].join('\n')
  const text = extractArticleText(html)
  assert.ok(text.includes('第一段正文内容'), '应包含第一段')
  assert.ok(text.includes('第二段正文内容'), '应包含第二段')
  assert.ok(text.includes('第三段正文内容'), '应包含第三段')
  assert.ok(!text.includes('alert'), '脚本内容不得残留')
  assert.ok(!text.includes('导航链接内容'), 'nav 不得残留')
  assert.ok(!text.includes('页头内容'), 'header 不得残留')
  assert.ok(!text.includes('页脚内容'), 'footer 不得残留')
  assert.ok(!/<script|<style|<nav/.test(text), 'HTML 标签不得残留')
})

test('无 <p> 段落时回退提取可见文本', () => {
  const html = '<html><body><div>无段落结构的可见文本内容，这一段足够长以通过提取器的长度过滤条件。</div></body></html>'
  const text = extractArticleText(html)
  assert.ok(typeof text === 'string' && text.length > 0)
  assert.ok(text.includes('无段落结构的可见文本内容'))
})
