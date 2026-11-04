// Built-in skeletons for the sidebar "New from template" action. Templates are
// plain Markdown strings with `{{filename}}` / `{{date}}` placeholders that the
// project store substitutes at creation time. Kept as renderer constants (not
// files under resources/) so v1 needs no extra IPC or asar unpacking.
//
// Front matter fields follow md2slides conventions (theme: lecture,
// headingDivider: 2 = `##` starts a new chapter) — verify against md2slides'
// USAGE.md when changing them, not from memory.

export type NewFileTemplateKind = 'deck' | 'quiz'

export const NEW_FILE_TEMPLATE_KINDS: readonly NewFileTemplateKind[] = ['deck', 'quiz']

const DECK_SKELETON = [
  '## 第一章 章节标题',
  '',
  '- 用 `##` 二级标题分章，引擎自动分页，不需要手写分页符',
  '- 表格、代码、列表装不下时自动续页（表头、行号、编号不断）',
  '- 表格、代码、列表、图片、公式是「核心」，优先保证完整不被拆开',
  '',
  '## 一页一个核心',
  '',
  '| 角色 | 说明 |',
  '| --- | --- |',
  '| 引导语 | 紧贴核心前的唯一段落 |',
  '| 核心 | 表格 / 代码 / 列表 / 图片 / 公式，一页最多 4 个 |',
  '| 结束语 | 紧贴核心后的唯一段落 |',
  ''
].join('\n')

const TEMPLATES: Record<NewFileTemplateKind, string> = {
  deck: [
    '---',
    'title: {{filename}}',
    'date: {{date}}',
    'theme: lecture',
    'headingDivider: 2',
    '---',
    '',
    '',
    DECK_SKELETON
  ].join('\n'),
  quiz: [
    '---',
    'title: {{filename}}',
    'date: {{date}}',
    'theme: lecture',
    'headingDivider: 2',
    '---',
    '',
    '',
    DECK_SKELETON,
    '',
    '## 课堂竞答示例',
    '',
    '<!--quiz {"answer":"B","limit":30}-->',
    '以下哪个是进程的基本状态？',
    '',
    '- 运行',
    '- 就绪',
    '- 死亡',
    '- 超频',
    '',
    '<!-- 规则：quiz 注释后的第一个段落是题干，紧跟的第一个列表是选项；',
    '     answer 填正确选项字母（没写不允许发放），limit 是作答限时秒数。',
    '     配置好课堂竞答（classbuzz）后，放映时点题干旁的「发放」即可抢答。 -->',
    ''
  ].join('\n')
}

export const isNewFileTemplateKind = (value: unknown): value is NewFileTemplateKind =>
  typeof value === 'string' && (NEW_FILE_TEMPLATE_KINDS as readonly string[]).includes(value)

// Substitute the placeholders. `filename` should be the base name WITHOUT the
// .md extension (it lands inside the front matter title).
export const renderNewFileTemplate = (kind: NewFileTemplateKind, filename: string): string =>
  TEMPLATES[kind]
    .replace(/\{\{filename\}\}/g, filename)
    .replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10))
