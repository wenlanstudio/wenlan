export interface IParagraphState {
    name: 'paragraph';
    text: string;
}

export interface IAtxHeadingState {
    name: 'atx-heading';
    meta: {
        level: number;
    };
    text: string;
}

export interface ISetextHeadingState {
    name: 'setext-heading';
    meta: {
        level: number;
        underline: string; // "===" | "---";
    };
    text: string;
}

export interface IThematicBreakState {
    name: 'thematic-break';
    text: string;
}

export interface ICodeBlockState {
    name: 'code-block';
    meta: {
        type: string; // "indented" | "fenced";
        // The full fenced info string, verbatim (e.g. `js`, `js title="x"`, or a
        // Pandoc/RMarkdown `{…}` block). The language for highlighting is its
        // first word — derive via `firstWordOfInfo()`, never assume a single word.
        lang: string;
        fenceLength?: number;
        // Fence character for fenced blocks. Always written for `fenced`
        // blocks; omitted only for `indented` ones, which have no fence.
        // Older persisted state may still lack it — readers treat that as '`'.
        fenceChar?: '`' | '~';
    };
    text: string;
}

export interface IHtmlBlockState {
    name: 'html-block';
    text: string;
}

/**
 * @deprecated Reference definitions are stored as paragraph state nodes whose
 * `text` is the raw `[label]: url "title"` line (matches marktext's
 * "definition is paragraph text" model). `InlineRenderer.collectReferenceDefinitions`
 * regex-scans paragraphs to build the labels Map. This interface is unused
 * across the codebase and exists only for legacy type compatibility; remove
 * in v0.3.
 */
export interface ILinkReferenceDefinitionState {
    name: 'link-reference-definition';
    text: string;
}

export interface IBlockQuoteState {
    name: 'block-quote';
    meta?: {
        style?: 'fenced';
    };
    children: TState[];
}

export interface IListItemState {
    name: 'list-item';
    meta?: {
        orderMarker?: string; // e.g. "1.", "001.", "10)"
    };
    children: TState[];
}

export interface IOrderListState {
    name: 'order-list';
    meta: {
        start: number;
        loose: boolean;
        delimiter: string; // "." | ")";
        sourceMarkers?: string[]; // Original item markers for no-edit source round-trips.
    };
    children: IListItemState[];
}

export interface IBulletListState {
    name: 'bullet-list';
    meta: {
        marker: string; // "-" | "+" | "*";
        loose: boolean;
    };
    children: IListItemState[];
}

export interface ITableRowState {
    name: 'table.row';
    children: ITableCellState[];
}

export interface ITableCellMeta {
    align: string; // 'none' | 'left' | 'center' | 'right';
}

export interface ITableCellState {
    name: 'table.cell';
    meta: ITableCellMeta;
    text: string;
}

export interface ITableState {
    name: 'table';
    children: ITableRowState[];
}

export interface ITaskListItemMeta {
    checked: boolean;
    orderMarker?: string; // e.g. "1.", "007.", "10)"
}

export interface ITaskListItemState {
    name: 'task-list-item';
    meta: ITaskListItemMeta;
    children: TState[];
}

/** A task list is unordered (`marker`) or ordered (`start`/`delimiter`). */
export type ITaskListMeta = ITaskListMetaUnordered | ITaskListMetaOrdered;

export interface ITaskListMetaUnordered {
    ordered?: false;
    marker: string; // "-" | "+" | "*";
    loose: boolean;
}

export interface ITaskListMetaOrdered {
    ordered: true;
    start: number;
    delimiter: string; // "." | ")";
    loose: boolean;
    sourceMarkers?: string[]; // Original item markers for no-edit source round-trips.
}

export interface ITaskListState {
    name: 'task-list';
    meta: ITaskListMeta;
    children: ITaskListItemState[];
}

export interface IMathMeta {
    mathStyle: string; // "" | "gfm";
}

export interface IMathBlockState {
    name: 'math-block';
    meta: IMathMeta;
    text: string;
}

export interface IFrontmatterMeta {
    lang: string; // "yaml" | "toml" | "json";
    style: string; //  "-" | "+" | ";" | "{";
}

export interface IFrontmatterState {
    name: 'frontmatter';
    meta: IFrontmatterMeta;
    text: string;
}

export type TDiagramType
    = | 'mermaid'
        | 'plantuml'
        | 'vega-lite'
        | 'flowchart'
        | 'sequence'
        | 'graphviz'
        | 'wavedrom'
        | 'echarts'
        | 'chart'
        | 'abc'
        | 'drawio'
        | 'matplotlib';

export interface IDiagramMeta {
    lang: string; // 'yaml' | 'json' | 'dot' | ...
    type: TDiagramType;
}

export interface IDiagramState {
    name: 'diagram';
    meta: IDiagramMeta;
    text: string;
}

export interface IFootnoteBlockMeta {
    identifier: string;
}

export interface IFootnoteBlockState {
    name: 'footnote';
    meta: IFootnoteBlockMeta;
    children: TState[];
}

/**
 * One column of a column group. A pure container: the content blocks live
 * directly in `children`, in document order.
 */
export interface IColumnState {
    name: 'column';
    children: TState[];
}

