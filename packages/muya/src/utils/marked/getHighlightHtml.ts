import type { ILexOption } from './types';
import type { Token } from 'marked';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import Prism from 'prismjs';
import { diagramLangs } from '../diagram/fence';
import { transformColumnTokens } from '../columns/syntax';
import type { StructToken } from '../columns/syntax';
import cjkEmStrongExtension from './extensions/cjkEmStrong';
import emojiExtension from './extensions/emoji';
import footnoteExtension from './extensions/footnote';
import inlineDiffExtension from './extensions/inlineDiff';
import markExtension from './extensions/mark';
import mathExtension, { doubleBackslashMathExtension, gfmMathExtension, singleBackslashMathExtension } from './extensions/math';
import multilineBlockquoteExtension from './extensions/multilineBlockquote';
import superSubScriptExtension from './extensions/superSubscript';
import fm, { frontMatterRender } from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import walkTokens from './walkTokens';

const DIAGRAM_TYPE = diagramLangs();

function highlight(code: string, lang: string) {
    // Language may be undefined (GH#591)
    if (!lang)
        return code;

    if (DIAGRAM_TYPE.includes(lang))
        return code;

    const grammar = Prism.languages[lang];
    if (!grammar) {
        console.warn(`Unable to find grammar for "${lang}".`);
        return code;
    }
    return Prism.highlight(code, grammar, lang);
}

export function getHighlightHtml(src: string, options: ILexOption = {}) {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const { footnote, frontMatter, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, superSubScript, highlightSyntax, inlineDiff, multilineBlockquote, columns }
        = options;

    // Build a fresh Marked instance per call. `Marked.use({ walkTokens })`
    // chains rather than replaces, so reusing a module-level singleton would
    // cause walkTokens to fire N times after N invocations and corrupt token
    // state (e.g. wiping `lang` on subsequent runs).
    const marked = new Marked(markedHighlight({ highlight }));

    marked.use({
        walkTokens: walkTokens({ texMathDollars, texMathGfm }),
    });

    // Treat CJK characters as punctuation for emphasis/strong flanking so
    // `中文**"加粗"**中文` bolds (marktext/marktext#4307). Additive override —
    // never regresses spec-conformant Latin emphasis.
    marked.use(cjkEmStrongExtension());

    marked.use(emojiExtension({ isRenderEmoji: true }));

    if (texMathDollars) {
        marked.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathGfm) {
        marked.use(
            gfmMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathSingleBackslash) {
        marked.use(
            singleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathDoubleBackslash) {
        marked.use(
            doubleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (superSubScript)
        marked.use(superSubScriptExtension());

    if (highlightSyntax)
        marked.use(markExtension());

    if (inlineDiff)
        marked.use(inlineDiffExtension());

    marked.use(multilineBlockquoteExtension(multilineBlockquote === true));

    if (footnote)
        marked.use(footnoteExtension());

    // §3.1 — turn `<!-- begin / split / end -->` into placeholder elements
    // before DOMPurify strips them. Hooked at `processAllTokens`, which sits
    // between the lexer and `walkTokens` inside `marked.parse`, so this keeps
    // the whole parse pipeline intact: preprocess/postprocess hooks and
    // walkTokens still run (walkTokens is what turns ```math blocks into
    // multiplemath and tags heading styles). Doing lexer()+parser() by hand
    // would silently skip all of that.
    if (columns) {
        marked.use({
            hooks: {
                processAllTokens: (tokens: Token[]) =>
                    transformColumnTokens(tokens as unknown as StructToken[]) as unknown as Token[],
            },
        });
    }

    let html = '';

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            html = frontMatterRender(token);
            src = newSrc;
        }
    }

    html += marked.parse(src);

    return html;
}
