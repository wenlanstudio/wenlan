import type { Muya } from '../../../muya';
import type { IColumnState } from '../../../state/types';
import { CLASS_NAMES } from '../../../config';
import { mixins } from '../../../utils';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

/**
 * One column of a `columns` group — a plain container of content blocks.
 *
 * The block mirrors the tree: a column's DOM node holds exactly its children,
 * so the engine's DOM-relative block insertion keeps working inside a column
 * (the reason the column group has to be a block, not a DOM post-process —
 * see `utils/columns/DESIGN.md`).
 */
@mixins(IContainerQueryBlock)
class Column extends Parent {
    static override blockName = 'column';

    static create(muya: Muya, state: IColumnState) {
        const column = new Column(muya);

        for (const child of state.children)
            column.append(ScrollPage.loadBlock(child.name).create(muya, child));

        return column;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset, 'children'];
    }

    // Container-block path semantics: descendants address into `children`.
    // `Parent.getJsonPath` strips the trailing 'children' segment via
    // `isContainerBlock`, which we override so a column participates in the
    // same json1 op routing.
    protected override get isContainerBlock() {
        return true;
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'div';
        this.classList = [CLASS_NAMES.MU_COLUMN];
        this.createDomNode();
    }

    override getState(): IColumnState {
        return {
            name: 'column',
            children: this.children.map(child => (child as Parent).getState()),
        };
    }
}

export default Column;
