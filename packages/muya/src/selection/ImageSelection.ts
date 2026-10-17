import type Format from '../block/base/format';
import type { Muya } from '../muya';
import type { IImageInfo } from '../utils/image';
import type Selection from './index';
import type { IImageSelectionData } from './types';
import { BLOCK_DOM_PROPERTY, CLASS_NAMES } from '../config';
import { LINK_SELECTOR } from '../editor/linkMouseEvents';
import { isHTMLElement, isKeyboardEvent } from '../utils';
import { getImageInfo, getImageSrc } from '../utils/image';
import { findContentDOM } from './dom';
import { SelectionType } from './types';

class ImageSelection {
    selected: IImageSelectionData | null = null;

    constructor(private _muya: Muya, private _selection: Selection) {}

    attach(): void {
        const { eventCenter, domNode } = this._muya;
        eventCenter.attachDOMEvent(domNode, 'click', this._handleClick);
        eventCenter.attachDOMEvent(document, 'click', this._handleDocClick);
        eventCenter.attachDOMEvent(document, 'keydown', this._handleKeydown);
    }

    clear(): void {
        this.selected = null;
    }

    private _handleDocClick = (): void => {
        this.selected = null;
    };

    private _handleClick = (event: Event): void => {
        const { target } = event;
        if (!isHTMLElement(target))
            return;
        const imageWrapper = target.closest<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`);
        this.selected = null;
        if (imageWrapper)
            this._handleClickInlineImage(event, imageWrapper);
    };

    private _handleKeydown = (event: Event): void => {
        if (!isKeyboardEvent(event))
            return;

        const { key } = event;
        const { selected } = this;
        if (!selected)
            return;

        if (!selected.block.outMostBlock) {
            this.selected = null;
            return;
        }

        if (key === ' ') {
            event.preventDefault();
            this._previewSelectedImage(selected);
            return;
        }

        if (/^(?:Backspace|Delete|Enter)$/.test(key)) {
            event.preventDefault();
            const { block, ...imageInfo } = selected;
            block.deleteImage(imageInfo);
            this._selection.activate(SelectionType.TEXT);
        }
    };

    private _previewSelectedImage(selected: IImageSelectionData) {
        const { token, imageId } = selected;
        const tokenSrc = token.src || token.attrs.src || '';
        const imgSrc
            = this._muya.domNode
                .querySelector<HTMLImageElement>(`#${imageId} img`)
                ?.getAttribute('src') ?? '';
        const src = getImageSrc(tokenSrc).src || imgSrc;

        if (src) {
            this._muya.eventCenter.emit('preview-image', {
                data: src,
            });
        }
    }

    // 点击图片不再选中并浮出工具栏：居中已改为渲染层默认表现，对齐也不再写进 md，
    // 浮层没有可编辑的东西。改为把光标落进它的 markdown 源码，用户直接编辑
    // `![](assets/a.png)` 这段文本；移开光标后重新渲染成图片（由 `image` 渲染器
    // 按光标是否落在 token 区间内决定渲染图片还是源码）。
    // 空图片占位符返回 false，走原来的选图路径——那里点一下是要选图。
    private _revealImageSource(contentBlock: Format, imageInfo: IImageInfo): boolean {
        if (!imageInfo.token.attrs.src)
            return false;

        const { start, end } = imageInfo.token.range;
        const offset = Math.max(start, end - 1);
        const { eventCenter } = this._muya;

        eventCenter.emit('muya-image-toolbar', { reference: null });
        contentBlock.setCursor(offset, offset, true);

        return true;
    }

    // Ctrl/Cmd+点击图片时把图片地址交给外层预览。
    // 链接里的图片（`[![alt](img)][ref]`）其 wrapper 嵌在 `<a>` 内，修饰键点击由
    // 链接处理器打开 URL，这里不能再弹预览盖住导航（#3835）。复用 linkMouseEvents
    // 的选择器以覆盖所有链接变体（普通、引用、自动链接、裸 HTML 锚点）。
    private _emitImagePreview(
        event: Event,
        target: HTMLElement,
        imageWrapper: HTMLElement,
        imageInfo: IImageInfo,
    ): void {
        if (
            target.tagName !== 'IMG'
            || !(event instanceof MouseEvent)
            || !(event.metaKey || event.ctrlKey)
            || imageWrapper.closest(LINK_SELECTOR)
        ) {
            return;
        }

        const tokenSrc = imageInfo.token.src || imageInfo.token.attrs.src || '';
        const src = getImageSrc(tokenSrc).src || target.getAttribute('src') || '';
        if (src) {
            this._muya.eventCenter.emit('format-click', {
                event,
                formatType: 'image',
                data: src,
            });
        }
    }

    private _handleClickInlineImage(event: Event, imageWrapper: HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        const { eventCenter } = this._muya;
        const imageInfo = getImageInfo(imageWrapper);
        const { target } = event;
        if (!(target instanceof Node))
            return;
        const deleteContainer = isHTMLElement(target)
            ? target.closest('.mu-image-icon-close')
            : null;
        const contentDom = findContentDOM(target);

        if (!contentDom)
            return;

        const contentBlock = contentDom[BLOCK_DOM_PROPERTY] as Format;

        if (deleteContainer) {
            contentBlock.deleteImage(imageInfo);

            return;
        }

        if (isHTMLElement(target))
            this._emitImagePreview(event, target, imageWrapper, imageInfo);

        // 点击图片不再选中并浮出工具栏（见 `_revealImageSource`）。
        if (this._revealImageSource(contentBlock, imageInfo))
            return;

        if (
            imageWrapper.classList.contains(CLASS_NAMES.MU_EMPTY_IMAGE)
            || imageWrapper.classList.contains(CLASS_NAMES.MU_IMAGE_FAIL)
        ) {
            const rect = imageWrapper.getBoundingClientRect();
            const reference = {
                getBoundingClientRect: () => rect,
                width: imageWrapper.offsetWidth,
                height: imageWrapper.offsetHeight,
            };
            eventCenter.emit('muya-image-selector', {
                block: contentBlock,
                reference,
                imageInfo,
            });
        }
    }
}

export default ImageSelection;
