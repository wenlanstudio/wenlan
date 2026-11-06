import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';

// Issue #15, second bug: CommonMark HTML block type 7 keeps every following
// line until a blank one, so `<abc src=""/>\n文字` loaded as ONE html-block
// and the trailing text was no longer editable markdown (clicking the block
// showed both lines in a single source fence). A contentless tag line
// (self-closing or void) now splits: the tag stays an html-block, the rest
// returns as a paragraph. Multi-line HTML authored deliberately keeps the
// CommonMark behaviour.

interface IStateLike {
    name: string;
    text?: string;
}

function generate(markdown: string): IStateLike[] {
    return new MarkdownToState({
        footnote: false,
        texMathDollars: false,
        texMathGfm: false,
        texMathSingleBackslash: false,
        texMathDoubleBackslash: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: false,
    }).generate(markdown) as unknown as IStateLike[];
}

describe('markdownToState — a contentless tag line does not swallow the following paragraph (#15)', () => {
    it('splits `<abc src=""/>` from the paragraph text after it', () => {
        const states = generate('<abc src=""/>\n文字\n');

        expect(states).toEqual([
            { name: 'html-block', text: '<abc src=""/>' },
            { name: 'paragraph', text: '文字' },
        ]);
    });

    it('splits a void tag without a slash too (`<br>`)', () => {
        const states = generate('<br>\nafter\n');

        expect(states).toEqual([
            { name: 'html-block', text: '<br>' },
            { name: 'paragraph', text: 'after' },
        ]);
    });

    it('keeps the paragraph soft breaks of the swallowed lines', () => {
        const states = generate('<hr />\nline one\nline two\n');

        expect(states).toEqual([
            { name: 'html-block', text: '<hr />' },
            { name: 'paragraph', text: 'line one\nline two' },
        ]);
    });

    it('keeps CommonMark swallowing when the next line opens a tag', () => {
        const states = generate('<div>\n<span>keep</span>\n');

        expect(states.length).toBe(1);
        expect(states[0].name).toBe('html-block');
    });

    it('keeps CommonMark swallowing for container tags (`<div>` + text)', () => {
        const states = generate('<div>\n文字\n');

        expect(states.length).toBe(1);
        expect(states[0].name).toBe('html-block');
    });

    it('leaves a blank-line-separated paragraph untouched', () => {
        const states = generate('<abc src=""/>\n\n文字\n');

        expect(states).toEqual([
            { name: 'html-block', text: '<abc src=""/>' },
            { name: 'paragraph', text: '文字' },
        ]);
    });

    it('still demotes a lone `<img>` to a paragraph', () => {
        const states = generate('<img src="a.png"/>\n');

        expect(states).toEqual([{ name: 'paragraph', text: '<img src="a.png"/>' }]);
    });
});
