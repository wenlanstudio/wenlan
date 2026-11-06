import type { JSONOp, JSONOpComponent, JSONOpList } from 'ot-json1';
import type Content from '../block/base/content';
import type Format from '../block/base/format';
import type Parent from '../block/base/parent';
import type { Muya } from '../muya';
import type { IHistorySelection } from '../selection/types';
import type { IChangeMeta, TState } from '../state/types';
import type { Nullable } from '../types';
import * as otText from 'ot-text-unicode';
import { fromEvent, merge } from 'rxjs';
import { registerBlocks } from '../block';
import { ScrollPage } from '../block/scrollPage';
import Clipboard from '../clipboard';
import { CLASS_NAMES, EVENT_KEYS, isFirefox } from '../config';
import History from '../history';
import InlineRenderer from '../inlineRenderer';
import { Search } from '../search';
import Selection from '../selection';
import JSONState from '../state';
import { hasPick, isHTMLElement } from '../utils';
import { getBlock } from '../utils/dom';
import logger from '../utils/logger';
import { attachDragDropImageHandlers } from './dragDropImage';
import { attachLinkMouseHandlers } from './linkMouseEvents';

const debug = logger('editor:');

// The pick/drop walkers operate on live block-tree nodes (ScrollPage,
// Parent, Content). The tree's instance methods (queryBlock, find,
// insertBefore, etc.) are not all exposed on a single TS type, and
// ot-json1 op descents are dynamically shaped — so we type these as
// BlockNode (loose structural alias) inside the inner walkers and let
// the runtime branches do the actual narrowing.
type BlockNode = {
    queryBlock?: (path: (string | number)[]) => BlockNode | undefined;
    find?: (key: number | string) => BlockNode;
    remove?: (source: string) => void;
    replaceWith?: (newBlock: BlockNode, source: string) => void;
    insertBefore?: (newBlock: BlockNode, ref: BlockNode, source: string) => void;
    append?: (newBlock: BlockNode, source: string) => void;
    update?: (value?: unknown, source?: string) => void;
    blockName?: string;
    align?: string;
    _text?: string;
    text?: string;
    meta?: { lang?: string; type?: string };
    parent?: BlockNode;
} | undefined;

function descend(
    subDoc: BlockNode,
    descent: JSONOpList,
    stack: BlockNode[],
): { subDoc: BlockNode; i: number } {
    let i = 0;

    for (; i < descent.length; i++) {
        const d = descent[i];
        if (Array.isArray(d))
            break;
        if (typeof d === 'object')
            continue;
        stack.push(subDoc);
        // Its valid to descend into a null space - just we can't pick there.
        subDoc = subDoc == null ? undefined : subDoc.queryBlock?.([d]);
    }

    return { subDoc, i };
}

function restore(
    subDoc: BlockNode,
    descent: JSONOpList,
    stack: BlockNode[],
    i: number,
): BlockNode {
    // Then back again.
    for (--i; i >= 0; i--) {
        const d = descent[i];
        if (typeof d !== 'object') {
            const container = stack.pop();
            if (
                subDoc
                === (container == null ? undefined : container.queryBlock?.([d as string | number]))
            ) {
                subDoc = container;
            }
            else {
                if (subDoc === undefined) {
                    // TODO: handler typeof d === 'string'
                    if (typeof d === 'number')
                        container?.find?.(d)?.remove?.('api');
                    subDoc = container;
                }
                else {
                    if (typeof d === 'number')
                        container?.find?.(d)?.replaceWith?.(subDoc, 'api');
                    subDoc = container;
                }
            }
        }
        else if (!Array.isArray(d) && hasPick(d)) {
            subDoc = undefined;
        }
    }

    return subDoc;
}

// Phase 1: Pick. Returns updated subDocument.
function pick(subDoc: BlockNode, descent: JSONOpList): BlockNode {
    const stack: BlockNode[] = [];

    const descended = descend(subDoc, descent, stack);
    subDoc = descended.subDoc;
    const i = descended.i;

    // Children. These need to be traversed in reverse order here.
    for (let j = descent.length - 1; j >= i; j--)
        subDoc = pick(subDoc, descent[j] as JSONOpList);

    return restore(subDoc, descent, stack, i);
}

