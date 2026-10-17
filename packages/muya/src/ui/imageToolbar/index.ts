import type { ReferenceElement } from '@floating-ui/dom';
import type { VNode } from 'snabbdom';
import type Format from '../../block/base/format';
import type { Muya } from '../../index';

import type { ImageToken } from '../../inlineRenderer/types';
import type { Icon } from './config';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import icons from './config';
import './index.css';

const defaultOptions = {
    placement: 'top' as const,
    offsetOptions: {
        mainAxis: 10,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

export class ImageToolBar extends BaseFloat {
    static pluginName = 'imageToolbar';
    private _oldVNode: VNode | null = null;
    private _imageInfo: {
        token: ImageToken;
        imageId: string;
    } | null = null;

    private _icons: Icon[] = icons;
    private _reference: ReferenceElement | null = null;
    private _block: Format | null = null;
    private _toolbarContainer: HTMLDivElement = document.createElement('div');

    constructor(muya: Muya, options = {}) {
        const name = 'mu-image-toolbar';
        const opts = Object.assign({}, defaultOptions, options);

        super(muya, name, opts);

        this.container!.appendChild(this._toolbarContainer);
        this.floatBox!.classList.add('mu-image-toolbar-container');

        this.listen();
    }

    override listen() {
        const { eventCenter } = this.muya;
        super.listen();
        eventCenter.on('muya-image-toolbar', ({ block, reference, imageInfo }) => {
            this._reference = reference;
            if (reference) {
                this._block = block;
                this._imageInfo = imageInfo;
                setTimeout(() => {
                    this.show(reference);
                    this._render();
                }, 0);
            }
            else {
                this.hide();
            }
        });
    }

    private _render() {
        const { _icons: icons, _oldVNode: oldVNode, _toolbarContainer: toolbarContainer } = this;
        const { i18n } = this.muya;
        const children = icons.map((i) => {
            const iconWrapperSelector = 'div.icon-wrapper';
            const icon = h(
                'i.icon',
                h(
                    'i.icon-inner',
                    {
                        style: {
                            'background': `url(${i.icon}) no-repeat`,
                            'background-size': '100%',
                        },
                    },
                    '',
                ),
            );
            const iconWrapper = h(iconWrapperSelector, icon);
            const itemSelector = `li.item.${i.type}`;

            return h(
                itemSelector,
                {
                    dataset: {
                        tip: i.tooltip,
                    },
                    attrs: {
                        title: i18n.t(i.tooltip),
                    },
                    on: {
                        click: (event) => {
                            this._selectItem(event, i);
                        },
                    },
                },
                iconWrapper,
            );
        });

        const vnode = h('ul', children);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(toolbarContainer, vnode);

        this._oldVNode = vnode;
    }

    private _selectItem(event: Event, item: Icon) {
        event.preventDefault();
        event.stopPropagation();

        const { _imageInfo: imageInfo } = this;

        switch (item.type) {
            // Delete image.
            case 'delete':
                this._block!.deleteImage(imageInfo!);

                return this.hide();

                // Edit image, for example: editor alt and title, replace image.
            case 'edit': {
                const rect = this._reference!.getBoundingClientRect();
                const reference = {
                    getBoundingClientRect() {
                        rect.height = 0;

                        return rect;
                    },
                };
                this.muya.eventCenter.emit('muya-image-selector', {
                    block: this._block,
                    reference,
                    imageInfo,
                });

                return this.hide();
            }
        }
    }
}
