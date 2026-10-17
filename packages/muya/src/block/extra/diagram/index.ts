import type { Muya } from '../../../muya';
import type { IDiagramMeta, IDiagramState } from '../../../state/types';
import type { TBlockPath } from '../../types';
import diff from 'fast-diff';
import { diffToTextOp, firstWordOfInfo } from '../../../utils';
import { diagramGrammarOfType, diagramTypeOfLang } from '../../../utils/diagram/fence';
import { loadLanguage } from '../../../utils/prism';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';
import DiagramPreview from './diagramPreview';

const debug = logger('diagram:');

class DiagramBlock extends Parent {
    public meta: IDiagramMeta;
    static override blockName = 'diagram';

    static create(muya: Muya, state: IDiagramState) {
        const diagramBlock = new DiagramBlock(muya, state);
        const { lang } = state.meta;
        const diagramPreview = ScrollPage.loadBlock('diagram-preview').create(
            muya,
            state,
        );
        const diagramContainer = ScrollPage.loadBlock('diagram-container').create(
            muya,
            state,
        );
        // The fence language is as editable here as on a code block, so a
        // misdeclared diagram can be corrected without retyping its source. It
        // is an attachment, appended after the preview: generic code reads
        // `attachments.head` as the render preview, and keeping it out of
        // `children` leaves the code content as both the first and the last
        // content of the block, which caret navigation depends on.
        const langInput = ScrollPage.loadBlock('language-input').create(
            muya,
            state,
        );

        diagramBlock.appendAttachment(diagramPreview, langInput);
        diagramBlock.append(diagramContainer);

        !!lang
        && loadLanguage(lang)
            .then((infoList) => {
                if (!Array.isArray(infoList))
                    return;
                // There are three status `loaded`, `noexist` and `cached`.
                // if the status is `loaded`, indicated that it's a new loaded language
                const needRender = infoList.some(
                    ({ status }) => status === 'loaded' || status === 'cached',
                );
                if (needRender)
                    diagramBlock.firstContentInDescendant()?.update();
            })
            .catch((err) => {
                // if no parameter provided, will cause error.
                debug.warn(err);
            });

        return diagramBlock;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    /**
     * What the block serializes as: the fence language, which for a diagram is
     * its type (```mermaid). Not `meta.lang` — that is the grammar the source
     * is highlighted with, and the two only coincide by accident.
     */
    get lang() {
        return this.meta.type;
    }

    set lang(value) {
        const type = diagramTypeOfLang(firstWordOfInfo(value));
        // Typing a name walks through prefixes that name no diagram (`mer`,
        // `meri`); there is nothing to apply until one does. A marker that
        // names no diagram at all is what turns the block back into a code
        // block, and that happens on blur.
        if (!type || type === this.meta.type)
            return;

        const previous = this.meta.type;
        this.meta.type = type;
        this.jsonState.editOperation(
            [...this.path, 'meta', 'type'],
            diffToTextOp(diff(previous, type)),
        );

        // The source may now be another language — `mermaid` → `echarts` moves
        // yaml to json — so the highlighting has to follow.
        const grammar = diagramGrammarOfType(type);
        if (grammar !== this.meta.lang) {
            const grammarDiffs = diff(this.meta.lang, grammar);
            this.meta.lang = grammar;
            this.jsonState.editOperation(
                [...this.path, 'meta', 'lang'],
                diffToTextOp(grammarDiffs),
            );
            loadLanguage(grammar)
                .then(() => this.firstContentInDescendant()?.update())
                .catch((err) => debug.warn(err));
        }

        // The preview captured the type when it was built and cannot see this
        // change on its own.
        (this.attachments.head as unknown as DiagramPreview | null)?.setType(type);
    }

    constructor(muya: Muya, { meta }: IDiagramState) {
        super(muya);
        this.tagName = 'figure';
        this.meta = meta;
        this.classList = ['mu-diagram-block'];
        this.createDomNode();
    }

    queryBlock(path: TBlockPath) {
        return path.length && path[0] === 'text'
            ? this.firstContentInDescendant()
            : this;
    }

    override getState(): IDiagramState {
        const { meta } = this;
        const text = this.firstContentInDescendant()?.text;

        if (text == null)
            throw new Error('text is null when getState in diagram block.');

        return {
            name: 'diagram',
            text,
            meta,
        };
    }
}

export default DiagramBlock;
