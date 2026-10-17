import deleteIcon from '../../assets/icons/image_delete/2.png';
import editIcon from '../../assets/icons/imageEdit/2.png';

// 不提供对齐按钮：对齐值只能写进 md（`<img ... data-align="center" />`），
// 会把干净的 `![](src)` 变成 HTML 标记。居中改为渲染层默认表现，见
// `inlineRenderer/renderer/image.ts` 的 `mu-image-centered`。
const icons = [
    {
        type: 'edit',
        tooltip: 'Edit Image',
        icon: editIcon,
    },
    {
        type: 'delete',
        tooltip: 'Remove Image',
        icon: deleteIcon,
    },
];

export default icons;

export type Icon = typeof icons[number];
