# 文档配置（Frontmatter）总览

文览生态由多个组件协作：**文览（编辑器）**、**放映（md2slides）**、**代码运行（mdcode2run）**、**课堂竞答（classbuzz）**。它们各自定义了「写在文档里、控制渲染 / 运行行为」的配置。本文把四者统一成同一种结构列出，方便查阅。

> 本文是面向用户的查阅手册。各项目的实现级权威清单见仓库内各自的 `docs/FRONTMATTER.md`（文览、md2slides、mdcode2run）。

## 总览对比

| 组件                   | 配置载体                             | 是否 YAML frontmatter        | 用途                       | 核心键                              |
| ---------------------- | ------------------------------------ | ---------------------------- | -------------------------- | ----------------------------------- |
| 文览（纸面叶）         | `---` 顶栏                           | ✅（仅 2 键）                | 控制纸型 / 纸面主题        | `paper`、`paperTheme`               |
| 放映（md2slides）      | `---` 顶栏                           | ✅（16 键）                  | 封面、分页、主题、放映形态 | `title`、`theme`、`headingDivider`… |
| 代码运行（mdcode2run） | `---` 顶栏                           | ✅（`code-exec:` 段 + 顶层） | 运行环境 / 连接凭据        | `code-exec.java.JAVA_HOME`、`host`… |
| 课堂竞答（classbuzz）  | 正文 `<!--quiz-->` 注释 + 服务端房间 | ❌ 无                        | 题目与竞答房间             | `answer`、`limit`、`room`…          |

## 什么是 frontmatter

YAML frontmatter 是写在 Markdown 文档**最顶部**的一段 `---` 围栏块：

```markdown
---
title: 我的讲义
theme: lecture
---

# 正文从这里开始
```

通用规则（各项目略有差异，见各节）：

- 必须位于文档最顶部，围栏两侧允许空格 / 制表符。
- 标量解析：数字、布尔、去引号字符串；不引第三方 YAML 库。
- 未声明的键不补默认值（无配置的文档走各项目内置缺省）。
- 未知键通常静默忽略，不报错。

---

## 1. 文览 · 纸面叶（paper）

**作用域**：仅「纸面叶」视图消费这两键；编辑器内核把 frontmatter 当作**无语义通用块**渲染，不解析键值。

**解析位置**：`packages/desktop/src/renderer/src/util/paperPagination.ts`（`parseDeclaredPaperSize` / `parsePaperTheme`）。

### 配置键

| 键           | 取值                            | 说明                                                                                                  | 缺省                     | 消费点   |
| ------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------ | -------- |
| `paper`      | `a4` / `letter`                 | 纸型。键名**大小写敏感**（须写 `paper:`），值大小写不敏感；未知值按未声明处理                         | A4（屏测与打印同源回退） | 纸面几何 |
| `paperTheme` | `academic` / `liber` / `thesis` | 纸面主题（`assets/themes/export/*.theme.css`）。只动排版层（字体 / 字号 / 标题 / 表格），不动纸面几何 | 无主题（裸排版层）       | 导出排版 |

### 注意

- 纸型 / 边距归 frontmatter；边距当前固定 20/15mm，**没有边距键**。
- `<!-- pagebreak -->` 是正文注释标记，**不是** frontmatter。
- 放映链路的 frontmatter 由内置 md2slides 消费，不归本组件（见下一节）。

---

## 2. 放映 · md2slides（内置引擎）

**作用域**：封面页、分页、主题、放映形态、PPTX 文件属性。

**解析位置**：`core/parse/frontMatter.js`（`deckMeta` + `frontMatterPairs`）。

**注意**：文览内置的 md2slides 是构建副本（`packages/desktop/resources/md2slides/`），键集合与独立仓库 `md2slides/docs/FRONTMATTER.md` 一致。

### 2.1 元数据键（进封面 + PPTX 文件属性）

| 键         | 取值                        | 说明                                                 | 缺省                    | 去向            |
| ---------- | --------------------------- | ---------------------------------------------------- | ----------------------- | --------------- |
| `title`    | 文本                        | 封面题名；PPTX 标题                                  | 无则不生成封面          | 封面 / 文件属性 |
| `subtitle` | 文本                        | 封面副标题；PPTX 主题                                | `null`                  | 封面 / 文件属性 |
| `author`   | 文本                        | 封面作者；PPTX 作者                                  | `null`                  | 封面 / 文件属性 |
| `date`     | 文本 / 数字                 | 封面日期（字符串原样进 IR）                          | `null`                  | 封面            |
| `datetime` | 文本                        | `date` 别名（marp 兼容）；两者都有时 `date` 优先     | —                       | 封面            |
| `book`     | 文本                        | 书籍 / 课程名 → 页眉左侧内容源                       | `null`                  | 页眉            |
| `header`   | `true` / `false` / `"文本"` | 页眉三态：开 / 关 / 自定义                           | `true`                  | 页眉            |
| `footer`   | 同上                        | 页脚三态                                             | `true`                  | 页脚            |
| `keywords` | `A, B` 或 `[A, B]`          | 正文命中即高亮（分隔符 `,，;；、` 兼容）             | `[]`                    | 渲染            |
| `show`     | `page` / `element`          | 放映形态：整页全显 / 渐进揭示                        | 壳 config → 引擎 `page` | 放映            |
| `page`     | `true` / `false`            | 仅 `show: page` 有意义：逐元素游走（默认）/ 纯整页翻 | `null` 回退壳 config    | 放映            |

