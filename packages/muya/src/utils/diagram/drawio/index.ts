/**
 * Render `drawio` diagrams through the diagrams.net embed app.
 *
 * DrawIO ships no render library, so the diagram is drawn by the real web
 * editor loaded in an iframe, driven over its documented postMessage protocol:
 * the frame announces `init`, we answer with `load` plus the XML source, and
 * it starts reporting `autosave` once the diagram is on its canvas.
 *
 * This needs network access to the embed server — there is no offline DrawIO
 * renderer to fall back on — so a frame that never comes up is reported as an
 * error naming the server, rather than sitting as an empty box.
 */

import { parseJsonBlock } from '../blockSource';

const LOAD_TIMEOUT = 20000;

export interface IDrawioEmbedMessage {
    event?: string;
    action?: string;
    xml?: string;
    data?: string;
    format?: string;
}

/** What a `drawio` block may hold: where the diagram lives, not the diagram. */
interface IDrawioSource {
    source?: string;
}

export function drawioEmbedUrl(server: string): string {
    const base = server.replace(/\/+$/, '');

    return `${base}/?embed=1&proto=json&ui=min&libraries=0&saveAndExit=0&noSaveBtn=1&noExitBtn=1&keepstyle=1`;
}

/** A `file:` URL for a path the user wrote in the block, kept as-is otherwise. */
function sourceUrl(source: string): string {
    if (/^file:\/\//i.test(source))
        return source;
    if (/^[a-z]:[\\/]/i.test(source))
        return `file:///${source.replace(/\\/g, '/')}`;
    if (source.startsWith('/'))
        return `file://${source}`;

    return source;
}

/**
 * The XML a `drawio` block draws.
 *
 * Most blocks point at the diagram instead of carrying it — `graphConfig = {
 * source: "example.drawio" }` — so the file has to be fetched first. One that
 * holds XML directly is used as-is.
 */
export async function loadDrawioDiagram(code: string): Promise<string> {
    // XML starts with `<`; anything else is the graphConfig object literal.
    if (code.trimStart().startsWith('<'))
        return code.trim();

    const { value } = parseJsonBlock<IDrawioSource>(code);
    const source = typeof value?.source === 'string' ? value.source.trim() : '';
    if (!source)
        throw new Error('The DrawIO block has no source — set `source` in its graphConfig.');

    const url = sourceUrl(source);
    let response: Response;
    try {
        response = await fetch(url);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);

        throw new Error(`The DrawIO source at ${source} could not be loaded — ${detail}`);
    }
    if (!response.ok)
        throw new Error(`The DrawIO source at ${source} could not be loaded (HTTP ${response.status}).`);

    return response.text();
}

function parseEmbedMessage(raw: unknown): IDrawioEmbedMessage | null {
    if (typeof raw !== 'string' || !raw.startsWith('{'))
        return null;

    try {
        return JSON.parse(raw) as IDrawioEmbedMessage;
    }
    catch {
        return null;
    }
}

/**
 * Render `xml` into `target` by hosting the embed editor there.
 *
 * Resolves once the diagram is confirmed to be up (`autosave` after the load),
 * or rejects when the frame never reports in — the only signal available for
 * "server unreachable", since cross-origin frames expose no error event.
 */
export function renderDrawio(target: HTMLElement, xml: string, server: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe');
        iframe.className = 'mu-diagram-drawio';
        iframe.src = drawioEmbedUrl(server);
        // The embed app needs scripts and same-origin access to its own
        // storage; everything else stays locked down.
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
        iframe.setAttribute('title', 'DrawIO diagram');

        let timer: ReturnType<typeof setTimeout> | null = null;
        const cleanup = (): void => {
            if (timer)
                clearTimeout(timer);
            window.removeEventListener('message', onMessage);
        };

        const fail = (message: string): void => {
            cleanup();
            reject(new Error(message));
        };

        function onMessage(event: MessageEvent) {
            if (event.source !== iframe.contentWindow)
                return;

            const message = parseEmbedMessage(event.data);
            if (!message)
                return;

            if (message.event === 'init') {
                iframe.contentWindow?.postMessage(
                    JSON.stringify({ action: 'load', xml, autosave: 1 }),
                    '*',
                );
            }
            else if (message.event === 'autosave' || message.event === 'save') {
                cleanup();
                resolve();
            }
        }

        window.addEventListener('message', onMessage);
        timer = setTimeout(fail, LOAD_TIMEOUT, `The DrawIO embed at ${server} did not respond — check your network connection or the DrawIO server preference.`);

        target.innerHTML = '';
        target.appendChild(iframe);
    });
}

/**
 * Ask a live embed frame to export its diagram.
 *
 * @param frame the iframe `renderDrawio` left in the document
 * @param format 'svg' or 'png'
 * @returns the exported image as a data URI
 */
export function exportDrawio(frame: HTMLIFrameElement, format: 'svg' | 'png'): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!frame.contentWindow) {
            reject(new Error('The DrawIO embed is no longer loaded'));
            return;
        }

        const timer: ReturnType<typeof setTimeout> = setTimeout(
            () => {
                window.removeEventListener('message', onMessage);
                reject(new Error('The DrawIO embed did not answer the export request'));
            },
            LOAD_TIMEOUT,
        );

        function onMessage(event: MessageEvent) {
            if (event.source !== frame.contentWindow)
                return;

            const message = parseEmbedMessage(event.data);
            if (!message)
                return;

            if (message.event === 'export' && typeof message.data === 'string') {
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
                resolve(message.data);
            }
            else if (message.event === 'init') {
                // The frame reloaded and lost the diagram it was showing.
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
                reject(new Error('The DrawIO embed lost its diagram and had to reload'));
            }
        }

        window.addEventListener('message', onMessage);
        frame.contentWindow.postMessage(
            JSON.stringify({ action: 'export', format }),
            '*',
        );
    });
}
