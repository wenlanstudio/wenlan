import type { Muya } from '../../../muya';
import type { IColumnsState, IColumnState } from '../../../state/types';
import { CLASS_NAMES } from '../../../config';
import { mixins } from '../../../utils';
import Parent from '../../base/parent';
import IContainerQueryBlock from '../../mixins/containerQueryBlock';
import { ScrollPage } from '../../scrollPage';

/**
 * A `<!-- begin --> … <!-- end -->` column group.
 *
 * The group owns its columns; the markers themselves stay in the text of the
 * blocks they belong to, so the markdown round-trip is byte-identical and the
 * marker remains editable text in the Page view. This block only records the
 * grouping — which is what makes the Columns view a real view of the same
 * document instead of a DOM post-process, and what lets the engine edit
 * inside a column. See `utils/columns/DESIGN.md`.
 */
@mixins(IContainerQueryBlock)
class Columns extends Parent {
    static override blockName = 'columns';

    public meta: IColumnsState['meta'];

    static create(muya: Muya, state: IColumnsState) {
        const columns = new Columns(muya, state);

        for (const child of state.children)
            columns.append(ScrollPage.loadBlock(child.name).create(muya, child));

        columns._applyRatio();

        return columns;
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset, 'children'];
    }

    // Container-block path semantics: descendants address into `children`.
    // `Parent.getJsonPath` strips the trailing 'children' segment via
    // `isContainerBlock`, which we override so a column group participates in
    // the same json1 op routing.
    protected override get isContainerBlock() {
        return true;
    }

    constructor(muya: Muya, { meta }: IColumnsState) {
        super(muya);
        this.tagName = 'div';
        this.meta = { ...meta };
        this.classList = [CLASS_NAMES.MU_COLUMNS];
        this.createDomNode();
    }

    override getState(): IColumnsState {
        return {
            name: 'columns',
            meta: { ...this.meta },
            children: this.children.map(child => (child as Parent).getState() as IColumnState),
        };
    }

    /**
     * Column widths as flex growth. The parts are percentages that add up to
     * 100 (§1.1), so they can be used as the growth factors directly. A group
     * without a usable ratio (§1.3 #5) renders at equal widths.
     */
    private _applyRatio() {
        const { ratio } = this.meta;
        const columns = [...this.domNode!.children] as HTMLElement[];

        columns.forEach((column, index) => {
            column.style.flexGrow
                = ratio && ratio.length === columns.length ? String(ratio[index]) : '1';
        });
    }
}

export default Columns;
