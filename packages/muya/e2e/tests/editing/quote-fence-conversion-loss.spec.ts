import { expect, test } from '../fixtures/muya'
import { getMarkdown } from '../helpers/api'
import { loadMarkdown } from '../helpers/keyboard'

// 视图切换丢内容排查（用户报告：修改正文中内容丢失）——00-SQL引擎.md 真实
// 讲义的引用块场景：引用段末尾 End → Enter ×2 → ```js + Enter 围栏转换 →
// 立即续打。引用块首行的正文曾在此序列后整行蒸发。

const QUOTE_TEXT =
    '**ANTLR（ANother Tool for Language Recognition） 把 SQL 文本从字符串解析成结构化 AST 的解析器生成工具**'

const DOC = [
    '```mermaid',
    'graph LR',
    '    A --> B',
    '```',
    '',
    `> ${QUOTE_TEXT}`,
    '',
    '### 执行',
    ''
].join('\n')

test.describe('quote + fence conversion keeps the quote text', () => {
    test('End, Enter×2, ```js conversion, immediate typing — quote line survives', async({ page }) => {
        await loadMarkdown(page, DOC)

        // 光标进引用段（DOM 里第一个 .mu-paragraph-content 在 blockquote 内）
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
