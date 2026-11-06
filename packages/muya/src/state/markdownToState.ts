import type { ColumnMarkerInfo } from '../utils/columns/syntax';
import type { ListItemToken, TBlockToken } from '../utils/marked/types';
import type {
    IAtxHeadingState,
    IBulletListState,
    IColumnState,
    IListItemState,
    IOrderListState,
    ISetextHeadingState,
    ITableState,
    ITaskListItemState,
    ITaskListState,
    TState,
} from './types';
import { VOID_HTML_TAGS } from '../config';
import { firstWordOfInfo, parseFenceLine } from '../utils';
import { analyzeColumnMarkers, parseMarker } from '../utils/columns/syntax';
import { createDiagramState, diagramTypeOfLang } from '../utils/diagram/fence';
import logger from '../utils/logger';
import { lexBlock } from '../utils/marked';

/** A top-level state that carries a column marker, and where it sits. */
interface IColumnMarkerHit {
    /** Index of the carrying state in the flat top-level state list. */
    index: number;
    /** §4.6 — the marker rides a paragraph (inline badge) or stands alone. */
    inline: boolean;
    info: ColumnMarkerInfo;
}

const debug = logger('import markdown: ');

// A first line that is a COMPLETE standalone tag holding no content: any
// self-closing `<abc src=""/>`, or a void element (`<br>`, `<img ...>`, …)
// with or without the slash. Such a line cannot "own" the lines after it.
const SELF_CLOSING_TAG_LINE = /^<[a-z][a-z\d]*(?:\s[^<>]*)?\/>/i;
const OPEN_TAG_LINE = /^<([a-z][a-z\d]*)(?:\s[^<>]*)?>/i;

interface IMarkdownToStateOptions {
    footnote: boolean;
    texMathDollars: boolean;
    texMathGfm: boolean;
    texMathSingleBackslash: boolean;
    texMathDoubleBackslash: boolean;
    trimUnnecessaryCodeBlockEmptyLines: boolean;
    frontMatter: boolean;
    multilineBlockquote?: boolean;
};

const DEFAULT_OPTIONS = {
    footnote: false,
    texMathDollars: true,
    texMathGfm: false,
    texMathSingleBackslash: false,
    texMathDoubleBackslash: false,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true,
    multilineBlockquote: false,
};

// Token types whose handler manipulates the `parentList` stack (push a
// container and recurse via synthetic `block-end`), as opposed to the leaf
// tokens that only append a state to the current level.
const CONTAINER_TOKEN_TYPES = new Set([
    'block-end',
    'blockquote',
    'multilineBlockquote',
    'list',
    'list_item',
    'footnote',
]);

export class MarkdownToState {
    constructor(private _options: IMarkdownToStateOptions = DEFAULT_OPTIONS) {}

    generate(markdown: string): TState[] {
        return this._convertMarkdownToState(markdown);
    }

    private _convertMarkdownToState(markdown: string): TState[] {
        const {
            footnote = false,
            texMathDollars = true,
            texMathGfm = false,
            texMathSingleBackslash = false,
            texMathDoubleBackslash = false,
            trimUnnecessaryCodeBlockEmptyLines = false,
            frontMatter = true,
            multilineBlockquote = false,
        } = this._options;

        // markdownToState injects synthetic `block-end` markers (see the
        // blockquote/list/list_item/footnote cases below) to pop the parent
        // stack, so the working stream is wider than what `lexBlock` returns.
        const tokens: TBlockToken[] = lexBlock(markdown, {
            footnote,
            texMathDollars,
            frontMatter,
            texMathGfm,
            texMathSingleBackslash,
            texMathDoubleBackslash,
            multilineBlockquote,
        });

        const states: TState[] = [];
        let token: TBlockToken | undefined;
        const parentList: TState[][] = [states];

        // 上一个顶层 token：分栏标记行内化用它判定「紧贴段落」——前一个 token
        // 是 paragraph 且中间没有 space token 时空行不存在（见 inlineAdjacency.spec.ts）。
        let prevToken: TBlockToken | undefined;

        // eslint-disable-next-line no-cond-assign
        while ((token = tokens.shift())) {
            if (CONTAINER_TOKEN_TYPES.has(token.type))
                this._handleContainerToken(token, parentList, tokens);
            else
                this._handleLeafToken(token, parentList, tokens, trimUnnecessaryCodeBlockEmptyLines, prevToken);
            prevToken = token;
        }

        const withColumns = this._buildColumnGroups(states);

        return withColumns.length ? withColumns : [{ name: 'paragraph', text: '' }];
    }

