import type { Muya } from '../../../muya';
import type { IHtmlBlockState } from '../../../state/types';
import type { TBlockPath } from '../../types';
import { CLASS_NAMES } from '../../../config';
import { parseMarker } from '../../../utils/columns/syntax';
import { isPagebreakMarker } from '../../../utils/markers/pagebreak';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';

const PLAIN_COMMENT_CLASS = 'mu-html-plain';

/**
 * An HTML block whose source is ONLY comments has no rendered form at all.
 * Column markers and page breaks are excluded: they are functional markers
 * whose block-level badge is read by the columns view and paper pagination.
 */
export function isPlainCommentHtml(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith('<!--'))
        return false;

    if (parseMarker(trimmed) || isPagebreakMarker(trimmed))
        return false;

    // Strip every complete comment; anything left is real HTML content.
    return trimmed.replace(/<!--[\s\S]*?-->/g, '').trim().length === 0;
}

class HTMLBlock extends Parent {
    static override blockName = 'html-block';

    static create(muya: Muya, state: IHtmlBlockState) {
        const plain = isPlainCommentHtml(state.text);
        const htmlBlock = new HTMLBlock(muya, plain);

        // A comment-only block IS its source. The old model always built a
        // preview + a source container and switched between them with
        // `mu-active`: the preview was a zero-height island (later patched
        // into a chip), clicking it expanded a 0×0 container, and the caret
        // ended up on a node whose rect no longer matched the layout — which
        // is why focusing a comment scrolled the page. With no rendered form
        // there is no second state to switch to: build only the editable code
        // leaf and keep it inline and visible. State/path/serialization are
        // unchanged (html-block still owns `text`).
        if (!plain) {
            const htmlPreview = ScrollPage.loadBlock('html-preview').create(
                muya,
                state,
            );
            htmlBlock.appendAttachment(htmlPreview);
        }

        const htmlContainer = ScrollPage.loadBlock('html-container').create(
            muya,
            state,
            plain,
        );
        htmlBlock.append(htmlContainer);

        return htmlBlock;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    constructor(muya: Muya, plainComment = false) {
        super(muya);
        this.tagName = 'figure';
        this.classList = [CLASS_NAMES.MU_HTML_BLOCK];
        if (plainComment)
            this.classList.push(PLAIN_COMMENT_CLASS);

        const { disableHtml } = muya.options;
        if (disableHtml)
            this.classList.push(CLASS_NAMES.MU_DISABLE_HTML_RENDER);

        this.createDomNode();
    }

    queryBlock(path: TBlockPath) {
        return path.length && path[0] === 'text'
            ? this.firstContentInDescendant()
            : this;
    }

    override getState(): IHtmlBlockState {
        const state: IHtmlBlockState = {
            name: 'html-block',
            text: this.firstContentInDescendant()?.text ?? '',
        };

        return state;
    }
}

export default HTMLBlock;
