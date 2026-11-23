import type { Muya } from '../../muya';
import type { Nullable } from '../../types';
import type { IAttributes, IDatasets } from '../../utils/types';
import type { IConstructor } from '../types';
import type Content from './content';
import type { ILinkedNode } from './linkedList/linkedNode';
import type Parent from './parent';
import { BLOCK_DOM_PROPERTY } from '../../config';
import { createDomNode } from '../../utils/dom';

class TreeNode implements ILinkedNode {
    prev: Nullable<TreeNode> = null;

    next: Nullable<TreeNode> = null;

    parent: Nullable<Parent> = null;

    domNode: Nullable<HTMLElement> = null;

    tagName: string = '';

    classList: string[] = [];

    attributes: IAttributes = {};

    datasets: IDatasets = {};

    static blockName = 'tree.node';

    protected get static(): IConstructor<TreeNode> {
        // `this.constructor` is `Function` in lib.d.ts; subclasses' generated
        // constructors carry the static `blockName` etc., but TS can't see
        // through `Function` to the subclass shape.
        // eslint-disable-next-line no-restricted-syntax
        return this.constructor as unknown as IConstructor<TreeNode>;
    }

    get blockName() {
        return this.static.blockName;
    }

    get jsonState() {
        return this.muya.editor.jsonState;
    }

    get scrollPage() {
        return this.muya.editor.scrollPage;
    }

    get isScrollPage() {
        return this.blockName === 'scrollpage';
    }

    get isOutMostBlock(): boolean {
        return this.parent ? this.parent.isScrollPage : false;
    }

    get outMostBlock(): Nullable<Parent> {
        // `this.isContent()` returns false only when `this` is a Parent
        // subclass — but the base-class type signature is `TreeNode`. The
        // `this as Parent` widening can't be expressed without a cast.
        // eslint-disable-next-line no-restricted-syntax
        let node = this.isContent() ? this.parent : this as unknown as Parent;

        while (node) {
            if (node.isOutMostBlock)
                return node;

            node = node.parent;
        }

        return null;
    }

    constructor(public muya: Muya) {}

    /**
     * check this is a Content block?
     * @param this
     * @returns boolean
     */
    isContent(this: TreeNode): this is Content {
        return 'text' in this;
    }

    /**
     * check this is a Parent block?
     * @param this
     * @returns boolean
     */
    isParent(this: TreeNode): this is Parent {
        return 'children' in this;
    }

    /**
     * create domNode
     */
    createDomNode() {
        const { tagName, classList, attributes, datasets } = this;

        const domNode = createDomNode(tagName, {
            classList,
            attributes,
            datasets,
        });

        // Concrete subclasses are always Parent | Content, but the static
        // signature here is TreeNode (Format extends Content via a separate
        // file). Mark the DOM property with the runtime subtype.
        // eslint-disable-next-line no-restricted-syntax
        domNode[BLOCK_DOM_PROPERTY] = this as unknown as Parent | Content;

        this.domNode = domNode;
    }

    // Get previous content block in block tree.
    previousContentInContext(): Nullable<Content> {
        if (this.isScrollPage || !this.parent)
            return null;

        const { parent } = this;

        // Walk previous siblings, skipping empty containers (e.g. a list item
        // whose only paragraph was removed) that hold no content descendant.
        // Otherwise such a sibling yields null and the caret gets stuck when
        // navigating up/left across it (#4644).
        let sibling = parent.prev;
        while (sibling) {
            if (sibling.isParent()) {
                const content = sibling.lastContentInDescendant();
                if (content)
                    return content;
            }
            else {
                return sibling; // language input
            }
            sibling = sibling.prev;
        }

        return parent.previousContentInContext();
    }

    // Get next content block in block tree.
    nextContentInContext(): Nullable<Content> {
        if (this.isScrollPage || !this.parent)
            return null;

        const { parent } = this;

        if (this.blockName === 'language-input')
            return parent.lastContentInDescendant();

        // Walk next siblings, skipping empty containers with no content
        // descendant so the caret can cross them instead of getting stuck (#4644).
        let sibling = parent.next;
        while (sibling) {
            if (sibling.isParent()) {
                const content = sibling.firstContentInDescendant();
                if (content)
                    return content;
            }
            else {
                return sibling; // language input
            }
            sibling = sibling.next;
        }

        return parent.nextContentInContext();
    }

