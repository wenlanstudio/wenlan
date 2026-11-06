# 文览 front-matter 配置（本仓库权威参考）

> 依据源码逐项核实（2026-11-04）：`packages/desktop/src/renderer/src/util/paperPagination.ts`
> （paper 叶读取）。键有增删先改代码，再同步本文件。
> 跨引擎总册：`../../AUTHORING-SPEC.md`（生态根目录）。

## 0. 范围

- 文览自身只消费**纸面叶（paper）**的纸型/纸面主题两键（见 §1）。
- 编辑器内核 muya 把 front-matter 当**通用块**渲染（`pre.mu-frontmatter`），**没有任何键语义**；
  偏好设置里的 `frontmatterType` 只影响新建 front-matter 块的围栏风格（`-` / `;` / `+` / `{`），不解析键值。
- 放映（deck）链路的 front-matter 键由内置的 md2slides 消费，不归本仓库管——
  见 `../../md2slides/docs/FRONTMATTER.md`（本仓库 `packages/desktop/resources/md2slides/` 是它的构建副本）。

## 1. 纸面叶键（paperPagination.ts）

| 键           | 值                              | 说明                                                                                                                                                      | 缺省                       |
| ------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `paper`      | `a4` / `letter`                 | 纸型。**键名大小写敏感**（须写 `paper:`），值大小写不敏感；未知值按未声明处理                                                                             | A4（屏测与打印链同源回退） |
| `paperTheme` | `academic` / `liber` / `thesis` | 纸面主题（`assets/themes/export/*.theme.css`）。只动排版层（字体/字号/标题/表格），不动纸面几何——屏显页数 = printToPDF 页数不被主题破坏。值会被转小写匹配 | 无主题（裸排版层）         |

写法示例：

```markdown
---
paper: A4
paperTheme: thesis
---
```

## 2. 解析细节

- 独立正则各解析各的（`parseDeclaredPaperSize` / `parsePaperTheme`），未声明或解析不出 = `null`，
  调用方各回退默认：屏侧 A4，导出对话框保留用户上次选择。
- 纸型/边距归 front-matter（边距当前固定 20/15mm，front-matter 无边距键）。
- `<!-- pagebreak -->` 是正文注释标记，不是 front-matter。
