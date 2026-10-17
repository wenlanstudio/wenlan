// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadRenderer = vi.fn();

vi.mock('../../utils/diagram', () => ({
    default: loadRenderer,
}));

const { MarkdownToHtml } = await import('../markdownToHtml');

beforeEach(() => {
    loadRenderer.mockReset();
    document.body.innerHTML = '';
});

const MERMAID_DOC = ['```mermaid', 'graph TD; A-->B', '```', ''].join('\n');
const PLANTUML_DOC = ['```plantuml', '@startuml', 'A -> B: hi', '@enduml', '```', ''].join('\n');

describe('export container cleanup', () => {
    it('removes the container when the mermaid renderer fails to load', async () => {
        loadRenderer.mockRejectedValue(new Error('Failed to fetch dynamically imported module'));

        await expect(new MarkdownToHtml(MERMAID_DOC).renderHtml()).rejects.toThrow();

        expect(document.querySelectorAll('.mu-render-container')).toHaveLength(0);
    });

    it('renders the invalid-diagram placeholder when a diagram renderer fails to load', async () => {
        // Since the diagram render went through one shared path with the live
        // preview, a broken renderer is a per-diagram error (the placeholder
        // the preview shows) rather than a failure of the whole export.
        loadRenderer.mockRejectedValue(new Error('Failed to fetch dynamically imported module'));

        const html = await new MarkdownToHtml(PLANTUML_DOC).renderHtml();

        expect(html).toContain('Invalid Diagram');
        expect(document.querySelectorAll('.mu-render-container')).toHaveLength(0);
    });
});