    /**
     * 把顶层状态里的分栏标记收成 `columns` 结构（见 utils/columns/DESIGN.md）。
     *
     * 标记本身仍留在它所贴的段落 text 里（或独立的 html-block 里）——它才是
     * 可编辑、可序列化往返的真值；这里只补上「哪些块属于哪一栏」这层结构，
     * 好让 DOM 与块树同形，栏内也能正常编辑。
     *
     * 合法性判定复用 `analyzeColumnMarkers`（§1.3 七条），与 lint / 导出管线
     * 同一份真值：不合法的组一律不建结构，内容原样保留。
     */
    private _buildColumnGroups(states: TState[]): TState[] {
        if (!states.length)
            return states;

        const hits = this._collectColumnMarkers(states);
        if (!hits.length)
            return states;

        // The marker objects are handed to the group analysis as they are, so
        // the hit of each marker in the flat state list can be recovered by
        // identity.
        const { groups } = analyzeColumnMarkers(hits.map(hit => hit.info));
        if (!groups.length)
            return states;

        const hitOfMarker = new Map<ColumnMarkerInfo, IColumnMarkerHit>();
        hits.forEach((hit) => {
            hitOfMarker.set(hit.info, hit);
        });

        const out: TState[] = [];
        let cursor = 0;

        for (const group of groups) {
            const beginHit = hitOfMarker.get(group.markers[0])!;
            const endHit = hitOfMarker.get(group.markers[group.markers.length - 1])!;

            // §1.3 #4 — more than three columns degrade the whole group to a
            // linear layout; no structure, no columns.
            if (group.degraded) {
                out.push(...states.slice(cursor, endHit.index + 1));
                cursor = endHit.index + 1;
                continue;
            }

            // The `begin` marker stays outside the group: it terminates the
            // content *before* the columns, not a column of its own.
            out.push(...states.slice(cursor, beginHit.index + 1));
            cursor = beginHit.index + 1;

            const columns: IColumnState[] = [];
            let columnStart = cursor;
            for (let i = 1; i < group.markers.length; i++) {
                const boundary = hitOfMarker.get(group.markers[i])!;
                // The boundary marker terminates the column it follows: an
                // inline marker rides that column's last paragraph, a
                // block-level marker is a standalone block that ends the
                // column (hidden in the Columns view).
                columns.push({
                    name: 'column',
                    children: states.slice(columnStart, boundary.index + 1),
                });
                columnStart = boundary.index + 1;
            }
            cursor = columnStart;

            out.push({
                name: 'columns',
                meta: group.ratio ? { ratio: group.ratio } : {},
                children: columns,
            });
        }

        out.push(...states.slice(cursor));

        return out;
    }

    /**
     * The top-level states that carry a column marker.
     *
     * A marker reaches the state list in one of two shapes (§4.6): merged into
     * the text of the paragraph it hugs (the inline badge), or as a
     * standalone `html-block` (the block badge).
     */
    private _collectColumnMarkers(states: TState[]): IColumnMarkerHit[] {
        const hits: IColumnMarkerHit[] = [];

        states.forEach((state, index) => {
            if (state.name === 'paragraph') {
                const lines = state.text.split('\n');
                const parsed = parseMarker(lines[lines.length - 1] ?? '');
                if (parsed) {
                    hits.push({ index, inline: true, info: { ...parsed, line: 0, inline: true } });
                }
            }
            else if (state.name === 'html-block') {
                const parsed = parseMarker(state.text.trim());
                if (parsed) {
                    hits.push({ index, inline: false, info: { ...parsed, line: 0, inline: false } });
                }
            }
        });

        return hits;
    }

    private _handleContainerToken(
        token: TBlockToken,
        parentList: TState[][],
        tokens: TBlockToken[],
    ) {
        let state: TState;
        switch (token.type) {
            // Marks the end of the children's traversal and a return to the previous level
            case 'block-end': {
                // Fix #1735 the blockquote maybe empty. like bellow:
                // >
                // bar
                if (
                    parentList[0].length === 0
                    && (
                        token.tokenType === 'blockquote'
                        || token.tokenType === 'multilineBlockquote'
                        || token.tokenType === 'list-item'
                    )
                ) {
                    state = {
                        name: 'paragraph' as const,
                        text: '',
                    };
                    parentList[0].push(state);
                }
                parentList.shift();
                break;
            }

            case 'blockquote': {
                state = {
                    name: 'block-quote' as const,
                    children: [],
                };
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'blockquote' });
                tokens.unshift(...(token.tokens as TBlockToken[]));
                break;
            }

