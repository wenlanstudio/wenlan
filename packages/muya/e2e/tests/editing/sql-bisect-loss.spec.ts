import { expect, test } from '../fixtures/muya'
import { getMarkdown } from '../helpers/api'
import { loadMarkdown } from '../helpers/keyboard'
import * as fs from 'node:fs'

// 遗留三二分床：真实 00-SQL引擎.md 全文 + 环境变量开关的编辑步骤，定位
// 「围栏转换后引用正文蒸发」需要哪些前置步骤。
// STEPS=ime,paste,burst,code（逗号分隔）控制执行哪些步骤；转换步骤恒跑。
//
// 2026-11-07 二分结论：
//   ime 单独 + 转换                    → 通过
//   ime,paste（粘贴沿用上一步光标）    → 失败：粘贴文本落进引用段
//     （生成工具粘贴第一行，尾部的 ** 被吃），且后续 ```js 转换整体落在
//     引用块内部（> ```js）——与「块手术后光标重定位到文档首块/首段」同族。
//   本文档 `marp: true` + 紧跟的 `---` 是 setext 标题，首段即 ANTLR 引用段。
// 下一步：追 Enter/粘贴后的 native selection 重定位路径（Content.setCursor
// 与块手术后的光标回落），确认为何不落在操作点。

const TEST_MDS_DIR = process.env.TEST_MDS_DIR ?? 'D:/md-ecosystem/test-mds'
const DOC = fs.readFileSync(
    `${TEST_MDS_DIR}/DataWareHouse/离线数仓/Hive基础/00-SQL引擎.md`,
    'utf-8'
).split('\r\n').join('\n')

const QUOTE_TEXT =
    '**ANTLR（ANother Tool for Language Recognition） 把 SQL 文本从字符串解析成结构化 AST 的解析器生成工具**'
const STEPS = new Set((process.env.STEPS ?? '').split(',').filter(Boolean))

async function typeCjk(page: import('@playwright/test').Page, romaji: string, hanzi: string): Promise<void> {
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

test.describe('bisect the conversion-loss preconditions', () => {
    test('steps=STEPS + fence conversion at first paragraph', async({ page }) => {
        test.setTimeout(120_000)
        await loadMarkdown(page, DOC)

        const paragraphs = page.locator('.mu-paragraph-content')

        if (STEPS.has('ime')) {
            await paragraphs.nth(1).click()
            await page.keyboard.press('End')
            await typeCjk(page, 'jinzeng', '增量甲')
            await page.keyboard.press('Enter')
            await typeCjk(page, 'xinhang', '新行乙')
        }

        if (STEPS.has('paste')) {
            // 与桌面一致：粘贴沿用上一步留下的光标（不点击），需要 ime 先行
            const probe = await page.evaluate(() => {
                const sel = document.getSelection()
                let node = sel?.anchorNode
                if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement
                const quote = node instanceof Element ? node.closest('blockquote') : null
                const para = node instanceof Element ? node.closest('.mu-paragraph-content') : null
                return {
                    hasSelection: !!sel && sel.rangeCount > 0,
                    collapsed: sel?.isCollapsed ?? null,
                    inQuote: !!quote,
                    paraText: para?.textContent?.slice(0, 30) ?? null,
                    anchorOffset: sel?.anchorOffset ?? null
                }
            })
            console.log('CARET-PROBE-BEFORE-PASTE:', JSON.stringify(probe))
            await page.evaluate(() => navigator.clipboard.writeText('粘贴第一行\n粘贴第二行'))
            await page.keyboard.press('Control+v')
        }

        if (STEPS.has('burst')) {
            await paragraphs.nth(2).click()
            await page.keyboard.press('End')
            await page.keyboard.press('Enter')
            await page.keyboard.type('burst 甲乙丙丁戊己庚辛壬癸 1234567890 quick-typing-stress', { delay: 0 })
        }

        if (STEPS.has('code')) {
            // first() 会命中 frontmatter 的（折叠不可见）code content
            const code = page.locator('.mu-codeblock-content:visible').first()
            await code.click()
            await page.keyboard.press('Control+End')
            await page.keyboard.type('\necho 编辑不丢内容', { delay: 0 })
        }

        // 转换（丢失现场）：首段 End + Enter×2 + ```js + Enter + 续打
        await paragraphs.first().click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.keyboard.type('```js', { delay: 0 })
        await page.keyboard.press('Enter')
        await page.keyboard.type('console.log("after-convert")', { delay: 0 })

        const md = await getMarkdown(page)
        expect(md, `RESULT:\n${md.slice(0, 3000)}`).toContain(QUOTE_TEXT)
    })
})
