# 文档配置（Frontmatter）总览

文览生态由四个组件协作：**文览（编辑器）**、**放映（md2slides）**、**代码运行（mdcode2run）**、**课堂竞答（classbuzz）**。它们各自定义了「写在文档里、控制渲染或运行行为」的配置。左侧目录可切换到任意一个组件的完整清单。

> 本文是面向查阅的入口。四份完整清单由各项目在自己的 `docs/FRONTMATTER.md` 维护，本帮助窗口内的内容是它们的离线快照。有功能变更时，各项目先更新自己的文档，再由 wenlan 同步。

## 四组件对比

| 组件                  | 配置载体                             | 是否 YAML frontmatter        | 用途                       | 核心键                                    |
| --------------------- | ------------------------------------ | ---------------------------- | -------------------------- | ----------------------------------------- |
| 文览 · 纸面叶         | 文档顶部 `---` 围栏                  | 是（仅 2 键）                | 纸型 / 纸面主题            | `paper`、`paperTheme`                     |
| 放映 · md2slides      | 文档顶部 `---` 围栏                  | 是（16 键）                  | 封面、分页、主题、放映形态 | `title`、`theme`、`headingDivider`、`toc` |
| 代码运行 · mdcode2run | 文档顶部 `---` 围栏                  | 是（`code-exec:` 段 + 顶层） | 执行环境 / 连接配置        | `code-exec.java.JAVA_HOME`、`host`        |
| 课堂竞答 · classbuzz  | 正文 `<!--quiz-->` 注释 + 服务端房间 | **否**                       | 题目与竞答房间             | `answer`、`limit`、`id`                   |

## 什么是 frontmatter

YAML frontmatter 是写在 Markdown 文档**最顶部**的一段 `---` 围栏块：

```markdown
---
title: 我的讲义
theme: lecture
---

# 正文从这里开始
```

通用规则（各项目略有差异，详见各组件页）：

- 必须位于文档最顶部，围栏两侧允许空格或制表符。
- 标量解析：数字、布尔、去引号字符串；不引第三方 YAML 库。
- 有 frontmatter 则作者声明全算数，未声明的键不补默认值（无配置时走各项目内置缺省）。
- 未知键通常静默忽略，不报错。

## 跨组件要点

- **文览的 frontmatter 不归自己全管**：muya 渲染层无键语义，纸面叶只认 2 键，放映键完整委托给内置 md2slides。
- **同一份讲义可能同时被多个组件读**：讲义里既写 `theme:`（md2slides）又写 `<!--quiz-->`（classbuzz）是常见用法——前者控制放映，后者出题，互不干扰。
- **优先级模型各不相同**：
  - md2slides：`show/page` > 壳 config > 引擎缺省；`headingDivider/theme/...` > `DECK_DEFAULTS`
  - mdcode2run：fence 块级标注 > 文档 frontmatter > 引擎配置（秘密层）
  - 文览纸面叶：独立正则各取各的，未声明回退默认
  - classbuzz：题注字段 > 引擎缺省；房间状态由服务端持有
- **密码不进 frontmatter**（mdcode2run）：秘密只放引擎配置，这是分享讲义的前提。
- `page` 与 `paginate` 是两个不同的键：前者管放映翻页粒度，后者管页脚打不打页码。

## 易错点

- `doc-type`（md2slides 旧文提过）**未实现**，写了无效。
- `<!-- pagebreak -->`（纸面叶）与 `<!--quiz-->`（竞答）都是正文注释标记，**不是** frontmatter。
- classbuzz 讲义顶部写 `---` 块不生效——它不解析 YAML。
