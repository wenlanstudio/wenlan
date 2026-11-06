import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/muya'
import { getMarkdown } from '../helpers/api'
import { loadMarkdown } from '../helpers/keyboard'

// 遗留三专项：桌面 editing-content-preservation 在 00-SQL引擎.md 上的完整
// 丢失序列。引擎隔离复现（同文档头 + 同款按键）不触发——桌面多了「文↔本
// 往返」（replaceContent 全量重建 + setCursorByOffset 哨兵光标恢复）穿插在
// 编辑步骤之间。本 spec 用公开 API 忠实复刻整条链路，把竞态逼进引擎。
//
// 捕获过的现场：转换后引用正文截断、语言标记被污染（`n4js`）、键入文本
// 错位重排（`og("after-convert")console.l`）。

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

/** 桌面的文↔本往返等价物：replaceContent 全量重建 + 哨兵光标恢复。 */
async function sourceRoundTrip(page: Page): Promise<void> {
    await page.evaluate(() => {
        const m = window.muya!
        const md = m.getMarkdown()
        const idx = m.getCursorOffset()
        m.replaceContent(md)
        if (idx)
            m.setCursorByOffset(idx)
    })
}

async function typeCjk(page: Page, romaji: string, hanzi: string): Promise<void> {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', {
        text: romaji,
        selectionStart: romaji.length,
        selectionEnd: romaji.length
    })
    await cdp.send('Input.imeSetComposition', {
        text: hanzi,
        selectionStart: hanzi.length,
        selectionEnd: hanzi.length
    })
    await cdp.send('Input.insertText', { text: hanzi })
}

test.describe('full desktop sequence — conversion race loses quote text', () => {
    test('burst+code+conversion only', async({ page }) => {
        await loadMarkdown(page, DOC)

        const paragraphs = page.locator('.mu-paragraph-content')

        // 桌面步骤 5（丢失现场）：首段（引用段落）End + Enter×2 + ```js 转换
        // + 立即续打
        await paragraphs.first().click()
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