function drop(root: BlockNode, descent: JSONOpList, muya: Muya): BlockNode {
    let subDoc = root;
    let i = 0; // For reading
    let m = 0;
    const rootContainer: { root: BlockNode } = { root }; // This is an avoidable allocation.
    let container: BlockNode | { root: BlockNode } = rootContainer;
    let key: string | number = 'root'; // For writing

    function mut() {
        for (; m < i; m++) {
            const d = descent[m];
            if (typeof d === 'object')
                continue;
            if (key === 'root') {
                const wrap = container as { root: BlockNode };
                container = wrap.root;
            }
            else {
                container = (container as BlockNode)?.queryBlock?.([key]);
            }
            key = d as string | number;
        }
    }

    function applyInsert(comp: JSONOpComponent) {
        // Insert
        mut();
        const cur = container as BlockNode;
        const ref = cur?.find?.(key);
        if (typeof key === 'number') {
            const insertedState = comp.i as { name: string };
            const newBlock = ScrollPage.loadBlock(insertedState.name).create(muya, insertedState) as BlockNode;
            if (cur && newBlock) {
                if (ref)
                    cur.insertBefore?.(newBlock, ref, 'api');
                else
                    cur.append?.(newBlock, 'api');
            }

            subDoc = newBlock;
        }
        else {
            switch (key) {
                case 'checked': {
                    ref?.update?.(comp.i, 'api');
                    break;
                }

                case 'meta':
                    // Do nothing.
                    break;

                default:
                    debug.warn(`Unknown operation path ${key}`);
                    break;
            }
        }
    }

    function applyTextEdit(es: NonNullable<JSONOpComponent['es']>) {
        // Edit. Ok because its illegal to drop inside mixed region
        mut();
        const sd = subDoc!;
        if (sd.blockName === 'table.cell') {
            sd.align = otText.type.apply(sd.align ?? '', es) as string;
        }
        else if (sd.blockName === 'language-input') {
            sd._text = otText.type.apply(sd.text ?? '', es) as string;
            if (sd.parent?.meta)
                sd.parent.meta.lang = sd.text;
            sd.update?.();
        }
        else if (sd.blockName === 'code-block') {
            // Handle modify code block type.
            if (sd.meta)
                sd.meta.type = otText.type.apply(sd.meta.type ?? '', es) as string;
        }
        else {
            sd._text = otText.type.apply(sd.text ?? '', es) as string;
            sd.update?.();
        }
    }

    for (; i < descent.length; i++) {
        const d = descent[i];

        if (Array.isArray(d)) {
            const child = drop(subDoc, d, muya);
            if (child !== subDoc && child !== undefined) {
                mut();
                // It maybe never go into this if statement.
                if (key === 'root')
                    (container as { root: BlockNode }).root = child;
                else
                    (container as Record<string, BlockNode>)[key] = child;
                subDoc = child;
            }
        }
        else if (typeof d === 'object') {
            const comp = d as JSONOpComponent;
            if (comp.i !== undefined)
                applyInsert(comp);

            if (comp.es)
                applyTextEdit(comp.es);
        }
        else {
            subDoc = subDoc != null ? subDoc.queryBlock?.([d]) : undefined;
        }
    }

    return rootContainer.root;
}

export class Editor {
    jsonState: JSONState;
    inlineRenderer: InlineRenderer;
    selection: Selection;
    searchModule: Search;
    clipboard: Clipboard;
    history: History;
    scrollPage: Nullable<ScrollPage> = null;

    private _activeContentBlock: Nullable<Content> = null;

    constructor(private _muya: Muya) {
        const state = _muya.options.json || _muya.options.markdown || '';

        this.jsonState = new JSONState(_muya, state);
        this.inlineRenderer = new InlineRenderer(_muya);
        this.selection = new Selection(_muya);
        this.searchModule = new Search(_muya);
        this.clipboard = Clipboard.create(_muya);
        this.history = new History(_muya);
    }