            case 'multilineBlockquote': {
                state = {
                    name: 'block-quote' as const,
                    meta: { style: 'fenced' as const },
                    children: [],
                };
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'multilineBlockquote' });
                tokens.unshift(...(token.tokens as TBlockToken[]));
                break;
            }

            case 'list': {
                state = this._buildListState(token);
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'list' });
                tokens.unshift(...(token.items as TBlockToken[]));
                break;
            }

            case 'list_item': {
                const { listItemType, checked, orderMarker } = token;
                let itemState: IListItemState | ITaskListItemState;
                if (listItemType === 'task') {
                    itemState = {
                        name: 'task-list-item',
                        meta: {
                            checked: Boolean(checked),
                            ...(orderMarker ? { orderMarker } : {}),
                        },
                        children: [],
                    };
                }
                else {
                    itemState = {
                        name: 'list-item',
                        ...(orderMarker ? { meta: { orderMarker } } : {}),
                        children: [],
                    };
                }

                state = itemState;
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'list-item' });
                tokens.unshift(...(token.tokens as TBlockToken[]));
                break;
            }

            case 'footnote': {
                // The footnote extension (utils/marked/extensions/footnote.ts)
                // emits a parent token whose `tokens` array holds nested
                // block tokens. Mirror that into a `footnote` container
                // state and recurse via tokens.unshift / block-end.
                const { identifier } = token;
                state = {
                    name: 'footnote' as const,
                    meta: { identifier },
                    children: [],
                };
                parentList[0].push(state);
                parentList.unshift(state.children);
                tokens.unshift({ type: 'block-end', tokenType: 'footnote' });
                tokens.unshift(...(token.tokens as TBlockToken[]));
                break;
            }
        }
    }

    /**
     * 分栏标记行内化（§4.6）：`<!-- begin / split / end -->` 注释紧贴顶层
     * 段落（前一个 token 是 paragraph、中间无 space）时并入该段 text，由
     * inlineRenderer 在段尾渲染徽标；前有空行、上文是标题 / 列表 / 引用等
     * 位置保持块级 html-block，由 htmlPreview 渲染块徽标兜底。
     *
     * 逐个标记独立判定而非整组：组内允许行内与块级混合，栏边界始终以标记
     * 的位置为准（columns 视图与导出管线按同一位置切栏），混合形态只影响
     * 视觉统一性。
     */
    private _tryInlineColumnMarker(
        text: string,
        prevToken: TBlockToken | undefined,
        parentList: TState[][],
    ): boolean {
        if (!parseMarker(text))
            return false;

        // 只行内化顶层标记。容器内（列表 / 引用 / 表格单元格）的标记按
        // §1.3 #7 保持 inert，块徽标形态与改造前一致。
        if (parentList.length !== 1)
            return false;

        // 前一个 token 是 paragraph 即保证中间无 space token：空行间隔会被
        // lexBlock 切成独立的 space token（inlineAdjacency.spec.ts）。
        if (prevToken?.type !== 'paragraph')
            return false;

        const last = parentList[0][parentList[0].length - 1];
        if (!last || last.name !== 'paragraph')
            return false;

        last.text += `\n${text}`;

        return true;
    }

    /**
     * The `html` leaf token: a single `<img>` demotes to a paragraph (legacy
     * behaviour), a column marker hugging a top-level paragraph is inlined
     * into it (§4.6), everything else stays a block-level `html-block`.
     */
    private _handleHtmlToken(
        token: Extract<TBlockToken, { type: 'html' }>,
        prevToken: TBlockToken | undefined,
        parentList: TState[][],
    ) {
        const text = token.text.trim();
        // TODO: Treat html state which only contains one img as paragraph, we maybe add image state in the future.
        const isSingleImage = /^<img[^<>]+>$/.test(text);
        if (isSingleImage) {
            parentList[0].push({ name: 'paragraph' as const, text });
        }
        else if (this._tryInlineColumnMarker(text, prevToken, parentList)) {
            // The marker was merged into the previous paragraph's text; the
            // inlineRenderer draws the trailing badge, no state of its own.
        }
        else if (this._splitAfterContentlessTag(text, parentList)) {
            // The tag line became its own html-block; the swallowed lines came
            // back as a paragraph.
        }
        else {
            parentList[0].push({ name: 'html-block' as const, text });
        }
    }

    // CommonMark HTML block type 7 keeps every following line until a blank
    // one, so `<abc src=""/>\n文字` loads as ONE html block and the trailing
    // text stops being editable markdown. A contentless tag (self-closing or
    // void) cannot own following lines — split them back out as a paragraph.
    // A remainder that itself opens with a tag keeps CommonMark swallowing:
    // that reads as authored multi-line HTML.
    private _splitAfterContentlessTag(text: string, parentList: TState[][]): boolean {
        const newlineIndex = text.indexOf('\n');
        if (newlineIndex === -1)
            return false;

        const firstLine = text.slice(0, newlineIndex).trimEnd();
        const rest = text.slice(newlineIndex + 1).trim();
        if (!rest || rest.startsWith('<'))
            return false;

        const selfClosing = SELF_CLOSING_TAG_LINE.test(firstLine);
        const openTag = OPEN_TAG_LINE.exec(firstLine);
        // VOID_HTML_TAGS is a literal tuple type; widen it for this lookup.
        const voidTags = VOID_HTML_TAGS as readonly string[];
        const isVoid = !!openTag && voidTags.includes(openTag[1].toLowerCase());
        if (!selfClosing && !isVoid)
            return false;

        parentList[0].push({ name: 'html-block' as const, text: firstLine });
        parentList[0].push({ name: 'paragraph' as const, text: rest });
        return true;
    }

    // `token` is one run of same-kind items (see compatibleTaskList).
    private _buildListState(
        token: Extract<TBlockToken, { type: 'list' }>,
    ): IOrderListState | IBulletListState | ITaskListState {
        const { listType, loose, start } = token;
        const bulletMarkerOrDelimiter = token.items[0].bulletMarkerOrDelimiter;
        const ordered = token.ordered === true;
        // Resolved by `compatibleTaskList` (list's first marker + run offset).
        const orderStart
            = typeof start === 'number' && Number.isFinite(start) ? start : 1;
        const sourceMarkers = token.items.map((item: ListItemToken) => item.orderMarker);
        const markers = sourceMarkers.every((marker): marker is string => !!marker)
            ? { sourceMarkers }
            : {};

        if (listType === 'order') {
            return {
                name: 'order-list',
                meta: {
                    loose,
                    start: orderStart,
                    delimiter: bulletMarkerOrDelimiter || '.',
                    ...markers,
                },
                children: [],
            };
        }

        if (listType === 'task') {
            return ordered
                ? {
                        name: 'task-list',
                        meta: {
                            ordered: true,
                            loose,
                            start: orderStart,
                            delimiter: bulletMarkerOrDelimiter || '.',
                            ...markers,
                        },
                        children: [],
                    }
                : {
                        name: 'task-list',
                        meta: { loose, marker: bulletMarkerOrDelimiter || '-' },
                        children: [],
                    };
        }

        return {
            name: 'bullet-list',
            meta: { loose, marker: bulletMarkerOrDelimiter || '-' },
            children: [],
        };
    }

    private _handleLeafToken(
        token: TBlockToken,
        parentList: TState[][],
        tokens: TBlockToken[],
        trimUnnecessaryCodeBlockEmptyLines: boolean,
        prevToken?: TBlockToken,
    ) {
        let state: TState;
        let value: string;
        switch (token.type) {
            case 'frontmatter': {
                const { lang, style, text } = token;
                value = text.replace(/^\s+/, '').replace(/\s$/, '');

                state = {
                    name: 'frontmatter' as const,
                    meta: {
                        lang,
                        style,
                    },
                    text: value,
                };

                parentList[0].push(state);
                break;
            }

            case 'hr': {
                state = {
                    name: 'thematic-break' as const,
                    text: token.raw.replace(/\n+$/, ''),
                };

                parentList[0].push(state);
                break;
            }

            case 'heading': {
                const { headingStyle, depth, text, marker } = token;
                value = headingStyle === 'atx'
                    ? `${'#'.repeat(+depth)} ${text}`
                    : text;

                if (headingStyle === 'atx') {
                    const atxState: IAtxHeadingState = {
                        name: 'atx-heading',
                        meta: { level: depth },
                        text: value,
                    };
                    state = atxState;
                }
                else {
                    const setextState: ISetextHeadingState = {
                        name: 'setext-heading',
                        meta: { level: depth, underline: marker },
                        text: value,
                    };
                    state = setextState;
                }

                parentList[0].push(state);
                break;
            }

            case 'code': {
                const { codeBlockStyle, text, lang: infoString = '', raw = '' } = token;
                // marked >=17 appends a trailing newline to indented code text
                // (fenced text has none); strip it so indented blocks round-trip.
                const codeText = codeBlockStyle === 'indented' ? text.replace(/\n$/, '') : text;
                // Read the opening fence itself so its character (` or ~) and
                // run length both survive the round trip (CommonMark §4.5).
                const fence = parseFenceLine(raw);
                const fenceLength = fence?.fenceLength;
                const fenceChar = fence?.fenceChar;
                parentList[0].push(
                    this._buildCodeState(codeText, infoString, codeBlockStyle, trimUnnecessaryCodeBlockEmptyLines, fenceLength, fenceChar),
                );
                break;
            }

            case 'table': {
                const { header, align, rows } = token;
                const tableState: ITableState = {
                    name: 'table',
                    children: [],
                };

                // Store the cell text as marked emits it (with the table `\|`
                // escape already resolved to a literal `|`), so the editor shows
                // `` `|` `` rather than the escaped `` `\|` `` inside inline code
                // (#4849). `escapeText` re-adds the `\|` escape on serialization,
                // keeping the markdown round-trip intact.
                tableState.children.push({
                    name: 'table.row',
                    children: header.map((h, i) => ({
                        name: 'table.cell' as const,
                        meta: { align: align[i] || 'none' },
                        text: h.text,
                    })),
                });

                tableState.children.push(
                    ...rows.map(row => ({
                        name: 'table.row' as const,
                        children: row.map((c, i) => ({
                            name: 'table.cell' as const,
                            meta: { align: align[i] || 'none' },
                            text: c.text,
                        })),
                    })),
                );

                state = tableState;
                parentList[0].push(state);
                break;
            }

            case 'html': {
                this._handleHtmlToken(token, prevToken, parentList);
                break;
            }

            case 'multiplemath': {
                const text = token.text.trim();
                const { mathStyle = '' } = token;
                const state = {
                    name: 'math-block' as const,
                    text,
                    meta: { mathStyle },
                };
                parentList[0].push(state);
                break;
            }

            case 'text': {
                value = token.text;
                while (tokens[0]?.type === 'text') {
                    const next = tokens.shift() as Extract<TBlockToken, { type: 'text' }>;
                    value += `\n${next.text}`;
                }
                state = {
                    name: 'paragraph',
                    text: value,
                };
                parentList[0].push(state);
                break;
            }

            case 'paragraph': {
                value = token.text;
                state = {
                    name: 'paragraph' as const,
                    text: value,
                };
                parentList[0].push(state);
                break;
            }

            case 'space': {
                break;
            }

            case 'def': {
                // Marked v16 hoists `[label]: url "title"` reference
                // definitions to block-level `def` tokens. Lower them back
                // to paragraph state nodes so the rest of the pipeline —
                // `InlineRenderer.collectReferenceDefinitions` (regex scan
                // over paragraph text) and round-trip serialization —
                // keeps working without a dedicated state node.
                // Aligns with marktext's "definition is paragraph text"
                // model. See plan section 13 (PR-16).
                state = {
                    name: 'paragraph' as const,
                    text: token.raw.replace(/\n+$/, ''),
                };
                parentList[0].push(state);
                break;
            }

            default:
                debug.warn(`Unknown type ${token.type}`);
                break;
        }
    }

    private _buildCodeState(
        text: string,
        infoString: string,
        codeBlockStyle: 'indented' | undefined,
        trimUnnecessaryCodeBlockEmptyLines: boolean,
        fenceLength?: number,
        fenceChar?: '`' | '~',
    ): TState {
        // Keep the whole info string; the language for highlighting / diagram
        // detection is its first word (CommonMark §4.5).
        const info = (infoString || '').trim();
        const lang = firstWordOfInfo(info);

        let value = text;
        // Fix: #1265.
        if (
            trimUnnecessaryCodeBlockEmptyLines
            && (value.endsWith('\n') || value.startsWith('\n'))
        ) {
            value = value.replace(/\n+$/, '').replace(/^\n+/, '');
        }

        const diagramType = diagramTypeOfLang(lang);
        if (diagramType)
            return createDiagramState(diagramType, value);

        // walkTokens (utils/marked/walkTokens.ts) writes
        // codeBlockStyle = 'fenced' for fenced blocks and
        // leaves 'indented' for indented blocks. marked's
        // type widens the field to `'indented' | undefined`,
        // but `'fenced'` reaches us at runtime via the
        // walkTokens assignment — hence the cast.
        const isFenced = (codeBlockStyle as 'indented' | 'fenced' | undefined) === 'fenced';
        return {
            name: 'code-block' as const,
            meta: {
                type: isFenced ? 'fenced' : 'indented',
                // The full info string verbatim (empty for indented blocks); the
                // language is its first word — see `firstWordOfInfo`.
                lang: info,
                ...(isFenced && fenceLength && fenceLength > 3 ? { fenceLength } : {}),
                ...(isFenced ? { fenceChar: fenceChar ?? '`' } : {}),
            },
            text: value,
        };
    }
}
