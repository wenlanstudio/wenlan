import type { VNode } from 'snabbdom';
import type Format from '../../block/base/format';
import type { IImageSelectionData, IRenderCursor } from '../../selection/types';
import type { H, ImageToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';
import DeleteIcon from '../../assets/icons/delete/2.png';
import ImageIcon from '../../assets/icons/image/2.png';
import ImageFailIcon from '../../assets/icons/image_fail/2.png';
import { CLASS_NAMES } from '../../config';
import { getImageSrc, usesDefaultObjectSize } from '../../utils/image';

function renderIcon(h: H, className: string, icon: string) {
    // A `<span>`, not an `<a>`: these hover controls carry no href, and an `<a>`
    // here nests illegally when the image sits inside a real anchor (e.g. a
    // reference-linked image `[![alt](img)][ref]`). The HTML parser closes the
    // outer anchor early on the nested `<a>`, hoisting the image out of the link
    // (#4865).
    const selector = `span.${className}`;
    const iconVNode = h(
        'i.icon',
        h(
            'i.icon-inner',
            {
                style: {
                    'background': `url(${icon}) no-repeat`,
                    'background-size': '100%',
                },
            },
            '',
        ),
    );

    return h(selector, iconVNode);
}

function shouldSyncSelectedImageId(
    selectedImage: IImageSelectionData | null,
    src: string,
    id: string,
): selectedImage is IImageSelectionData {
    return (
        !!selectedImage
        && selectedImage.token.attrs.src === src
        && selectedImage.imageId !== id
    );
}

function isSmallImage(
    naturalWidth: number | undefined,
    naturalHeight: number | undefined,
) {
    return (
        typeof naturalWidth === 'number'
        && typeof naturalHeight === 'number'
        && (naturalWidth < 100 || naturalHeight < 100)
    );
}

function isImageSelected(
    selectedImage: IImageSelectionData | null,
    block: Format,
    token: ImageToken,
    id: string,
) {
    if (!selectedImage)
        return false;

    const { imageId, block: selectedBlock, token: selectedToken } = selectedImage;

    return (
        imageId === `${id}_${token.range.start}`
        && selectedBlock === block
        && selectedToken.range.start === token.range.start
        && selectedToken.range.end === token.range.end
    );
}

// 光标/选区是否与图片 markdown 源码区间相交。
// 旧判定要求端点严格落在 `(start, end)` 开区间内——那只照顾了「点击图片落点
// end-1」这一种进入方式；拖选整段 `![alt](src)`（端点落到 token 边界甚至
// 之外）会立刻判为不相交，同一次 patch 就把代码换回图片，源码根本没法编辑
// （#13/#11）。改成区间相交：相交即视为编辑意图；光标恰好停在边界上不算
// ——文档刚打开、光标停在段首 offset 0 时，段首的图片仍直接渲染成图片。
function isCaretInImageSource(block: Format, token: ImageToken, cursor?: IRenderCursor) {
    // 空图片（`![abc]()`，插入图片后还没选文件）永远显示占位符"点击添加图片"并
    // 弹出选图工具：插入后光标就落在它里面，若这时按源码显示，占位符和选图入口
    // 就都没了。所以没有 src 的图片不进入源码编辑态。
    if (!token.attrs.src)
        return false;

    const anchor = cursor?.anchor ?? cursor?.start;
    const focus = cursor?.focus ?? cursor?.end;
    if (!anchor || !focus || (cursor?.block && cursor.block !== block))
        return false;

    const { start, end } = token.range;
    const selectionStart = Math.min(anchor.offset, focus.offset);
    const selectionEnd = Math.max(anchor.offset, focus.offset);

    return selectionStart < end && selectionEnd > start;
}

// I don't want operate dom directly, is there any better way? need help!
export default function image(
    this: Renderer,
    { h, cursor, block, token }: ISyntaxRenderOptions & { token: ImageToken },
) {
    // 源码编辑态下方的实时预览。不可编辑也不可点（pointer-events 收掉，点击
    // 落回源码文本）；src 解析复用 loadImageAsync 的缓存 URL，本地图片不会因
    // 整块 innerHTML 重建而反复走盘。
    const renderLivePreview = () => {
        const imageSrc = getImageSrc(token.attrs.src);
        const { url: resolvedUrl } = this.loadImageAsync(imageSrc, token.attrs);
        const imgData = {
            props: {
                alt: token.attrs.alt.replace(/[`*{}[\]()#+\-.!_>~:|<$]/g, ''),
                src: resolvedUrl ?? imageSrc.src,
                title: token.attrs.title,
            },
        };

        if (typeof token.attrs.width === 'string' && token.attrs.width)
            Object.assign(imgData.props, { width: token.attrs.width });

        if (typeof token.attrs.height === 'string' && token.attrs.height)
            Object.assign(imgData.props, { height: token.attrs.height });

        return h(
            `span.${CLASS_NAMES.MU_IMAGE_LIVE_PREVIEW}`,
            { attrs: { contenteditable: 'false' } },
            [h('img', imgData)],
        );
    };

    // 光标/选区与图片源码相交时（点击图片即进入该状态），把源码显示成可编辑
    // 文本，让用户直接改 `![](assets/a.png)` 这段文字；光标离开后重新渲染成
    // 图片。已定交互（#13）：源码在上，图片预览实时跟在下方——与代码型图表
    // 同构，每次按键随 token 重解析刷新。
    if (isCaretInImageSource(block, token, cursor)) {
        return [
            h(
                `span.${CLASS_NAMES.MU_IMAGE_MARKED_TEXT}`,
                this.highlight(h, block, token.range.start, token.range.end, token),
            ),
            renderLivePreview(),
        ];
    }

    const imageSrc = getImageSrc(token.attrs.src);
    const selectedImage = this.muya.editor.selection.image;
    const { i18n } = this.muya;
    const data = {
        attrs: {
            'contenteditable': 'false',
            'empty-text': i18n.t('Click to add an image'),
            'fail-text': i18n.t('Load image failed'),
        },
        dataset: {
            raw: token.raw,
        },
    };
    let id: string = '';
    let isSuccess: boolean | undefined;
    let naturalWidth: number | undefined;
    let naturalHeight: number | undefined;
    let resolvedUrl: string | undefined;
    // `src` stays the plain path — it is the key the `urlMap`/cache lookups use.
    const src = imageSrc.src;
    const alt = token.attrs.alt;
    const title = token.attrs.title;
    const width = token.attrs.width;
    const height = token.attrs.height;

    if (src) {
        ({ id, isSuccess, url: resolvedUrl, width: naturalWidth, height: naturalHeight }
            = this.loadImageAsync(imageSrc, token.attrs));
    }

    // What the rendered <img> actually points at. For local files this is the
    // cache-busted `file://?mucache=…` URL resolved by `loadImageAsync`, so a
    // block re-render (`innerHTML = html`) re-requests the busted URL instead
    // of the plain path Chromium has cached. Uploads in progress override it
    // with the base64 preview below.
    let imgSrc = resolvedUrl ?? src;

    let wrapperSelector = id
        ? `span#${isSuccess ? `${id}_${token.range.start}` : id}.${
            CLASS_NAMES.MU_INLINE_IMAGE
        }`
        : `span.${CLASS_NAMES.MU_INLINE_IMAGE}`;

    const imageIcons = [
        renderIcon(h, 'mu-image-icon-success', ImageIcon),
        renderIcon(h, 'mu-image-icon-fail', ImageFailIcon),
        renderIcon(h, 'mu-image-icon-close', DeleteIcon),
    ];

    /**
     * The image is used to wrap the img element.
     * @param args
     * @returns The wrapping span VNode containing the image element.
     */
    const renderImageContainer = (...args: VNode[]) => {
        const data = {};
        if (title) {
            Object.assign(data, {
                dataset: { title },
            });
        }

        return h(`span.${CLASS_NAMES.MU_IMAGE_CONTAINER}`, data, args);
    };

    if (typeof token.attrs['data-align'] === 'string')
        wrapperSelector += `.${token.attrs['data-align']}`;

    // Typora 习惯：图片独占整个段落时居中显示。居中只是渲染层的默认表现，
    // 不再往 markdown 里写 `data-align`，所以判据是 token 是否覆盖整段文本，
    // 而不是 md 里的属性——与文字混排的行内图片保持内联。
    if (token.range.start === 0 && token.range.end === block.text.length)
        wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_CENTERED}`;

    // the src image is still loading, so use the url Map base64.
    if (this.urlMap.has(src)) {
    // fix: it will generate a new id if the image is not loaded.
        if (shouldSyncSelectedImageId(selectedImage, src, id))
            selectedImage.imageId = id;

        imgSrc = this.urlMap.get(src)!;
        isSuccess = true;
    }

    if (alt.startsWith('loading-')) {
        wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_UPLOADING}`;
        Object.assign(data.dataset, {
            id: alt,
        });
        if (this.urlMap.has(alt)) {
            imgSrc = this.urlMap.get(alt)!;
            isSuccess = true;
        }
    }

    if (src) {
    // image is loading...
        if (typeof isSuccess === 'undefined') {
            wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_LOADING}`;
        }
        else if (isSuccess === true) {
            wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_SUCCESS}`;
            // Tag images whose natural size is below
            // 100px in either dimension. NOTE: no CSS in this package currently
            // consumes `.mu-small-image` — it is kept as a theming hook so
            // downstream stylesheets can shrink/hide the in-wrapper hover icons
            // (`.mu-image-icon-success/fail/close`, each 20×20) that visually
            // clobber a small image. The marktext original wired this class to
            // an in-wrapper `.ag-image-buttons` group that this repo doesn't
            // have (our toolbar is a floating-ui overlay), so the rule lives
            // here as data only; downstream consumers / future PRs own the
            // visual treatment.
            if (isSmallImage(naturalWidth, naturalHeight))
                wrapperSelector += `.${CLASS_NAMES.MU_SMALL_IMAGE}`;
        }
        else {
            wrapperSelector += `.${CLASS_NAMES.MU_IMAGE_FAIL}`;
        }

        // Add image selected class name.
        if (isImageSelected(selectedImage, block, token, id))
            wrapperSelector += `.${CLASS_NAMES.MU_INLINE_IMAGE_SELECTED}`;

        const renderImage = () => {
            const data = {
                props: {
                    alt: alt.replace(/[`*{}[\]()#+\-.!_>~:|<$]/g, ''),
                    src: imgSrc,
                    title,
                },
            };

            if (typeof width === 'string' && width)
                Object.assign(data.props, { width });

            if (typeof height === 'string' && height)
                Object.assign(data.props, { height });

            // Re-renders rewrite the block from these vnodes, so the width
            // `loadImageAsync` pinned on the first load has to be restated
            // here or a size-less image collapses again (#4991).
            if (!width && !height && usesDefaultObjectSize(naturalWidth, naturalHeight))
                Object.assign(data, { style: { width: `${naturalWidth}px` } });

            return h('img', data);
        };

        return isSuccess
            ? [
                    h(wrapperSelector, data, [
                        ...imageIcons,
                        renderImageContainer(
                            // An image description has inline elements as its contents.
                            // When an image is rendered to HTML, this is used as the image’s alt attribute.
                            renderImage(),
                        ),
                    ]),
                ]
            : [h(wrapperSelector, data, [...imageIcons, renderImageContainer()])];
    }
    else {
        wrapperSelector += `.${CLASS_NAMES.MU_EMPTY_IMAGE}`;

        return [h(wrapperSelector, data, [...imageIcons, renderImageContainer()])];
    }
}
