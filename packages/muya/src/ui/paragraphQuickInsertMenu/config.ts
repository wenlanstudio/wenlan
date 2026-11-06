import abcIcon from '../../assets/icons/abc/2.svg';
import bulletListIcon from '../../assets/icons/bullet_list/2.png';
import vegaIcon from '../../assets/icons/chart/2.png';
import chartJsIcon from '../../assets/icons/chart/2.svg';
import codeIcon from '../../assets/icons/code/2.png';
import drawioIcon from '../../assets/icons/drawio/2.svg';
import echartsIcon from '../../assets/icons/echarts/2.svg';
import flowchartIcon from '../../assets/icons/flowchart/2.png';
import frontMatterIcon from '../../assets/icons/front_matter/2.png';
import graphvizIcon from '../../assets/icons/graphviz/2.svg';
import header1Icon from '../../assets/icons/heading_1/2.png';
import header2Icon from '../../assets/icons/heading_2/2.png';
import header3Icon from '../../assets/icons/heading_3/2.png';
import header4Icon from '../../assets/icons/heading_4/2.png';
import header5Icon from '../../assets/icons/heading_5/2.png';
import header6Icon from '../../assets/icons/heading_6/2.png';
import hrIcon from '../../assets/icons/horizontal_line/2.png';
import htmlIcon from '../../assets/icons/html/2.png';
import mathBlockIcon from '../../assets/icons/math/2.png';
import matplotlibIcon from '../../assets/icons/matplotlib/2.svg';
import mermaidIcon from '../../assets/icons/mermaid/2.png';

import newTableIcon from '../../assets/icons/new_table/2.png';
import orderListIcon from '../../assets/icons/order_list/2.png';
import paragraphIcon from '../../assets/icons/paragraph/2.png';
import plantumlIcon from '../../assets/icons/plantuml/2.png';
import quoteIcon from '../../assets/icons/quote_block/2.png';
import sequenceIcon from '../../assets/icons/sequence/2.png';
import todoListIcon from '../../assets/icons/todolist/2.png';
import wavedromIcon from '../../assets/icons/wavedrom/2.svg';
import { isOsx } from '../../config';
import { isKeyboardEvent } from '../../utils';

const COMMAND_KEY = isOsx ? '⌘' : 'Ctrl';
const OPTION_KEY = isOsx ? '⌥' : 'Alt';
const SHIFT_KEY = isOsx ? '⇧' : 'Shift';

// Command (or Cmd) ⌘
// Shift ⇧
// Option (or Alt) ⌥
// Control (or Ctrl) ⌃
// Caps Lock ⇪
// Fn

export interface IQuickInsertMenuItem {
    name: string;
    children: {
        title: string;
        subTitle: string;
        label: string;
        icon: string;
        score?: number;
        i18nTitle?: string;
        shortCut?: string;
        shortKeyMap?: {
            altKey: boolean;
            shiftKey: boolean;
            metaKey: boolean;
            code: string;
        };
    }[];
}

