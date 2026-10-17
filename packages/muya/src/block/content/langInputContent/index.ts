import type { Muya } from '../../../muya';
import type { IRenderCursor } from '../../../selection/types';
import type { ICodeBlockState, IDiagramState } from '../../../state/types';
import type CodeBlock from '../../commonMark/codeBlock';
import type DiagramBlock from '../../extra/diagram';
import { CLASS_NAMES } from '../../../config';
import emptyStates from '../../../config/emptyStates';
import { deepClone, firstWordOfInfo } from '../../../utils';
import { createDiagramState, diagramTypeOfLang } from '../../../utils/diagram/fence';
import Content from '../../base/content';
import { ScrollPage } from '../../scrollPage';
import { escapeLangInputInnerHtml } from './escape';

/**
 * A block whose fence language the marker edits: a code block, or a diagram.
 * Both carry a `lang` the input can commit, and both hold the code the caret
 * jumps to on Enter.
 */
type TLanguageInputHost = CodeBlock | DiagramBlock;

class LangInputContent extends Content {
    public override parent: TLanguageInputHost | null = null;

    static override blockName = 'language-input';

    static create(muya: Muya, state: ICodeBlockState | IDiagramState) {
        const content = new LangInputContent(muya, state);

        return content;
    }

    // A diagram serializes as ```<type>, so that is what its marker shows and
    // edits — `meta.lang` there is only the grammar the source highlights with.
    constructor(muya: Muya, state: ICodeBlockState | IDiagramState) {
        super(muya, state.name === 'diagram' ? state.meta.type : state.meta.lang);
        this.classList = [...this.classList, CLASS_NAMES.MU_LANGUAGE_INPUT];
        this.attributes.hint = muya.i18n.t('Input Language Identifier...');
        this.createDomNode();
    }

    override getAnchor() {
        return this.parent;
    }

    protected override get metaKey(): string | null {
        return this.parent?.blockName === 'diagram' ? 'type' : 'lang';
    }

    override update(_cursor?: IRenderCursor, highlights = []) {
        this.domNode!.innerHTML = escapeLangInputInnerHtml(this.text, highlights);
    }

    /**
     * Update this block lang and parent's lang, and show/hide language selector.
     * @param lang
     */
    private _updateLanguage(lang: string) {
        const { start, end } = this.getCursor()!;
        this.text = lang;
        this.parent!.lang = lang;
        const startOffset = Math.min(lang.length, start.offset);
        const endOffset = Math.min(lang.length, end.offset);
        this.setCursor(startOffset, endOffset, true);
        this.muya.eventCenter.emit('content-change', { block: this });
    }

    // Public entry for setting the language programmatically (e.g. pasting into
    // the language input), so the code block re-highlights and `parent.lang`
    // updates; the DOM input handlers use `_updateLanguage` directly.
    updateLanguage(lang: string): void {
        this._updateLanguage(lang);
    }

    override inputHandler() {
        const textContent = this.domNode!.textContent ?? '';
        // Store the whole info string; the language is derived as its first word
        // elsewhere (`firstWordOfInfo`). Previously this truncated at the first
        // whitespace, which dropped `title="x"` / Pandoc attributes on edit.
        this._updateLanguage(textContent);
    }

    override enterHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        const { parent } = this;
        parent!.lastContentInDescendant()?.setCursor(0, 0);
    }

    override blurHandler() {
        super.blurHandler();
        // Leaving the input commits the language. Deferred: blur runs inside
        // the editor's active-block setter, which the replacement's setCursor
        // would re-enter.
        Promise.resolve().then(() => this._convertBlockIfNeeded());
    }

    /**
     * Whether the marker's language and the kind of block carrying it agree.
     * Typing a name walks through prefixes that name no diagram (`mer`,
     * `meri`), so this only runs once the marker loses focus.
     */
    private _convertBlockIfNeeded() {
        const host = this.parent;
        // Detached before the microtask ran, e.g. the document was replaced.
        if (!host?.outMostBlock)
            return;

        const lang = firstWordOfInfo(this.text);
        const type = diagramTypeOfLang(lang);

        if (host.blockName === 'diagram')
            this._convertDiagramToCodeBlock(host as DiagramBlock, type, lang);
        else if (type)
            this._convertCodeBlockToDiagram(host as CodeBlock, type);
    }

    // A diagram language makes the block a diagram, as loading its ```lang
    // fence does (#5060).
    private _convertCodeBlockToDiagram(codeBlock: CodeBlock, type: NonNullable<ReturnType<typeof diagramTypeOfLang>>) {
        const code = codeBlock.lastContentInDescendant()!;
        const caretInCode = this.muya.editor.activeContentBlock === code;
        const diagramBlock = ScrollPage.loadBlock('diagram').create(
            this.muya,
            createDiagramState(type, code.text),
        );
        codeBlock.replaceWith(diagramBlock);

        if (caretInCode)
            diagramBlock.lastContentInDescendant()?.setCursor(0, 0, true);
    }

    // The mirror of the above: a diagram whose language no longer names one is
    // a code block again, keeping its source and the language just typed.
    private _convertDiagramToCodeBlock(
        diagramBlock: DiagramBlock,
        type: ReturnType<typeof diagramTypeOfLang>,
        lang: string,
    ) {
        if (type)
            return;

        const code = diagramBlock.firstContentInDescendant()!;
        const caretInMarker = this.muya.editor.activeContentBlock === this;
        const state = deepClone(emptyStates['code-block']);
        state.meta.lang = lang;
        state.text = code.text;

        const codeBlock = ScrollPage.loadBlock('code-block').create(this.muya, state);
        diagramBlock.replaceWith(codeBlock);

        if (caretInMarker) {
            // Stay in the marker, which now belongs to the code block.
            codeBlock.firstContentInDescendant()?.setCursor(lang.length, lang.length, true);
        }
        else if (this.muya.editor.activeContentBlock === code) {
            codeBlock.lastContentInDescendant()?.setCursor(0, 0, true);
        }
    }

    override backspaceHandler(event: Event) {
        const { start, end } = this.getCursor()!;
        const { text } = this;
        // The next if statement is used to fix Firefox compatibility issues
        if (start.offset === 1 && end.offset === 1 && text.length === 1) {
            event.preventDefault();
            const lang = '';
            this._updateLanguage(lang);
        }
        if (start.offset === 0 && end.offset === 0) {
            event.preventDefault();
            const cursorBlock = this.previousContentInContext();
            // The cursorBlock will be null, if the code block is the first block in doc.
            if (cursorBlock) {
                const offset = cursorBlock.text.length;
                cursorBlock.setCursor(offset, offset, true);
            }
        }
    }
}

export default LangInputContent;
