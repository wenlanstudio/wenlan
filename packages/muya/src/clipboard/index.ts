import type { Muya } from '../muya';
import type { Nullable } from '../types';
import type { IClipboardPayload } from './copyData';
import Format from '../block/base/format';
import { classifyInputKind } from '../history';
import { isClipboardEvent, isInputEvent, isKeyboardEvent } from '../utils';
import { isSelectionInReadOnlyIsland } from '../utils/dom';
import { getClipboardData, writeClipboardData } from './copyData';
import { cutSelection, deleteTableSelection, insertTextAtCursor } from './cut';
import { pastePlainText, pasteSelection } from './paste';
import { pasteImageSrc } from './pasteImage';
import { CopyType, PasteType } from './types';

// After the table/same-block guards, decide whether a keydown over a
// cross-block selection should cut (replace) the selected text. Non-editing
// keys and any modifier combo must NOT cut — in particular Ctrl+<key> (e.g.
// Ctrl+C copy on Windows/Linux), which was previously not excluded and
// silently deleted the selection (#3491). Mirrors the macOS metaKey guard.
export function shouldCrossBlockCut(key: string, metaKey: boolean, ctrlKey: boolean): boolean {
    if (/Alt|Option|Meta|Shift|CapsLock|ArrowUp|ArrowDown|ArrowLeft|ArrowRight/.test(key))
        return false;

    if (metaKey || ctrlKey)
        return false;

    return true;
}

const FOREIGN_INPUT_TYPES = new Set([
    'deleteByCut',
    'deleteByDrag',
    'deleteCompositionText',
    'insertCompositionText',
    'insertFromDrop',
    'insertFromPaste',
    'insertFromPasteAsQuotation',
    'insertLineBreak',
    'insertParagraph',
]);

export function crossBlockReplacement(inputType: string, data: Nullable<string>): Nullable<string> {
    if (FOREIGN_INPUT_TYPES.has(inputType))
        return null;

    switch (classifyInputKind(inputType)) {
        case 'delete':
            return '';
        case 'insert':
            return data ?? '';
        default:
            return null;
    }
}

class Clipboard {
    public copyType: CopyType = CopyType.NORMAL;
    public pasteType: PasteType = PasteType.NORMAL;
    public copyInfo: string = '';

    get selection() {
        return this.muya.editor.selection;
    }

    get scrollPage() {
        return this.muya.editor.scrollPage;
    }

    static create(muya: Muya) {
        const clipboard = new Clipboard(muya);
        clipboard._listen();

        return clipboard;
    }

    constructor(public muya: Muya) {}

    private _listen() {
        const ownsEvent = () => this.muya.hasFocus();
        // Copy stays available on a locked document; every mutating path here
        // (cross-block cut, table deletion, paste) must not run.
        const editable = () => !this.muya.options.readOnly;

        const copyCutHandler = (event: Event) => this.copyCutHandler(event);

        const keydownHandler = (event: Event) => {
            if (!ownsEvent() || !isKeyboardEvent(event) || !editable())
                return;
            const { key, metaKey } = event;

            if (this.selection.table.hasSelection) {
                if (!metaKey && (key === 'Backspace' || key === 'Delete')) {
                    event.preventDefault();
                    deleteTableSelection(this);
                }
                return;
            }

            const { isSelectionInSameBlock } = this.selection.getSelection() ?? {};
            if (isSelectionInSameBlock)
                return;

            if (!shouldCrossBlockCut(key, metaKey, event.ctrlKey))
                return;

            // Enter over a cross-block selection: suppress the corrupting native
            // Enter and mirror the same-block path — delete then split (#2443).
            if (key === 'Enter') {
                event.preventDefault();
                this.cutHandler();
                const block = this.muya.editor.activeContentBlock;
                if (!event.shiftKey && block instanceof Format)
                    block.enterHandler(event);
                return;
            }

            if (key === 'Backspace' || key === 'Delete')
                event.preventDefault();

            this.cutHandler();
        };

        const beforeInputHandler = (event: Event) => {
            if (!ownsEvent() || !isInputEvent(event) || !event.cancelable || !editable())
                return;

            const replacement = crossBlockReplacement(event.inputType, event.data);
            if (replacement == null || document.getSelection()?.isCollapsed !== false)
                return;

            if (this.selection.getSelection()?.isSelectionInSameBlock !== false)
                return;

            event.preventDefault();
            this.cutHandler();

            if (replacement)
                insertTextAtCursor(this, replacement);
        };

        const pasteHandler = (event: Event) => {
            if (ownsEvent() && isClipboardEvent(event))
                this.pasteHandler(event);
        };

        const { eventCenter } = this.muya;

        eventCenter.attachDOMEvent(document, 'copy', copyCutHandler);
        eventCenter.attachDOMEvent(document, 'cut', copyCutHandler);
        eventCenter.attachDOMEvent(document, 'paste', pasteHandler);
        eventCenter.attachDOMEvent(document, 'keydown', keydownHandler);
        eventCenter.attachDOMEvent(document, 'beforeinput', beforeInputHandler);
    }