export const MENU_CONFIG: IQuickInsertMenuItem[] = [
    {
        name: 'basic blocks',
        children: [
            {
                title: 'Paragraph',
                subTitle: 'Lorem Ipsum text',
                label: 'paragraph',
                shortCut: `${COMMAND_KEY}+0`,
                shortKeyMap: {
                    altKey: false,
                    shiftKey: false,
                    metaKey: true,
                    code: 'Digit0',
                },
                icon: paragraphIcon,
            },
            {
                title: 'Horizontal Line',
                subTitle: '---',
                label: 'thematic-break',
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+-`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'Minus',
                },
                icon: hrIcon,
            },
            {
                title: 'Front Matter',
                subTitle: '--- Lorem Ipsum ---',
                label: 'frontmatter',
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+Y`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'KeyY',
                },
                icon: frontMatterIcon,
            },
        ],
    },
    {
        // `/begin` `/split` `/end` 快捷命令（#17）：分栏标记是独立成行的 html
        // 注释，begin 自带默认两栏 50:50 比例声明，栏由 split 划出、end 收口。
        name: 'column markers',
        children: [
            {
                title: 'Begin Columns',
                subTitle: '<!-- begin 50:50 -->',
                label: 'column-begin',
                icon: htmlIcon,
            },
            {
                title: 'Split Columns',
                subTitle: '<!-- split -->',
                label: 'column-split',
                icon: htmlIcon,
            },
            {
                title: 'End Columns',
                subTitle: '<!-- end -->',
                label: 'column-end',
                icon: htmlIcon,
            },
        ],
    },
    {
        name: 'headings',
        children: [
            {
                title: 'Heading 1',
                subTitle: '# Lorem Ipsum...',
                label: 'atx-heading 1',
                shortCut: `${COMMAND_KEY}+1`,
                shortKeyMap: {
                    altKey: false,
                    shiftKey: false,
                    metaKey: true,
                    code: 'Digit1',
                },
                icon: header1Icon,
            },
            {
                title: 'Heading 2',
                subTitle: '## Lorem Ipsum...',
                label: 'atx-heading 2',
                shortCut: `${COMMAND_KEY}+2`,
                shortKeyMap: {
                    altKey: false,
                    shiftKey: false,
                    metaKey: true,
                    code: 'Digit2',
                },
                icon: header2Icon,
            },
            {
                title: 'Heading 3',
                subTitle: '### Lorem Ipsum...',
                label: 'atx-heading 3',
                shortCut: `${COMMAND_KEY}+3`,
                shortKeyMap: {
                    altKey: false,
                    shiftKey: false,
                    metaKey: true,
                    code: 'Digit3',
                },
                icon: header3Icon,
            },
            {
                title: 'Heading 4',
                subTitle: '#### Lorem Ipsum...',
                label: 'atx-heading 4',
                shortCut: `${COMMAND_KEY}+4`,
                shortKeyMap: {
                    altKey: false,
                    shiftKey: false,
                    metaKey: true,
                    code: 'Digit4',
                },
                icon: header4Icon,
            },
            {
                title: 'Heading 5',
                subTitle: '##### Lorem Ipsum...',
                label: 'atx-heading 5',
                shortCut: `${COMMAND_KEY}+5`,
                shortKeyMap: {
                    altKey: false,
                    shiftKey: false,
                    metaKey: true,
                    code: 'Digit5',
                },
                icon: header5Icon,
            },
            {
                title: 'Heading 6',
                subTitle: '###### Lorem Ipsum...',
                label: 'atx-heading 6',
                shortCut: `${COMMAND_KEY}+6`,
                shortKeyMap: {
                    altKey: false,
                    shiftKey: false,
                    metaKey: true,
                    code: 'Digit6',
                },
                icon: header6Icon,
            },
        ],
    },
    {
        name: 'advanced blocks',
        children: [
            {
                title: 'Table Block',
                subTitle: '|Lorem | Ipsum |',
                label: 'table',
                // no
                shortCut: `${SHIFT_KEY}+${COMMAND_KEY}+T`,
                shortKeyMap: {
                    altKey: false,
                    shiftKey: true,
                    metaKey: true,
                    code: 'KeyT',
                },
                icon: newTableIcon,
            },
            {
                title: 'Display Math',
                subTitle: '$$ Lorem Ipsum $$',
                label: 'math-block',
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+M`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'KeyM',
                },
                icon: mathBlockIcon,
            },
            {
                title: 'HTML Block',
                subTitle: '<div> Lorem Ipsum </div>',
                label: 'html-block',
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+J`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'KeyJ',
                },
                icon: htmlIcon,
            },
            {
                title: 'Code Block',
                subTitle: '```java Lorem Ipsum ```',
                label: 'code-block',
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+C`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'KeyC',
                },
                icon: codeIcon,
            },
            {
                title: 'Quote Block',
                subTitle: '>Lorem Ipsum ...',
                label: 'block-quote',
                // no
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+Q`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'KeyQ',
                },
                icon: quoteIcon,
            },
        ],
    },
    {
        name: 'list blocks',
        children: [
            {
                title: 'Order List',
                subTitle: '1. Lorem Ipsum ...',
                label: 'order-list',
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+O`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'KeyO',
                },
                icon: orderListIcon,
            },
            {
                title: 'Bullet List',
                subTitle: '- Lorem Ipsum ...',
                label: 'bullet-list',
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+U`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'KeyU',
                },
                icon: bulletListIcon,
            },
            {
                title: 'To-do List',
                subTitle: '- [x] Lorem Ipsum ...',
                label: 'task-list',
                shortCut: `${OPTION_KEY}+${COMMAND_KEY}+X`,
                shortKeyMap: {
                    altKey: true,
                    shiftKey: false,
                    metaKey: true,
                    code: 'KeyX',
                },
                icon: todoListIcon,
            },
        ],
    },
    {
        name: 'diagrams',
        children: [
            {
                title: 'Vega Chart',
                subTitle: 'By vega-lite.js',
                label: 'diagram vega-lite',
                icon: vegaIcon,
            },
            {
                title: 'Mermaid',
                subTitle: 'By mermaid',
                label: 'diagram mermaid',
                icon: mermaidIcon,
            },
            {
                title: 'Plantuml',
                subTitle: 'By plantuml',
                label: 'diagram plantuml',
                icon: plantumlIcon,
            },
            {
                title: 'Flowchart',
                subTitle: 'By flowchart.js',
                label: 'diagram flowchart',
                icon: flowchartIcon,
            },
            {
                title: 'Sequence',
                subTitle: 'By js-sequence-diagrams',
                label: 'diagram sequence',
                icon: sequenceIcon,
            },
            {
                title: 'GraphViz',
                subTitle: 'By @viz-js/viz (dot)',
                label: 'diagram graphviz',
                icon: graphvizIcon,
            },
            {
                title: 'WaveDrom',
                subTitle: 'By wavedrom',
                label: 'diagram wavedrom',
                icon: wavedromIcon,
            },
            {
                title: 'ECharts',
                subTitle: 'By echarts',
                label: 'diagram echarts',
                icon: echartsIcon,
            },
            {
                title: 'Chart.js',
                subTitle: 'By chart.js',
                label: 'diagram chart',
                icon: chartJsIcon,
            },
            {
                title: 'ABC Notation',
                subTitle: 'By abcjs',
                label: 'diagram abc',
                icon: abcIcon,
            },
            {
                title: 'DrawIO',
                subTitle: 'By embed.diagrams.net',
                label: 'diagram drawio',
                icon: drawioIcon,
            },
            {
                title: 'Matplotlib',
                subTitle: 'By local Python',
                label: 'diagram matplotlib',
                icon: matplotlibIcon,
            },
        ],
    },
];

export function getLabelFromEvent(event: Event) {
    if (!isKeyboardEvent(event))
        return null;
    const ALL_MENU_CONFIG = MENU_CONFIG.reduce(
        (acc, section) => [...acc, ...section.children],
        [] as IQuickInsertMenuItem['children'],
    );

    const result = ALL_MENU_CONFIG.find((menu) => {
        const { code, metaKey, shiftKey, altKey } = event;
        const { shortKeyMap = {} as IQuickInsertMenuItem['children'][number]['shortKeyMap'] } = menu;

        return (
            code === shortKeyMap?.code
            && metaKey === shortKeyMap.metaKey
            && shiftKey === shortKeyMap.shiftKey
            && altKey === shortKeyMap.altKey
        );
    });

    if (result)
        return result.label;
}
