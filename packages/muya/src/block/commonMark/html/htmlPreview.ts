import type { Muya } from '../../../muya';
import type { IHtmlBlockState, TState } from '../../../state/types';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import { parseMarker } from '../../../utils/columns/syntax';
import { getImageSrc } from '../../../utils/image';
import logger from '../../../utils/logger';
import { isPagebreakMarker } from '../../../utils/markers/pagebreak';
import Parent from '../../base/parent';

const debug = logger('htmlPreview:');

// Elements whose rendered content comes from attributes (e.g. `src`) rather
// than child nodes, so an empty tag body must not be treated as an empty block.
const SELF_CONTAINED_MEDIA = new Set(['video', 'audio']);

// A single element with an empty body (`<div></div>`), except self-contained
// media elements whose content lives in attributes (`<video src=...></video>`).
export function isEmptyHtmlBlock(html: string): boolean {
    // eslint-disable-next-line regexp/no-super-linear-backtracking, regexp/optimal-quantifier-concatenation
    const match = html.trim().match(/^<([a-z][a-z\d]*)[^>]*>\s*<\/\1>$/);
    return !!match && !SELF_CONTAINED_MEDIA.has(match[1]);
}

class HTMLPreview extends Parent {
    private _html: string;

    // 点击块级徽标 → 激活 html-block 的源码编辑。html-preview 是
    // contenteditable=false 附件，点击默认不会把焦点送进 html-container；
    // 块级徽标不依附段落、没有行内徽标那样的选中 / 删除路径，点击激活是它
    // 唯一的编辑入口（§4.6）。监听绑在 domNode 上——update() 每次重建
    // innerHTML，绑在徽标元素上会随重建丢失。
    private _handleBadgeClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('.mu-mdcols-marker'))
            return;

        const htmlBlock = this.parent;
        if (!htmlBlock)
            return;

        htmlBlock.active = true;
        const content = htmlBlock.firstContentInDescendant();
        if (content) {
            // 光标落在注释原文末尾——`begin 30:70` 的占比就在那里改。
            content.setCursor(content.text.length, content.text.length, true);
            content.domNode?.focus();
        }
    };

    static override blockName = 'html-preview';

    static create(muya: Muya, state: IHtmlBlockState) {
        const htmlBlock = new HTMLPreview(muya, state);

        return htmlBlock;
    }

    override get path() {
        debug.warn('You can never call `get path` in htmlPreview');
        return [];
    }

    constructor(muya: Muya, { text }: IHtmlBlockState) {
        super(muya);
        this.tagName = 'div';
        this._html = text;
        this.classList = [CLASS_NAMES.MU_HTML_PREVIEW];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this.domNode!.addEventListener('click', this._handleBadgeClick);
        this.update();
    }

    update(html = this._html) {
        if (this._html !== html)
            this._html = html;

        const { disableHtml } = this.muya.options;
        const htmlContent = sanitize(html, PREVIEW_DOMPURIFY_CONFIG, disableHtml) as string;

        // handle empty html bock
        if (isEmptyHtmlBlock(htmlContent)) {
            this.domNode!.innerHTML
                = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt;Empty HTML Block&gt;</div>`;
        }
        else {
            // Editing-only visualization (§4.6): a marker that did NOT get
            // inlined into a paragraph (blank line before it, or the previous
            // block is a heading / list) renders the SAME badge as the inline
            // form — one visual form for markers, whichever way they are
            // written. Clicking it activates the block's source editing (see
            // `_handleBadgeClick`). `data-kind` / `data-ratio` carry what the
            // badge is about; the Columns view hides the badge, because there
            // the column boundary is the layout itself.
            const marker = parseMarker(html);
            if (marker) {
                const ratioAttr = marker.ratioText ? ` data-ratio="${marker.ratioText}"` : '';
                this.domNode!.innerHTML
                    = `<span class="mu-mdcols-marker mu-mdcols-inline mu-mdcols-${marker.kind}" data-kind="${marker.kind}"${ratioAttr}></span>`;
                return;
            }

            // `<!-- pagebreak -->` — paper-leaf forced page break, a sibling of
            // the column marker family. Same badge affordance (click to edit
            // the comment); desktop's paper pagination reads this badge as a
            // forced seam and the print chain turns it into a page break.
            if (isPagebreakMarker(html)) {
                this.domNode!.innerHTML
                    = '<span class="mu-mdcols-marker mu-mdcols-inline mu-mdcols-pagebreak" data-kind="pagebreak"></span>';
                return;
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            const imgs = doc.documentElement.querySelectorAll('img');

            for (const img of imgs) {
                const src = img.getAttribute('src')!;
                const imageSrc = getImageSrc(src);
                img.setAttribute('src', imageSrc.src);
            }

            this.domNode!.innerHTML
                = doc.documentElement!.querySelector('body')!.innerHTML;
        }
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in htmlPreview');
        return {} as TState;
    }
}

export default HTMLPreview;
