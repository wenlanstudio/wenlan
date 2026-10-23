- [x] 现在Word/page视图中可以输入分栏代码， Word/columns视图可以看到分栏效果； 存在一个问题：现在的分栏符在page视图中无法编辑
- [x] 现在存在两种块级分栏渲染，一种是 带中文字符的 “分栏开始”这种；一种是旧的 短实线、短虚线；把旧的给移除吧；
- [x] 以下各视图下需要支持编辑、撤销、保存等常用编辑功能，视图切换时，自动保存。（好像分栏模式编辑的时候，无法ctrl+z 撤销，无法保存）
  - word/page
  - word/columns（分栏内外都可编辑）
  - dev/md源码
  > 已通：分栏不再靠 DOM 后处理冒充，而是引擎层的真块（`columns` / `column` 块节点）。
  > 于是「只读渲染」的限制消失——栏内可编辑、Ctrl+Z / Ctrl+Y 走引擎原生撤销栈、保存即
  > `getMarkdown()`，与 page 视图共用同一份块树与同一套撤销栈（按 tab 存储）。
  > 设计依据：`packages/muya/src/utils/columns/DESIGN.md`。
  > 待办：columns 视图的工具栏 / 快捷键完整度尚未与 page 视图对齐。
- [x] 视图滚动同步
  - word/page
  - word/columns
  - ppt/slide（还未开发）
  - ppt/present（还未开发）
  - excel/tables（还未开发）
  - dev/md源码
  这些都是文本的不同视图，使他们进度同步，多视图同步滚动进度；
  已通：三个已开发的视图（word/page、word/columns、dev/md源码）共用一套锚点——内容块序号 + 源码行号 + 纯文本桥，切换视图停在同一处文档区域。
  待办：ppt/slide、ppt/present、excel/tables 尚未开发，等视图出来后再接锚点。
- [ ] 使用同一个滑块控制不同视图：
  - word/page 、word/columns 、 excel/tables（还未开发） 、dev/md源码 ： 调整页面宽度；
  - ppt/slide（还未开发） ： 调整幻灯片大小（放大缩小）
  - ppt/present（还未开发）： 幻灯片放映模式无需要滑块（）。
