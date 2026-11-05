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

// Rendered HTML keeps its native controls (#5): <summary> toggles its
// <details>, links are handled by linkMouseEvents, media/form controls must
// stay usable. Any other click lands on rendered content and opens the block
// source for editing.
const NATIVE_INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'label',
    'option',
    'video',
    'audio',
    'iframe',
    'embed',
    'object',
    'area',
].join(',');

// A single element with an empty body (`<div></div>`), except self-contained
// media elements whose content lives in attributes (`<video src=...></video>`).
export function isEmptyHtmlBlock(html: string): boolean {
    // eslint-disable-next-line regexp/no-super-linear-backtracking, regexp/optimal-quantifier-concatenation
    const match = html.trim().match(/^<([a-z][a-z\d]*)[^>]*>\s*<\/\1>$/);
    return !!match && !SELF_CONTAINED_MEDIA.has(match[1]);
}

class HTMLPreview extends Parent {
    private _html: string;

    // html-preview 是 contenteditable=false 附件，点击默认不会把焦点送进
    // html-container。块级徽标（§4.6）与渲染内容都靠这里的委托点击进入源码
    // 编辑；监听绑在 domNode 上——update() 每次重建 innerHTML，绑在子元素上
    // 会随重建丢失。
    private _isNativeInteractive(target: Element): boolean {
        // <summary> 是 <details> 的块级开关：点它（或点折叠态整个块，此时只有
        // summary 可见）必须保留原生展开 / 折叠。展开后点击露出的正文，target
        // 是 <details> 本身，会落到下面的源码编辑分支。
        if (target.closest('summary'))
            return true;

        const details = target.closest('details');
        if (details && !details.hasAttribute('open'))
            return true;

        // closest() 会一路走到编辑器根（contenteditable=true 的容器），所以
        // 只认预览子树内的原生控件。
        const interactive = target.closest(NATIVE_INTERACTIVE_SELECTOR);
        return !!interactive && !!this.domNode?.contains(interactive);
    }

    private _activateSourceEditor(): boolean {
        const htmlBlock = this.parent;
        if (!htmlBlock)
            return false;

        htmlBlock.active = true;
        const content = htmlBlock.firstContentInDescendant();
        if (content) {
            // 预览 DOM 与源码文本之间没有位置映射，做不到点哪落哪；统一落在
            // 源码末尾，整个 <details>…</details> 都在这个可编辑块里。
            content.setCursor(content.text.length, content.text.length, true);
            content.domNode?.focus();
        }
        return true;
    }

    private _handlePreviewClick = (event: MouseEvent) => {
        // 只读投影（栏 / 页 / 览 / 示）复用同一套预览渲染，不能进编辑。
        if (this.muya.options.readOnly)
            return;

        const target = event.target as HTMLElement | null;
        if (!target)
            return;

        // 徽标是纯编辑 affordance，没有原生行为，永远进源码。
        const isBadge = !!target.closest('.mu-mdcols-marker');
        if (!isBadge && this._isNativeInteractive(target))
            return;

        if (!this._activateSourceEditor())
            return;

        event.preventDefault();
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
        this.domNode!.addEventListener('click', this._handlePreviewClick);
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