    /**
     * Direction-key cross-block navigation with visual-flow stop order for
     * code blocks (Typora semantics): a code block has two stops, the code
     * body and its bottom-right language input, and the travel direction
     * decides their order — downward = body → language input, upward =
     * language input → body. Both directions put the language input at the
     * screen-edge stop, which is where it visually sits.
     *
     * The tree-order primitives `nextContentInContext` /
     * `previousContentInContext` stay untouched for their tree-order consumers
     * (backspace, delete, format); only `arrowHandler` routes through these.
     *
     * Level note: the body content is nested inside the `code` wrapper
     * (code-block → [language-input, code → codeblock.content]), so the
     * wrapper's content is the only node whose content-primitives cross block
     * levels correctly — the code-block node itself sits one level too high
     * (its parent is the scroll page) and its language input never exits via
     * `nextContentInContext` (special branch). The exits below therefore walk
     * from the body / language input, never from the code-block node.
     */
    nextContentInFlow(): Nullable<Content> {
        // Language input heading down leaves the block — the body was the
        // previous stop. Walk from the body so block levels resolve correctly.
        if (this.blockName === 'language-input') {
            const body = this.parent?.lastContentInDescendant();
            const next = body ? body.nextContentInContext() : null;
            return enterBelow(next);
        }

        // The body is the block's upper stop — one keypress down is the
        // language input, not the block after.
        const codeBlock = enclosingCodeBlock(this);
        if (codeBlock)
            return codeBlock.firstContentInDescendant();

        return enterBelow(this.nextContentInContext());
    }

    previousContentInFlow(): Nullable<Content> {
        // Language input heading up folds back into the body — the block's
        // lower stop returns to its upper stop.
        if (this.blockName === 'language-input')
            return this.parent?.lastContentInDescendant() ?? null;

        let prev = this.previousContentInContext();

        // The body's tree-previous is its language input — that stop was
        // already visited coming up, so leave the block. The language input is
        // the code-block's block-level child and its own primitive crosses out.
        if (prev?.blockName === 'language-input')
            prev = prev.previousContentInContext();

        // Crossing into a code block from below lands on its body (tree tail)
        // — the flow stop order from below starts at the language input.
        if (prev) {
            const codeBlock = enclosingCodeBlock(prev);
            if (codeBlock)
                return codeBlock.firstContentInDescendant() ?? prev;
        }

        return prev;
    }

    /**
     * Weather `this` is the only child of its parent.
     */
    isOnlyChild() {
        return this.isFirstChild() && this.isLastChild();
    }

    /**
     * Weather `this` is the first child of its parent.
     */
    isFirstChild() {
        return this.prev === null;
    }

    /**
     * Weather `this` is the last child of its parent.
     */
    isLastChild() {
        return this.next === null;
    }

    /**
     * Weather `this` is descendant of `block`
     * @param {*} block
     */
    isInBlock(block: Parent) {
        let parent = this.parent;
        while (parent) {
            if (parent === block)
                return true;

            parent = parent.parent;
        }

        return false;
    }

    /**
     * Find the closest block which blockName is `blockName`. return `null` if not found.
     * @param {string} blockName
     */
    closestBlock(blockName: string): Nullable<TreeNode> {
        if (this.blockName === blockName)
            return this;

        let parent = this.parent;

        while (parent) {
            if (parent.blockName === blockName)
                return parent;

            parent = parent.parent;
        }

        return null;
    }

    farthestBlock(blockName: string): Nullable<TreeNode> {
        const results: TreeNode[] = [];
        if (this.blockName === blockName)
            results.push(this);

        let parent = this.parent;

        while (parent) {
            if (parent.blockName === blockName)
                results.push(parent);

            parent = parent.parent;
        }
        const popItem = results.pop();

        return popItem || null;
    }

    insertInto(parent: Parent, refBlock: Nullable<Parent> = null) {
        if (this.parent === parent && this.next === refBlock)
            return;

        if (this.parent)
            this.parent.removeChild(this);

        // `parent.insertBefore` takes a Parent (the tree's internal linked
        // list operates on Parent), but TreeNode.insertInto is also called
        // from Content subclasses which extend TreeNode, not Parent.
        // eslint-disable-next-line no-restricted-syntax
        parent.insertBefore(this as unknown as Parent, refBlock);
    }

    /**
     * Remove the current block in the block tree.
     */
    remove(_source = 'user') {
        if (!this.parent)
            return;

        this.parent.children.remove(this);
        this.parent = null;
        this.domNode?.remove();

        return this;
    }
}

/**
 * The enclosing code-block of a content node, or null. The body content sits
 * inside the `code` wrapper (code-block → [language-input, code → content]),
 * so a parent walk is required; other containers (frontmatter, math, diagram,
 * html) reuse the wrapper under different block names and are excluded here.
 */
function enclosingCodeBlock(node: TreeNode): Nullable<Parent> {
    let p: Nullable<Parent> = node.parent;
    while (p && !p.isScrollPage) {
        if (p.blockName === 'code-block')
            return p;
        p = p.parent;
    }
    return null;
}

/**
 * Flow entry from above: tree order lands on a code-block's language input
 * (its first content descendant) — redirect to the body, the upper stop.
 */
function enterBelow(next: Nullable<Content>): Nullable<Content> {
    if (next?.blockName === 'language-input')
        return next.parent?.lastContentInDescendant() ?? next;
    return next;
}

export default TreeNode;