    /**
     * Whether the reader is copying text out of a rendered preview rather than
     * out of the document. See `copyCutHandler` — such a selection has no
     * blocks behind it, so muya must not claim the clipboard event.
     */
    isSelectionInPreview(): boolean {
        const root = this.muya.domNode;
        if (!root)
            return false;

        return isSelectionInReadOnlyIsland(root);
    }

    copyCutHandler(event: Event): void {
        if (!this.muya.hasFocus() || !isClipboardEvent(event))
            return;

        // A rendered preview (diagram / math / html) is a
        // `contenteditable=false` island: the reader can select its text —
        // which is the only way to copy a renderer error out of it — but the
        // document model has nothing there to serialise, so muya would write
        // an empty clipboard over the selection. Leave these to the browser,
        // which copies exactly what is highlighted.
        if (this.isSelectionInPreview()) {
            // Cutting must still not try to delete read-only content.
            if (event.type === 'cut') {
                event.preventDefault();
                document.execCommand('copy');
            }
            return;
        }

        // Read-only lock: cutting is a mutation — serve it as a plain copy so
        // the clipboard still receives the selection but nothing is deleted.
        if (event.type === 'cut' && this.muya.options.readOnly) {
            event.preventDefault();
            this.copyHandler(event);
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const isCut = event.type === 'cut';

        this.copyHandler(event);

        if (isCut)
            this.cutHandler();
    }

    getClipboardData(): IClipboardPayload {
        return getClipboardData(this);
    }

    copyHandler(event: ClipboardEvent): void {
        writeClipboardData(this, event);
    }

    cutHandler(): void {
        cutSelection(this);
    }

    pasteHandler(
        event: ClipboardEvent,
        rawText?: string,
        rawHtml?: string,
    ): Promise<void> {
        // Read-only lock: paste inserts content — a mutation, never allowed.
        if (this.muya.options.readOnly) {
            event.preventDefault();
            return Promise.resolve();
        }

        return pasteSelection(this, event, rawText, rawHtml);
    }

    copyAsMarkdown() {
        this.copyType = CopyType.COPY_AS_MARKDOWN;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    copyAsHtml() {
        this.copyType = CopyType.COPY_AS_HTML;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    copyAsRich() {
        this.copyType = CopyType.COPY_AS_RICH;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }

    // Chromium removed programmatic clipboard reads via
    // `document.execCommand('paste')` — it returns false and fires no paste
    // event, so the old flag + execCommand approach pasted nothing. Read the
    // clipboard text ourselves and feed it through the paste pipeline.
    async pasteAsPlainText(): Promise<void> {
        if (this.muya.options.readOnly)
            return Promise.resolve();

        const text = await this._readClipboardText();
        if (text)
            await pastePlainText(this, text);
    }

    // Insert an image at the cursor from an explicit `src` (a saved file path or
    // `data:` URL), routing through `imageAction` like a clipboard image paste.
    // Drives the macOS screenshot flow, which can no longer use the removed
    // `document.execCommand('paste')`.
    pasteImage(src: string): Promise<void> {
        return pasteImageSrc(this, src);
    }

    private async _readClipboardText(): Promise<string> {
        // Sandboxed Electron renderers can't reach the system clipboard
        // directly, so the embedder supplies a reader (e.g. an IPC bridge to
        // Electron's native `clipboard`). Fall back to the async Clipboard API
        // for standalone (browser) use.
        const reader = this.muya.options.clipboardText;
        if (typeof reader === 'function') {
            try {
                return await reader();
            }
            catch {
                return '';
            }
        }

        if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
            try {
                return await navigator.clipboard.readText();
            }
            catch {
                return '';
            }
        }

        return '';
    }

    copy(type: CopyType, info: string) {
        this.copyType = type;
        this.copyInfo = info;
        document.execCommand('copy');
        this.copyType = CopyType.NORMAL;
    }
}

export default Clipboard;
