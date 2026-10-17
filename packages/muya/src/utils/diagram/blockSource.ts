/**
 * The configuration blocks Typora popularised — and the ones people paste into
 * documents after writing them there — are JavaScript fragments, not JSON:
 *
 * ```chart
 * // ==BlockCodeConfig==
 * // @height           300px
 * // @backgroundColor  transparent
 * // ==/BlockCodeConfig==
 *
 * config = { type: "bar", data: { ... } }
 * ```
 *
 * Handing that to `JSON.parse` verbatim is what made every one of those blocks
 * render as `< Invalid Diagram Code >`, while the line-oriented types beside
 * them (PlantUML, ABC) were fine. Read them here first: lift the display
 * options out of the header, drop the comments and the assignment, and accept
 * the trailing commas people leave in a hand-edited config.
 */

/** Lower-cased `@`-options from the block config header. */
export type TBlockOptions = Readonly<Record<string, string>>;

export interface IBlockSkeleton {
    options: TBlockOptions;
    /** The code once the header and comment lines are gone. */
    body: string;
}

export interface IParsedBlock<T> {
    options: TBlockOptions;
    value: T;
}

const CONFIG_OPEN = '==BlockCodeConfig==';
const CONFIG_CLOSE = '==/BlockCodeConfig==';

/** A trailing `x = ` in front of the object literal: `option = { ... }`. */
const ASSIGNMENT = /^\s*(?:(?:const|let|var)\s+[\w$]+|[\w$]+(?:\.[\w$]+)*)\s*=(?!=)/;

function leadingComment(line: string): string | null {
    const trimmed = line.trim();

    return trimmed.startsWith('//') ? trimmed.slice(2).trim() : null;
}

/** How far past a quoted run `start` points at, escapes included. */
function skipString(src: string, start: number): number {
    const quote = src[start];
    let i = start + 1;
    while (i < src.length) {
        if (src[i] === '\\') {
            i += 2;
            continue;
        }
        if (src[i] === quote)
            return i + 1;
        i++;
    }
    return src.length;
}

/** A run of characters that can stand as an unquoted property name. */
const IDENTIFIER = /^[A-Z_$][\w$]*/i;

/** The nesting the walk is in, so `,` knows whether it separates keys or values. */
type TContainer = 'object' | 'array';

interface IScanState {
    stack: TContainer[];
    /** Index in the output of a comma awaiting its verdict: trailing, or not. */
    comma: number;
    expectKey: boolean;
}

/**
 * Track what a structural character did to the walk, and rewrite the output
 * where that needs it. Anything else is literal enough to copy through.
 */
function trackStructure(ch: string, state: IScanState, out: string[]): void {
    switch (ch) {
        case '{':
            state.stack.push('object');
            state.expectKey = true;
            state.comma = -1;
            break;

        case '[':
            state.stack.push('array');
            state.expectKey = false;
            state.comma = -1;
            break;

        case '}':
        case ']':
            // No element followed the comma, so it is trailing — JSON has no room for it.
            if (state.comma !== -1) {
                out.splice(state.comma, 1);
                state.comma = -1;
            }
            state.stack.pop();
            state.expectKey = false;
            break;

        case ':':
            state.expectKey = false;
            state.comma = -1;
            break;

        case ',':
            state.comma = out.length - 1;
            state.expectKey = state.stack[state.stack.length - 1] === 'object';
            break;

        default:
            if (!/\s/.test(ch))
                state.comma = -1;
    }
}

/**
 * Rewrite what is legal in a JavaScript object literal and illegal in JSON, so
 * a config copied out of a document parses: comments, trailing commas, and
 * property names without quotes.
 *
 * Walks the source instead of pattern-matching it, because a URL such as
 * `http://cdn.example/a.drawio` carries both a `//` and characters that look
 * like the end of a comment. What it does not accept is behaviour — no
 * computed values, no spread, no functions. Those stay unsupported rather than
 * being eval'd, since the CSP MarkText ships forbids eval anyway; such a block
 * reports a syntax error naming the offending line.
 */