    get activeContentBlock() {
        return this._activeContentBlock;
    }

    set activeContentBlock(block) {
        const { activeContentBlock: oldActiveContentBlock } = this;
        if (block !== oldActiveContentBlock) {
            this._activeContentBlock = block;
            if (oldActiveContentBlock)
                oldActiveContentBlock.blurHandler();

            if (block)
                block.focusHandler();
        }
    }

    init(options: { focus?: boolean } = {}) {
        registerBlocks();

        const muya = this._muya;
        const state = this.jsonState.getState();

        this.scrollPage = ScrollPage.create(muya, state);

        this._dispatchEvents();
        // Hovering a rendered link wrapper dispatches `muya-link-tools` so the
        // staged popover lights up. Cleanup is handled by `muya.destroy()` →
        // `detachAllDomEvents`.
        attachLinkMouseHandlers(muya);
        // Dropping an image file or web-link image into the editor inserts it
        // as a new `![](src)` block. Cleanup is likewise handled by
        // `detachAllDomEvents`.
        attachDragDropImageHandlers(muya);
        if (options.focus !== false)
            this.focus();
    }

    private _dispatchEvents() {
        const { domNode } = this._muya;

        const eventHandler = (event: Event) => {
            // Read-only lock: nothing that reaches a block handler may edit.
            // This gate is what stops muya's OWN keydown-driven structural
            // edits (Enter split, block merge), which never surface as native
            // `beforeinput` and so cannot be blocked at the DOM surface.
            if (this._muya.options.readOnly) {
                this.activeContentBlock = null;
                return;
            }

            // A preview island has no caret of its own (issue #5); handle it
            // before the selection gate below, which would otherwise swallow
            // Backspace/Delete with `activeContentBlock = null`.
            if (this._deleteHtmlPreviewFromKeydown(event))
                return;

            const selectionResult = this.selection.getSelection();
            const anchorBlock = selectionResult?.anchor.block;
            const isSelectionInSameBlock = selectionResult?.isSelectionInSameBlock;
            // Fix issue that language input can not get focus when it's empty(Firefox only)
            if (
                event.type === 'click'
                && isFirefox
                && isHTMLElement(event.target)
                && event.target.textContent === ''
                && event.target.classList.contains(CLASS_NAMES.MU_LANGUAGE_INPUT)
            ) {
                (getBlock(event.target) as Content | undefined)?.setCursor(0, 0, true);
                return;
            }

            if (!isSelectionInSameBlock || !anchorBlock) {
                this.activeContentBlock = null;
                return;
            }

            this.activeContentBlock = anchorBlock;

            switch (event.type) {
                case 'click': {
                    anchorBlock.clickHandler(event);
                    break;
                }
                case 'input': {
                    anchorBlock.inputHandler(event);
                    break;
                }
                case 'keydown': {
                    anchorBlock.keydownHandler(event);
                    break;
                }
                case 'keyup': {
                    anchorBlock.keyupHandler(event);
                    break;
                }
                case 'compositionend':
                case 'compositionstart': {
                    anchorBlock.composeHandler(event);
                    break;
                }
            }
        };

        merge(
            fromEvent(domNode, 'click'),
            fromEvent(domNode, 'input'),
            fromEvent(domNode, 'keydown'),
            fromEvent(domNode, 'keyup'),
            fromEvent(domNode, 'compositionend'),
            fromEvent(domNode, 'compositionstart'),
        ).subscribe(eventHandler);
    }

