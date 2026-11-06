import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';
import ExportMarkdown from '../stateToMarkdown';

// A `-`-style horizontal rule as the document's FIRST block serializes to a
// leading `---`, and the loader's front-matter preprocessing (which runs
// before block parsing and is `^`-anchored) reads that as a YAML opener.
// Everything up to the next `---` in the file is then swallowed into the
// front-matter block and vanishes from the document body — observed on real
// lecture notes that begin with a blank line + `---` + `---`-separated header
// fields (the blank line keeps the FIRST parse out of front matter, so the
// corruption only appears on the next load: a source-mode toggle, a save, or
// an external reload). The serializer now rewrites the leading dash-rule to
// `***`, which is the same rule but unambiguous.

interface IStateLike {
    name: string;
    text?: string;
    children?: IStateLike[];
}

const OPTS = {
    footnote: false,
    texMathDollars: true,
    texMathGfm: false,
    texMathSingleBackslash: false,
    texMathDoubleBackslash: false,
    trimUnnecessaryCodeBlockEmptyLines: true,
    frontMatter: true,
};

function parse(md: string): IStateLike[] {
    return new MarkdownToState(OPTS).generate(md) as unknown as IStateLike[];
}

function serialize(states: IStateLike[]): string {
    return new ExportMarkdown({ listIndentation: 1 }).generate(states as never);
}

function names(states: IStateLike[]): string[] {
    return states.map(s => s.name);
}

describe('serialize — a leading `---` rule does not become front matter on reload', () => {
    it('rewrites the leading dash rule to `***`', () => {
        const states = parse('---\n\nhello\n');
        expect(names(states)).toEqual(['thematic-break', 'paragraph']);

        const md = serialize(states);
        expect(md.startsWith('***\n')).toBe(true);
    });

    it('survives the full round trip with the document body intact', () => {
        // The real-world shape: a blank FIRST line keeps the initial parse out
        // of front matter (fm() is `^`-anchored), so the document loads as
        // body blocks — and the leading blank line is not a block, so the
        // NEXT serialize drops it and the reload would eat everything up to
        // the next `---` as front matter.
        const states = parse('\n---\n\ntitle: LaTeX\n\n- Tools\n\n---\n\n##### VS Code\n');
        expect(names(states)[0]).toBe('thematic-break');
        const reloaded = parse(serialize(states));

        expect(names(reloaded)).toEqual(names(states));
        // The body keeps every block; only the rule marker char normalizes.
        expect(reloaded[0].name).toBe('thematic-break');
        expect(reloaded[1]).toMatchObject({ name: 'paragraph', text: 'title: LaTeX' });
    });

    it('leaves a `---` rule after the first block untouched', () => {
        const states = parse('hello\n\n---\n\nworld\n');
        const md = serialize(states);

        expect(md).toContain('\n---\n');
        const reloaded = parse(md);
        expect(names(reloaded)).toEqual(['paragraph', 'thematic-break', 'paragraph']);
    });

    it('leaves a leading `***` rule untouched', () => {
        const states = parse('***\n\nhello\n');
        const md = serialize(states);

        expect(md.startsWith('***\n')).toBe(true);
    });

    it('still serializes real front matter as front matter', () => {
        const states = parse('---\ntitle: x\n---\n\nbody\n');
        const md = serialize(states);

        expect(md.startsWith('---\ntitle: x\n---\n')).toBe(true);
        const reloaded = parse(md);
        expect(names(reloaded)).toEqual(['frontmatter', 'paragraph']);
    });
});
