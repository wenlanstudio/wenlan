import type { VNode } from 'snabbdom';
import type Format from '../../block/base/format';
import type { IRenderCursor } from '../../selection/types';
import type { H, HTMLTagToken, ImageToken, ISyntaxRenderOptions, Token } from '../types';
import type Renderer from './index';
import { BLOCK_TYPE6, CLASS_NAMES } from '../../config';
import { snakeToCamel } from '../../utils';
import { parseMarker } from '../../utils/columns/syntax';
import sanitize, { isValidAttribute } from '../../utils/dompurify';

/**
 * 注释 token 是否位于段落行首：段首，或其前一个 token 是 soft_line_break。
 * 与 `markdownToState` 的合并条件（注释紧贴段落）互为镜像 —— 合并后注释在
 * 段落 text 里总是独占一行，此处据此决定渲染徽标还是普通 raw html。
 */
function isAtLineStart(token: HTMLTagToken): boolean {
    const siblings = token.parent;
    const index = siblings.indexOf(token);
    if (index < 0)
        return false;

    return index === 0 || siblings[index - 1].type === 'soft_line_break';
}

function renderHtmlTagChildren(
    renderer: Renderer,
    h: H,
    cursor: IRenderCursor,
    block: Format,
    token: HTMLTagToken,
): VNode[] | '' {
    const { tag, children } = token;

    return Array.isArray(children) && children.length && tag !== 'ruby' // important
        ? children.reduce((acc: VNode[], to: Token) => {
                // The original passed a `className` field here too, but
                // receivers read `outerClass` — so the field was
                // silently dropped under the previous `as any` cast.
                // Preserve that runtime behavior: don't propagate it.
                const chunk = renderer.dispatch(snakeToCamel(to.type), {
                    h,
                    cursor,
                    block,
                    token: to,
                });

                return Array.isArray(chunk) ? [...acc, ...chunk] : [...acc, chunk];
            }, [])
        : '';
}

function buildRawHtmlTag(
    token: HTMLTagToken,
    tagClassName: string,
    openContent: (string | VNode)[],
    closeContent: (string | VNode)[] | '',
    anchor: VNode[] | '',
    h: H,
): VNode[] {
    const { tag, attrs } = token;
    const { start, end } = token.range;

    // if  tag is a block level element, use a inline element `span` to instead.
    // Because we can not nest a block level element in span element(line is span element)
    // we also recommend user not use block level element in paragraph. use block element in html block.
    // Use code !sanitize(`<${tag}>`) to filter some malicious tags. for example: <embed>.
    let selector
        = BLOCK_TYPE6.includes(tag) || !sanitize(`<${tag}>`) ? 'span' : tag;
    selector += `.${CLASS_NAMES.MU_INLINE_RULE}.${CLASS_NAMES.MU_RAW_HTML}`;
    const data = {
        attrs: {} as Record<string, string>,
        dataset: {
            start: String(start),
            end: String(end),
            raw: token.raw,
        },
    };

    // Disable spell checking for these tags
    if (tag === 'code' || tag === 'kbd')
        Object.assign(data.attrs, { spellcheck: 'false' });

    // Not in the selector: its parser truncates an id at `.`, `/` or a space (#5419).
    if (attrs.id)
        data.attrs.id = attrs.id;

    if (attrs.class && /\S/.test(attrs.class)) {
        const classNames = attrs.class.split(/\s+/);

        for (const className of classNames)
            selector += `.${className}`;
    }

    for (const attr of Object.keys(attrs)) {
        if (attr !== 'id' && attr !== 'class') {
            const attrData = attrs[attr];
            if (attrData && isValidAttribute(tag, attr, attrData))
                data.attrs[attr] = attrData;
        }
    }

    return [
        h(
            `span.${tagClassName}.${CLASS_NAMES.MU_OUTPUT_REMOVE}`,
            {
                attrs: {
                    spellcheck: 'false',
                },
            },
            openContent,
        ),
        h(`${selector}`, data, anchor),
        h(
            `span.${tagClassName}.${CLASS_NAMES.MU_OUTPUT_REMOVE}`,
            {
                attrs: {
                    spellcheck: 'false',
                },
            },
            closeContent,
        ),
    ];
}

export default function htmlTag(
    this: Renderer,
    {
        h,
        cursor,
        block,
        token,
        outerClass,
    }: ISyntaxRenderOptions & { token: HTMLTagToken },
) {
    const { tag, openTag, closeTag, children } = token;

    // 分栏标记行内徽标（§4.6）：marker 注释独占段落行（段首或其前是
    // soft_line_break）时渲染为段尾徽标。该条件与 markdownToState 的合并
    // 条件互洽 —— 只有源码里独占一行的注释才会进入段落 text 的行首位置，
    // 「显示徽标 ⟷ 导出时分栏生效」因此同构；同行手打的注释走下面的普通
    // 渲染（§1.3 #7，不参与分栏）。MU_OUTPUT_REMOVE 让剪贴板 HTML 不泄漏
    // 徽标 DOM（真实文本由状态层的段落 text 保真）。
    const columnMarker = parseMarker(openTag);
    if (columnMarker && isAtLineStart(token)) {
        return [
            h(
                `span.${CLASS_NAMES.MU_INLINE_RULE}.${CLASS_NAMES.MU_OUTPUT_REMOVE}.mu-mdcols-marker.mu-mdcols-inline.mu-mdcols-${columnMarker.kind}`,
                {
                    attrs: {
                        'spellcheck': 'false',
                        'data-kind': columnMarker.kind,
                        // 栏宽占比原文，columns 视图据此恢复各栏 flex-grow（§4.6）。
                        ...(columnMarker.ratioText ? { 'data-ratio': columnMarker.ratioText } : {}),
                    },
                },
            ),
        ];
    }

    // `<br>` is a void tag, but its marker still hides with the cursor.
    const className = children?.length || tag === 'br'
        ? this.getClassName(outerClass, block, token, cursor)
        : CLASS_NAMES.MU_GRAY;
    const tagClassName
        = className === CLASS_NAMES.MU_HIDE ? className : CLASS_NAMES.MU_HTML_TAG;
    const { start, end } = token.range;
    const openContent = this.highlight(
        h,
        block,
        start,
        start + openTag.length,
        token,
    );
    const closeContent = closeTag
        ? this.highlight(h, block, end - closeTag.length, end, token)
        : '';

    const anchor = renderHtmlTagChildren(this, h, cursor, block, token);

    switch (tag) {
        case 'img': {
            // eslint-disable-next-line no-restricted-syntax
            return this.image({ h, cursor, block, token: token as unknown as ImageToken, outerClass });
        }

        case 'br': {
            // Keep the real `<br>` outside the marker so hiding the marker keeps the line break.
            return [
                h(`span.${CLASS_NAMES.MU_HTML_TAG}`, [
                    h(
                        `span.${tagClassName}.${CLASS_NAMES.MU_OUTPUT_REMOVE}`,
                        {
                            attrs: {
                                spellcheck: 'false',
                            },
                        },
                        openContent,
                    ),
                    h(tag),
                ]),
            ];
        }

        default:
            // handle void html tag
            if (!closeTag) {
                return [h(`span.${CLASS_NAMES.MU_HTML_TAG}`, openContent)];
            }
            else if (tag === 'ruby') {
                return this.htmlRuby({
                    h,
                    cursor,
                    block,
                    token,
                    outerClass,
                });
            }
            else {
                return buildRawHtmlTag(
                    token,
                    tagClassName,
                    openContent,
                    closeContent,
                    anchor,
                    h,
                );
            }
    }
}