### 2.2 渲染键（分页 / 主题 / 目录）

| 键               | 取值                        | 说明                                                  | 缺省      |
| ---------------- | --------------------------- | ----------------------------------------------------- | --------- |
| `headingDivider` | 1–6                         | 第 N 级标题起切页（钳到 1–6）                         | `3`       |
| `theme`          | 主题名                      | `core/themes/` 下 `@theme` 匹配；不存在回退 `lecture` | `lecture` |
| `paginate`       | `true`                      | 打页码（严格 `=== true` 才生效）                      | 不打      |
| `semicolons`     | `false`                     | 分号转列表**关闭**（默认开，仅显式 `false` 关）       | `true`    |
| `toc`            | `true` / `false` / 数字 1–6 | 章节目录页；章节数 < 2 不插                           | `true`    |

### 注意

- `page` 与 `paginate` 是两键：`page` 管放映翻页粒度，`paginate` 管页脚打不打页码。
- `doc-type`（旧文提过）**未实现**，写了无效。

### 优先级

```
放映形态   front-matter show/page > 壳 config SHOW/PAGE > 引擎缺省
主题/分页  front-matter headingDivider/theme/paginate/semicolons/toc > DECK_DEFAULTS
```

---

## 3. 代码运行 · mdcode2run

**作用域**：文档内可运行代码块的执行环境与连接配置。

**解析位置**：`lib/front-matter.js` + `lib/fences.js`（`parseCodeExecFrontMatter`）。

**配置三层优先级**：fence 块级标注 > 本文档 frontmatter > 引擎配置（秘密层）。

### 3.1 `code-exec:` 段（文档级执行默认）

| 键                             | 语言   | 取值              | 说明                                             |
| ------------------------------ | ------ | ----------------- | ------------------------------------------------ |
| `code-exec.java.JAVA_HOME`     | java   | JDK 根或 bin 目录 | 每次运行现取（换文档换 JDK）                     |
| `code-exec.java.class-path`    | java   | `;` 分隔或数组    | `dir/*` 展开该目录全部 jar；相对路径基于文档目录 |
| `code-exec.python.PYTHON_PATH` | python | 解释器路径        | 相对路径按 cwd 解析                              |
| `code-exec.mysql.HOST`         | mysql  | 标量              | 连接覆盖；`PORT` / `USER` / `DATABASE` 同理      |
| `code-exec.mysql.PASSWORD`     | —      | **禁止**          | 秘密只在引擎层（分享讲义的前提）                 |

段名（java / python / mysql…）即语言段；同段内键大小写不敏感。

### 3.2 顶层旧写法（仍认，优先级低于 `code-exec:` 段）

| 键                         | 别名                                | 说明                                                                 |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `host`                     | `hostname` `ssh_host` `remote_host` | 远端主机（配合块内 `[user@host]$` 或壳配置 `MODE=remote`）           |
| `user`                     | `username` `ssh_user` `remote_user` | 远端用户名                                                           |
| （其余顶层标量键）         | —                                   | **凭据表**：键 = 用户名、值 = 密码；`sudo` 自动改写 `sudo -S` 喂密码 |
| `JAVA_HOME` / `class-path` | —                                   | java 旧顶层写法（`code-exec.java.*` 优先）                           |

### 注意

- 键名大小写不敏感。
- **密码不进 frontmatter**——秘密只放引擎配置（宿主偏好），前言层无权读取。
- 块级 fence 标注（`demo` / `file=` / `job`…）不属 frontmatter，见 `FENCE.md`。

---

## 4. 课堂竞答 · classbuzz（无 frontmatter）

**classbuzz 没有 YAML frontmatter**。它的「文档级配置」走两条别的通道：

1. **题目写在正文注释** `<!--quiz {"answer":"B","limit":30}-->`（markdown-it core rule 解析，渲染后由 sectionize 保留）。
2. **竞答房间靠服务端配置**：题用房口令 `host_attach` 接入，结果回讲义底部浮层。

### quiz 题注字段

| 字段     | 取值               | 说明                                        |
| -------- | ------------------ | ------------------------------------------- |
| `answer` | 选项字母（如 `B`） | 正确答案                                    |
| `limit`  | 秒数（如 `30`）    | 答题时限                                    |
| （其他） | —                  | 题型扩展（多选 / 判断）在远期路线，尚未落地 |

### 注意

- 全仓无 `---` 围栏或 YAML 解析；不要把放映 / 纸面的 frontmatter 键写到 classbuzz 讲义里，它们不生效。
- 题目与放映（md2slides）共用同一份讲义：放映键归 md2slides，题目归 classbuzz，互不冲突。

---

## 跨组件要点

- **文览的 frontmatter 不归自己全管**：muya 渲染层无键语义；纸面叶只认 2 键；放映键完整委托给内置 md2slides。
- **同一份讲义可能同时被多个组件读**：例如放映讲义里既写 `theme:`（md2slides）又写 `<!--quiz-->`（classbuzz）——前者控制放映，后者出题，互不干扰。
- **优先级模型各不相同**：md2slides（show/page > 壳 > 引擎；headingDivider/theme… > DECK_DEFAULTS）、mdcode2run（fence > frontmatter > 引擎）、文览纸面叶（独立正则各取各的，未声明回退默认）。