    /**
     * HTML preview is a `contenteditable=false` attachment: its children come
     * from innerHTML and carry no `__MUYA_BLOCK__`, while the source container
     * is collapsed to 0x0 by CSS. `getSelection()` cannot resolve a Content
     * block, so Backspace/Delete used to die in the dispatch gate. Desktop does
     * not register PreviewToolBar (the only other delete entry point), which
     * made a plain HTML block such as <details> undeletable in the WYSIWYG view.
     *
     * Mirror PreviewToolBar's delete action: swap the whole block for an empty
     * paragraph and put the caret there, so the edit is undoable like any other.
     */
    private _deleteHtmlPreviewFromKeydown(event: Event): boolean {
        if (event.type !== 'keydown')
            return false;

        const { key } = event as KeyboardEvent;
        if (key !== EVENT_KEYS.Backspace && key !== EVENT_KEYS.Delete)
            return false;

        // `<summary>` and friends are focusable: the keydown target may be the
        // island element itself, or the contenteditable root while the native
        // caret still sits inside the island. Check both.
        const anchorNode = this._muya.domNode.ownerDocument.getSelection()?.anchorNode ?? null;
        const anchorEl = anchorNode?.nodeType === 1
            ? anchorNode as Element
            : anchorNode?.parentElement ?? null;
        const candidates: Array<Element | null> = [
            isHTMLElement(event.target) ? event.target : null,
            anchorEl,
        ];

        for (const el of candidates) {
            const preview = el?.closest(`.${CLASS_NAMES.MU_HTML_PREVIEW}`);
            // A split view renders read-only projections in other muya hosts;
            // the native selection may still point into one of them. Only ever
            // delete a block owned by THIS editor instance.
            if (!preview || !this._muya.domNode.contains(preview))
                continue;

            const figure = preview.closest(`.${CLASS_NAMES.MU_HTML_BLOCK}`);
            // An active block shows the SOURCE instead of the preview; it has
            // a real caret and must go through the normal dispatch path.
            if (!figure || figure.classList.contains(CLASS_NAMES.MU_ACTIVE))
                continue;

            const block = getBlock(figure) as Parent | undefined;
            if (!block?.parent)
                continue;

            const newBlock = ScrollPage.loadBlock('paragraph').create(this._muya, {
                name: 'paragraph',
                text: '',
            });
            block.replaceWith(newBlock);
            newBlock.firstContentInDescendant()?.setCursor(0, 0, true);
            event.preventDefault();

            return true;
        }

        return false;
    }

    focus() {
        // No caret exists in a read-only document; setCursor against the
        // non-editable tree would fight the surface instead.
        if (this._muya.options.readOnly)
            return;

        const { selection, scrollPage } = this;
        const { anchorBlock, anchorPath, anchor, focus } = selection;

        // Restore the user's last caret when it is still in the tree, so a
        // focus() triggered after a blur (e.g. the command palette) keeps
        // block-level commands operating on the block the user was editing
        // rather than the first block of the document.
        if (
            anchorBlock
            && anchor
            && focus
            && scrollPage?.queryBlock(anchorPath) === anchorBlock
        ) {
            anchorBlock.setCursor(anchor.offset, focus.offset, true);
            return;
        }

        // TODO: the cursor maybe passed by muya options.cursor, and no need to find the first leaf block.
        const firstLeafBlock = scrollPage?.firstContentInDescendant();

        if (firstLeafBlock == null)
            return;

        const cursor = {
            path: firstLeafBlock.path,
            block: firstLeafBlock,
            anchor: {
                offset: 0,
            },
            focus: {
                offset: 0,
            },
        };

        const needUpdated
            = firstLeafBlock.blockName === 'paragraph.content'
                && (firstLeafBlock as Format).checkNeedRender(cursor);

        firstLeafBlock.setCursor(0, 0, needUpdated);
    }