export interface IColumnsMeta {
    /**
     * Validated column-width percentages (`30:70` → `[30, 70]`). Absent means
     * "equal widths" — §1.3 #5 downgrades a malformed ratio instead of
     * guessing one.
     */
    ratio?: number[];
}

/**
 * A `<!-- begin --> … <!-- end -->` group, as a node of the block tree.
 *
 * The markers themselves stay in the text of the block they belong to (an
 * inline badge) or in a standalone `html-block`; this state only records the
 * grouping, so the DOM mirrors the tree and editing inside a column works.
 * See `utils/columns/DESIGN.md`.
 */
export interface IColumnsState {
    name: 'columns';
    meta: IColumnsMeta;
    children: IColumnState[];
}

export type TLeafState
    = | IParagraphState
        | IAtxHeadingState
        | ISetextHeadingState
        | IThematicBreakState
        | ICodeBlockState
        | IHtmlBlockState
        | ILinkReferenceDefinitionState
        | IMathBlockState
        | IFrontmatterState
        | IDiagramState
        | ITableCellState;

export type TContainerState
    = | IBlockQuoteState
        | IOrderListState
        | IBulletListState
        | ITableState
        | ITaskListState
        | ITaskListItemState
        | IListItemState
        | ITableRowState
        | IFootnoteBlockState
        | IColumnsState
        | IColumnState;

export type TState = TLeafState | TContainerState;

export type CodeContentState = ICodeBlockState | IHtmlBlockState | IDiagramState | IMathBlockState | IFrontmatterState;

// Discriminated-union type guards. `TState` is keyed by `name`, so consumers can
// narrow without `as I<X>State` casts. Use `isStateOfName(state, 'atx-heading')`
// for ad-hoc narrowing or the per-name shorthands.
export function isStateOfName<N extends TState['name']>(
    state: TState,
    name: N,
): state is Extract<TState, { name: N }> {
    return state.name === name;
}

export const isParagraphState = (s: TState): s is IParagraphState => s.name === 'paragraph';
export const isAtxHeadingState = (s: TState): s is IAtxHeadingState => s.name === 'atx-heading';
export const isSetextHeadingState = (s: TState): s is ISetextHeadingState => s.name === 'setext-heading';
export const isThematicBreakState = (s: TState): s is IThematicBreakState => s.name === 'thematic-break';
export const isCodeBlockState = (s: TState): s is ICodeBlockState => s.name === 'code-block';
export const isHtmlBlockState = (s: TState): s is IHtmlBlockState => s.name === 'html-block';
export const isLinkReferenceDefinitionState = (s: TState): s is ILinkReferenceDefinitionState => s.name === 'link-reference-definition';
export const isMathBlockState = (s: TState): s is IMathBlockState => s.name === 'math-block';
export const isFrontmatterState = (s: TState): s is IFrontmatterState => s.name === 'frontmatter';
export const isDiagramState = (s: TState): s is IDiagramState => s.name === 'diagram';
export const isTableCellState = (s: TState): s is ITableCellState => s.name === 'table.cell';

export const isBlockQuoteState = (s: TState): s is IBlockQuoteState => s.name === 'block-quote';
export const isOrderListState = (s: TState): s is IOrderListState => s.name === 'order-list';
export const isBulletListState = (s: TState): s is IBulletListState => s.name === 'bullet-list';
export const isTableState = (s: TState): s is ITableState => s.name === 'table';
export const isTaskListState = (s: TState): s is ITaskListState => s.name === 'task-list';
export const isTaskListItemState = (s: TState): s is ITaskListItemState => s.name === 'task-list-item';
export const isListItemState = (s: TState): s is IListItemState => s.name === 'list-item';
export const isTableRowState = (s: TState): s is ITableRowState => s.name === 'table.row';
export const isFootnoteBlockState = (s: TState): s is IFootnoteBlockState => s.name === 'footnote';
export const isColumnsState = (s: TState): s is IColumnsState => s.name === 'columns';
export const isColumnState = (s: TState): s is IColumnState => s.name === 'column';

export function isAnyListState(s: TState): s is IOrderListState | IBulletListState | ITaskListState {
    return s.name === 'order-list' || s.name === 'bullet-list' || s.name === 'task-list';
}

export interface ITurnoverOptions {
    headingStyle: 'atx' | 'setext'; // setext or atx
    hr: '---';
    bulletListMarker: '-' | '+' | '*'; // -, +, or *
    codeBlockStyle: 'fenced' | 'indented'; // fenced or indented
    fence: '```' | '~~~'; // ``` or ~~~
    emDelimiter: '*' | '_'; // _ or *
    strongDelimiter: '**' | '__'; // ** or __
    linkStyle: 'inlined';
    linkReferenceStyle: 'full';
    blankReplacement: (content: unknown, node: unknown, options: unknown) => string;
}

/**
 * Opaque transaction attribution attached to a `json-change` by the host
 * adapter (sync-design D2). The engine forwards both fields verbatim and never
 * interprets them: `txnId` lets the adapter pair an EXTERNAL apply with the
 * transaction it queued beforehand, while `origin` names the surface that
 * produced the change (the adapter owns the origin vocabulary).
 */
export interface IChangeMeta {
    txnId?: string;
    origin?: string;
}
