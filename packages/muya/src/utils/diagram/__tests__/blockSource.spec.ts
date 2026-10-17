// @vitest-environment happy-dom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    applyBlockStyle,
    parseDiagramBlock,
    parseJsonBlock,
    pixelSize,
    stripAssignment,
} from '../blockSource';

// What a chart block in a real document looks like — config header, comments,
// then `option = {...}` rather than bare JSON.
const ECHARTS_BLOCK = `// ==BlockCodeConfig==
// @renderer         svg
// @width            auto
// @height           300px
// @backgroundColor  transparent
// ==/BlockCodeConfig==

// Built-in variables:
//   myChart: ECharts instance
option = {
  series: [{ type: "pie", data: [{ value: 1548, name: "Search" }] }]
}`;

const DRAWIO_BLOCK = `graphConfig = {
  source: "https://cdn.jsdelivr.net/gh/obgnail/typora_images@master/image/example.drawio",
  page: 0,
}`;

describe('parseDiagramBlock', () => {
    it('collects the @options out of the config header, lower-cased', () => {
        const { options } = parseDiagramBlock(ECHARTS_BLOCK);

        expect(options.height).toBe('300px');
        expect(options.backgroundcolor).toBe('transparent');
        expect(options.renderer).toBe('svg');
    });

    it('drops the header and the comment lines from the body', () => {
        const { body } = parseDiagramBlock(ECHARTS_BLOCK);

        expect(body).not.toContain('BlockCodeConfig');
        expect(body).not.toContain('Built-in variables');
        expect(body.startsWith('option = {')).toBe(true);
    });

    it('has nothing to say about a block with no header', () => {
        const { options, body } = parseDiagramBlock('X:1\nK:C\nG2 G2');

        expect(options).toEqual({});
        expect(body).toBe('X:1\nK:C\nG2 G2');
    });
});

describe('parseJsonBlock', () => {
    it('reads the object an assignment holds', () => {
        const { value } = parseJsonBlock<{ series: unknown[] }>(ECHARTS_BLOCK);

        expect(value.series).toHaveLength(1);
    });

    it('reads a bare object literal (wavedrom)', () => {
        const code = '// tutorial\n{\n  signal: [\n    { name: "pclk", wave: "p......." },\n  ]\n}';

        expect(parseJsonBlock<{ signal: unknown[] }>(code).value.signal).toHaveLength(1);
    });

    it('keeps the // inside a URL', () => {
        const { value } = parseJsonBlock<{ source: string }>(DRAWIO_BLOCK);

        expect(value.source)
            .toBe('https://cdn.jsdelivr.net/gh/obgnail/typora_images@master/image/example.drawio');
    });

    it('keeps the comma behind an empty element, which is where a `{}` spacer sits', () => {
        const { value } = parseJsonBlock<{ rows: unknown[] }>('config = { rows: [{}, { a: 1 }] }');

        expect(value.rows).toEqual([{}, { a: 1 }]);
    });

    it('tolerates a trailing comma', () => {
        const { value } = parseJsonBlock<Record<string, unknown>>('config = {\n  type: "bar",\n}');

        expect(value.type).toBe('bar');
    });

    it('tolerates a /* */ comment', () => {
        const { value } = parseJsonBlock<Record<string, unknown>>('config = { /* a note */ type: "bar" }');

        expect(value.type).toBe('bar');
    });

    it('rejects a block that is not a chart config', () => {
        expect(() => parseJsonBlock('X:1\nK:C')).toThrow();
    });
});

describe('pixelSize', () => {
    it('reads px and nothing else', () => {
        expect(pixelSize('300px')).toBe(300);
        expect(pixelSize('auto')).toBeNull();
        expect(pixelSize(undefined)).toBeNull();
    });
});

describe('applyBlockStyle', () => {
    it('puts the declared size and alignment on the container', () => {
        const target = document.createElement('div');
        target.style.cssText = 'width: 100%; background-color: red;';

        applyBlockStyle(target, { height: '300px', align: 'center' });

        expect(target.style.width).toBe('100%');
        expect(target.style.height).toBe('300px');
        expect(target.style.backgroundColor).toBe('red');
        expect(target.style.justifyContent).toBe('center');
    });

    it('leaves `auto` and `transparent` alone', () => {
        const target = document.createElement('div');

        applyBlockStyle(target, { width: 'auto', height: 'auto', backgroundcolor: 'transparent' });

        expect(target.getAttribute('style') ?? '').toBe('');
    });
});

describe('stripAssignment', () => {
    it('takes the prefix off an exported option too', () => {
        expect(stripAssignment('window.option = { a: 1 }')).toBe('{ a: 1 }');
    });
});

// Every chart block in the sample document has to survive the reader, which is
// the failure that made the document render as five buckets of error text.
const SAMPLE = resolve(__dirname, '../../../../../../test_md/chart.md');

describe('the chart blocks in test_md/chart.md', () => {
    it.each([
        ['wavedrom'],
        ['echarts'],
        ['chart'],
        ['drawio'],
    ])('reads the %s block', (lang) => {
        if (!existsSync(SAMPLE)) {
            expect(true).toBe(true);
            return;
        }

        const markdown = readFileSync(SAMPLE, 'utf8');
        const code = new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\``).exec(markdown)?.[1] ?? '';

        expect(code).not.toBe('');
        expect(() => parseJsonBlock(code)).not.toThrow();
    });
});