function relaxJson(src: string): string {
    const out: string[] = [];
    const state: IScanState = { stack: [], comma: -1, expectKey: false };
    let i = 0;

    while (i < src.length) {
        const ch = src[i];

        if (ch === '"' || ch === '\'') {
            const end = skipString(src, i);
            out.push(src.slice(i, end));
            i = end;
            state.comma = -1;
            continue;
        }

        if (ch === '/' && src[i + 1] === '/') {
            while (i < src.length && src[i] !== '\n')
                i++;
            continue;
        }

        if (ch === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end === -1 ? src.length : end + 2;
            continue;
        }

        const name = state.expectKey ? IDENTIFIER.exec(src.slice(i))?.[0] : undefined;
        if (name) {
            out.push(`"${name}"`);
            i += name.length;
            state.expectKey = false;
            state.comma = -1;
            continue;
        }

        out.push(ch);
        i++;
        trackStructure(ch, state, out);
    }

    return out.join('');
}

/**
 * Split a block into its display options and the code it actually holds.
 *
 * `//` only opens a comment at the start of a line: anything else would eat
 * the `//` of every URL in the config.
 */
export function parseDiagramBlock(code: string): IBlockSkeleton {
    const options: Record<string, string> = {};
    const lines: string[] = [];
    let inConfig = false;

    for (const rawLine of code.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        const comment = leadingComment(line);

        if (comment !== null) {
            if (comment === CONFIG_OPEN) {
                inConfig = true;
            }
            else if (comment === CONFIG_CLOSE) {
                inConfig = false;
            }
            else if (inConfig && comment.startsWith('@')) {
                const [key, ...rest] = comment.slice(1).trim().split(/\s+/);
                if (key)
                    options[key.toLowerCase()] = rest.join(' ').trim();
            }
            continue;
        }

        // A header whose closing marker went missing ends at the first line
        // that is real code, so the block does not lose its whole body to it.
        if (inConfig)
            inConfig = false;

        lines.push(line);
    }

    return { options, body: lines.join('\n').trim() };
}

/** Drop a leading `x = ` so what is left is the value itself. */
export function stripAssignment(src: string): string {
    return src.replace(ASSIGNMENT, '').trim();
}

/**
 * Read a chart block: its options, and the object literal it evaluates to.
 *
 * @throws SyntaxError when there is no object there to read — the caller turns
 * that into the `< Invalid Diagram Code >` notice naming the diagram type.
 */
export function parseJsonBlock<T = Record<string, unknown>>(code: string): IParsedBlock<T> {
    const { options, body } = parseDiagramBlock(code);
    const value = JSON.parse(relaxJson(stripAssignment(body))) as T;

    return { options, value };
}

/**
 * Read out a `@width`/`@height` of the form `300px`, for a renderer that needs
 * a number rather than a CSS length. Returns null for anything else, including
 * the `auto` the blocks default to.
 */
export function pixelSize(value: string | undefined): number | null {
    const match = /^([\d.]+)px$/.exec(value ?? '');

    return match ? Number.parseFloat(match[1]) : null;
}

const JUSTIFY: Readonly<Record<string, string>> = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
};

/**
 * Put the block config header's display options on the preview container,
 * which is the whole reason people write them.
 */
export function applyBlockStyle(target: HTMLElement, options: TBlockOptions): void {
    for (const key of ['width', 'height']) {
        const value = options[key];
        if (value && value !== 'auto')
            target.style.setProperty(key, value);
    }

    const backgroundColor = options.backgroundcolor;
    if (backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'auto')
        target.style.backgroundColor = backgroundColor;

    const justify = JUSTIFY[options.align ?? ''];
    if (justify) {
        target.style.display = 'flex';
        target.style.justifyContent = justify;
    }
}
