// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { renderDiagram } from '../render';

/**
 * Chart blocks as they are written in real documents: a config header on top
 * and the option behind an assignment, neither of which is JSON. These ran
 * through the actual renderer rather than a stub, because the failure they
 * guard was in the reading, not in anything a stub would notice.
 */

const hosts: HTMLElement[] = [];

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
});

function makeTarget(): HTMLElement {
    const target = document.createElement('div');
    document.body.appendChild(target);
    hosts.push(target);
    return target;
}

/**
 * A 2D context for happy-dom, which has none. Enough of one for zrender to
 * draw into: every method a no-op, the few that answer something answering it.
 */
function stubCanvas(): void {
    const context = new Proxy({} as Record<string, unknown>, {
        get: (_target, prop) => {
            if (prop === 'measureText')
                return () => ({ width: 10 });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
                return () => ({ addColorStop: () => {} });

            return () => undefined;
        },
        set: () => true,
    });
    const prototype = window.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    prototype.getContext = () => context;
}

async function draw(
    type: string,
    code: string,
    target: HTMLElement,
    vector = false,
): Promise<void> {
    await renderDiagram({
        type,
        code,
        target,
        vegaTheme: 'latimes',
        mermaidTheme: 'default',
        plantumlServer: 'https://www.plantuml.com/plantuml',
        sequenceTheme: 'simple',
        drawioServer: 'https://embed.diagrams.net',
        vector,
    });
}

const WAVEDROM = `// ==BlockCodeConfig==
// @align            center
// @width            auto
// ==/BlockCodeConfig==

// Tutorial: https://wavedrom.com/tutorial.html
{
  signal: [
    { name: "pclk", wave: "p......." },
    {},
    { name: "clk1", wave: "xhlhLHl." },
  ]
}`;

const ECHARTS = `// ==BlockCodeConfig==
// @renderer         svg
// @height           300px
// ==/BlockCodeConfig==

// Built-in variables:
//   myChart: ECharts instance
option = {
  series: [{ name: "Access From", type: "pie", radius: ["40%", "70%"], data: [{ value: 1548, name: "Search" }] }],
}`;

const CHARTJS = `// ==BlockCodeConfig==
// @height           300px
// ==/BlockCodeConfig==

config = {
  type: "bar",
  data: { labels: ["Red"], datasets: [{ label: "# of Votes", data: [12] }] },
}`;

describe('renderDiagram — a chart block with a config header', () => {
    it('draws the waveform', async () => {
        const target = makeTarget();

        await draw('wavedrom', WAVEDROM, target);

        expect(target.querySelector('svg')?.getAttribute('class')).toBe('WaveDrom');
    }, 30000);

    // The live preview is drawn on a canvas — that is where the tooltip and the
    // legend live — but happy-dom hands out no 2D context, so what is testable
    // here is the vector render an export asks for.
    it('draws the ECharts chart on the stage the header asked for', async () => {
        const target = makeTarget();

        await draw('echarts', ECHARTS, target, true);

        // Without a height the container measures zero and the chart, though
        // drawn, is invisible.
        expect(target.style.height).toBe('300px');
        expect(target.querySelector('svg')).not.toBeNull();
    }, 30000);

    it('centres the canvas ECharts drew, which is a block of its own', async () => {
        const target = makeTarget();
        stubCanvas();
        Object.defineProperty(target, 'clientWidth', { value: 640, configurable: true });

        await draw('echarts', ECHARTS, target);

        // Zrender's stage is a `<div>` with `margin: 0`, so the container's
        // `text-align` — which did centre the inline `<svg>` — cannot place it.
        const stage = target.querySelector('canvas')?.parentElement as HTMLElement;
        expect(stage.style.marginLeft).toBe('auto');
        expect(stage.style.marginRight).toBe('auto');
    }, 30000);

    it('sizes the Chart.js canvas from the header', async () => {
        const target = makeTarget();

        // Chart.js paints through a 2D canvas context, which happy-dom does not
        // provide — what matters here is the canvas it was handed, not the drawing.
        await draw('chart', CHARTJS, target).catch(() => undefined);

        expect(target.querySelector('canvas')?.height).toBe(300);
    }, 30000);
});
