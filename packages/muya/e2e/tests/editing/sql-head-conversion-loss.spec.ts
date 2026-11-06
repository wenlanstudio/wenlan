import { expect, test } from '../fixtures/muya'
import { getMarkdown } from '../helpers/api'
import { loadMarkdown } from '../helpers/keyboard'

// 桌面端 editing-content-preservation 在 00-SQL引擎.md 上复现的丢失：首段
// （伪 frontmatter 的 `marp: true` 段）里 End + Enter×2 + ```js 转换后，下游
// 引用块的 ANTLR 行蒸发。此 spec 用同款文档头部原样复刻。
const DOC = [
    '***',
    '',
    'marp: true',
    '---',
    '',
    '<div class="cover">',
    '<h1>Hive 架构</h1>',
    '<p>Hive SQL 引擎原理 · 从 AST 到分布式执行</p>',
    '</div>',
    '',
    '### 整体架构',
    '',
    '```mermaid',
    'graph LR',
    '    Client[CLI/JDBC/ODBC] --> Driver[Driver]',
    '```',
    '',
    '> **ANTLR（ANother Tool for Language Recognition） 把 SQL 文本从字符串解析成结构化 AST 的解析器生成工具**',
    '',
    '### 执行',
    ''
].join('\n')

const QUOTE_TEXT =
    '**ANTLR（ANother Tool for Language Recognition） 把 SQL 文本从字符串解析成结构化 AST 的解析器生成工具**'

test.describe('00-SQL引擎 quote loss after conversion at first paragraph', () => {
    test('fence conversion at the pseudo-fm paragraph keeps the downstream quote', async({ page }) => {
        await loadMarkdown(page, DOC)

        await page.locator('.mu-paragraph-content').first().click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.keyboard.type('```js', { delay: 0 })
        await page.keyboard.press('Enter')
        await page.keyboard.type('console.log("after-convert")', { delay: 0 })

        const md = await getMarkdown(page)
        expect(md, `RESULT:\n${md}`).toContain(QUOTE_TEXT)
    })
})