    updateContents(operations: JSONOp, selection: Nullable<IHistorySelection>, source: string, meta?: IChangeMeta) {
        const muya = this._muya;
        // Read-only backstop: a user-sourced op (undo/redo apply) must not
        // mutate a locked document. `api`-sourced replacements (setContent on
        // tab/view switch) still pass — they swap the document, not edit it.
        if (muya.options.readOnly && source === 'user')
            return;

        // ot-json1 no-op (`null`) is forwarded to dispatch — JSONState
        // short-circuits internally so listeners still see a json-change
        // event for the no-op.
        this.jsonState.dispatch(operations, source, meta);

        // Codes bellow are copy from `ot-json1.apply` and modified.
        if (operations === null)
            return;

        try {
            const snapshot = pick(this.scrollPage as BlockNode, operations);

            drop(snapshot, operations, muya);

            this._restoreSelection(selection);
        }
        catch (error) {
            // The incremental walk left the live tree half-applied (pick removed
            // blocks drop never re-inserted). The json state is authoritative and
            // already up to date — rebuild from it instead of leaving an empty doc.
            debug.error(`updateContents incremental apply failed; rebuilding from state: ${String(error)}`);
            this.scrollPage!.updateState(this.jsonState.getState());
            this._restoreSelection(selection, true);
        }
    }

    private _restoreSelection(selection: Nullable<IHistorySelection>, treeRebuilt = false) {
        if (!selection)
            return;

        const { anchor, focus, isSelectionInSameBlock } = selection;
        // `ScrollPage.queryBlock` consumes the path array in place (`path.shift`),
        // so query against a copy and leave the caller's selection untouched.
        const cursorBlock = this.scrollPage?.queryBlock([...anchor.path]);

        const begin = Math.min(anchor.offset, focus.offset);
        const end = Math.max(anchor.offset, focus.offset);

        if (isSelectionInSameBlock && cursorBlock && cursorBlock.isContent()) {
            cursorBlock.setCursor(begin, end, true);
            return;
        }

        // When the tree was rebuilt wholesale (rebuildContents), the saved
        // selection's cached `anchorBlock` / `focusBlock` reference DETACHED
        // nodes from the previous tree — resolving them would set the native DOM
        // range onto a detached node and crash the next `getSelection()` read.
        // Re-resolve the caret from the (cloned) path against the fresh tree;
        // fall back to focusing the first content block when the saved path no
        // longer points at a content leaf (e.g. a paragraph became a table).
        if (treeRebuilt) {
            if (cursorBlock && cursorBlock.isContent())
                cursorBlock.setCursor(begin, end, true);
            else
                this.focus();

            return;
        }

        // Incremental (updateContents) path. Clone the paths so
        // `queryBlock(path)` can't drain the caller's arrays — notably the
        // selection object stored in the undo stack.
        const anchorBlock = this.scrollPage?.queryBlock([...anchor.path]);
        const focusBlock = this.scrollPage?.queryBlock([...focus.path]);
        if (!anchorBlock || !anchorBlock.isContent() || !focusBlock || !focusBlock.isContent()) {
            this.focus();
            return;
        }

        this.selection.setSelection(
            { offset: anchor.offset, block: anchorBlock, path: [...anchor.path] },
            { offset: focus.offset, block: focusBlock, path: [...focus.path] },
        );
    }

    /**
     * Apply a history op by rebuilding the live block tree wholesale instead of
     * walking it incrementally (`updateContents`). The op is dispatched to the
     * authoritative json state, then `ScrollPage.updateState` re-creates the DOM
     * from that state — the same safe path `setContent` uses. Used for undo/redo
     * of whole-document boundaries (e.g. exiting source-code mode) whose op
     * shapes the incremental pick/drop walker cannot apply without desyncing the
     * DOM from the json state.
     */
    rebuildContents(operations: JSONOp, selection: Nullable<IHistorySelection>, source: string, meta?: IChangeMeta) {
        // Same read-only backstop as `updateContents`; see the note there.
        if (this._muya.options.readOnly && source === 'user')
            return;

        this.jsonState.dispatch(operations, source, meta);

        const state = this.jsonState.getState();
        this.scrollPage!.updateState(state);

        // The tree was rebuilt wholesale, so the selection's cached block
        // references are stale — resolve the caret from paths instead.
        this._restoreSelection(selection, true);
    }

    setContent(content: TState[] | string, autoFocus = false) {
        this.jsonState.setContent(content);
        const state = this.jsonState.getState();

        this.scrollPage!.updateState(state);
        this.history.clear();
        this.searchModule.reset();

        if (autoFocus)
            this.focus();
    }
}
