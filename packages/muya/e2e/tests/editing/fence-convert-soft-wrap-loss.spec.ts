import { expect, test } from '../fixtures/muya'
import { loadMarkdown } from '../helpers/keyboard'
import * as fs from 'node:fs'

// 围栏转换吞掉光标后文本（视图切换丢内容遗留三的引擎根因）：
//
// 编辑区偏窄时段落软换行，End 落在软行尾而非段尾；Enter×2 拆段后光标在
// 尾行段首，敲 ```js 回车——_enterConvert 曾把整个段落 replaceWith 成空代
// 码块，光标后的正文（拆段出来的段落尾部）整体蒸发。真实现场：00-SQL引
// 擎.md 的 ANTLR 引用段（80 字符）在桌面编辑区宽度下折成两行，转换后引用
// 段只剩前 63 字符，其余 17 字符消失。
//
// 修复：_enterConvert 在光标后有内容时只消费光标前的块语法，光标后文本
// 另立段落排在转换块之后；光标前不是完整块语法则退回普通拆段。
//
// 两层用例：合成文档恒跑（不依赖外部目录）；真实讲义 TEST_MDS_DIR 在场才跑。

const QUOTE_PREFIX = '**ANTLR（ANother Tool for Language Recognition） 把 SQL 文本从字符串解析成'
const QUOTE_TAIL = '构化 AST 的解析器生成工具**'

const SYNTHETIC_DOC = [
    '# 标题',
    '',
    `> ${QUOTE_PREFIX}${QUOTE_TAIL}`,
    '',
    '### 后续',
    ''
].join('\n')

const TEST_MDS_DIR = process.env.TEST_MDS_DIR ?? 'D:/md-ecosystem/test-mds'
const REAL_DOC_PATH = `${TEST_MDS_DIR}/DataWareHouse/离线数仓/Hive基础/00-SQL引擎.md`

test.describe('fence conversion at a soft-wrap boundary keeps the text after the caret', () => {
    test.beforeEach(async({ page }) => {
        // 窄视口让引用段必然软换行，End 落在软行尾（段中）
        await page.setViewportSize({ width: 520, height: 720 })
    })

    test('synthetic wrapped quote — tail survives as its own paragraph', async({ page }) => {
        await loadMarkdown(page, SYNTHETIC_DOC)
        await page.waitForTimeout(300)

        // 引用段确实软换行成多行（End 才会落在段中）
        const wrap = await page.evaluate(() => {
            const para = document.querySelector('.mu-paragraph-content') as HTMLElement | null
            if (!para) return -1
            const range = document.createRange()
            range.selectNodeContents(para)
            return [...range.getClientRects()].filter(r => r.width > 2).length
        })
        expect(wrap, 'quote paragraph must wrap into multiple lines at this width').toBeGreaterThan(1)

        await page.locator('.mu-paragraph-content').first().click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.keyboard.type('```js', { delay: 30 })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)

        const md = await page.evaluate(() => {
            const w = window as unknown as { muya: { flush(): void; getMarkdown(): string } }
            w.muya.flush()
            return w.muya.getMarkdown()
        })
        expect(md, `RESULT:\n${md}`).toContain(QUOTE_PREFIX)
        expect(md, `RESULT:\n${md}`).toContain(QUOTE_TAIL)
        // 转换仍然发生：代码块在场
        expect(md).toContain('```js')
    })

    test('real lecture doc (00-SQL引擎.md) — ANTLR quote survives', async({ page }) => {
        test.skip(!fs.existsSync(REAL_DOC_PATH), `test-mds not available: ${REAL_DOC_PATH}`)
        await loadMarkdown(page, fs.readFileSync(REAL_DOC_PATH, 'utf-8').split('\r\n').join('\n'))
        await page.waitForTimeout(300)

        await page.locator('.mu-paragraph-content').first().click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.keyboard.type('```js', { delay: 30 })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)

        const md = await page.evaluate(() => {
            const w = window as unknown as { muya: { flush(): void; getMarkdown(): string } }
            w.muya.flush()
            return w.muya.getMarkdown()
        })
        expect(md, `RESULT:\n${md.slice(0, 1200)}`).toContain(QUOTE_PREFIX)
        expect(md, `RESULT:\n${md.slice(0, 1200)}`).toContain(QUOTE_TAIL)
        expect(md).toContain('```js')
    })
})
