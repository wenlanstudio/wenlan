declare module '*.svg';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.bmp';
declare module '*.tiff';
declare module '*.css';
declare module '*.css?inline';
declare module '*.woff';
declare module '*.woff2';
declare module '*.woff2?inline' {
    const dataUri: string;
    export default dataUri;
}
declare module 'joplin-turndown-plugin-gfm';
declare module 'prismjs/plugins/keep-markup/prism-keep-markup';
declare module 'prismjs/dependencies';
declare module '@marktext/file-icons';
declare module 'snapsvg-cjs';

declare module 'wavedrom' {
    type TOnml = unknown;

    export function renderAny(
        index: number,
        source: unknown,
        waveSkin: unknown,
        notFirstSignal?: boolean,
    ): TOnml;
    export const waveSkin: unknown;
    export const onml: {
        stringify: (ml: TOnml, indent?: number) => string;
    };
    export function renderWaveForm(
        index: number,
        source: unknown,
        outputId: string,
        notFirstSignal?: boolean,
    ): void;
}

declare module 'flowchart.js' {
    interface IFlowChartDrawOptions {
        [key: string]: unknown;
    }
    interface IFlowChartInstance {
        drawSVG: (container: HTMLElement | string, options?: IFlowChartDrawOptions) => void;
        clean: () => void;
    }
    export function parse(input: string): IFlowChartInstance;
    const flowchart: { parse: typeof parse };
    export default flowchart;
}

declare module '*sequence-diagram-snap' {
    interface ISequenceDrawOptions {
        theme?: 'hand' | 'simple';
        [key: string]: unknown;
    }
    interface ISequenceDiagramInstance {
        drawSVG: (container: HTMLElement | string, options?: ISequenceDrawOptions) => void;
    }
    interface ISequenceDiagramConstructor {
        parse: (input: string) => ISequenceDiagramInstance;
    }
    const Diagram: ISequenceDiagramConstructor;
    export default Diagram;
}
