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
- [ ] 视图滚动同步基本完成
  - word/page
  - word/columns
  - ppt/slide（还未开发）
  - ppt/present（还未开发）
  - excel/table（还未开发）
  - dev/md源码
  这些都是文档的不同视图，使他们多视图同步滚动进度（现在有bug，请重做这个功能吧）

- [ ] 视图切换时，尽量避免重绘
    - 以word/page为基础：
      - word/columns模式：是对word/page已经渲染的带分栏标签的的重新组合；
      - ppt/slide模式：相当于在word/columns基础上加了分割线；
      - Ppt/present模式：相当于隐藏了ppt/slide视口外的其他slide；
      - excel/table模式：相当于将word/page的页面除table外的元素都隐藏了；
      - image/gallery模式：相当于将word/page的页面除图表外的元素都隐藏了；
      - image/image模式：相当于隐藏了ppt/gallery视口外的其他image；
      这样的话，在各模式都可以编辑
    > 这样是不是就意味着很多地方都不用重绘了；

- [x] 使用同一个滑块控制不同视图：
  - word/page 、word/columns 、 excel/tables（还未开发） 、dev/md源码 ： 调整页面宽度；
  - ppt/slide（还未开发） ： 调整幻灯片大小（放大缩小）
  - ppt/present（还未开发）： 幻灯片放映模式无需要滑块（）。
  > 已通：滑块的职责收进 `editorView` store 的视图元数据（`slider` 字段 +
  > `sliderDuty` 计算属性）：word/page、word/columns、dev/source 均为
  > `page-width`，右下角滑块在这三个视图显示并共用 `editorLineWidth` 偏好；
  > 页宽样式改由常驻的 app.vue 应用（此前只在 word/page 挂载时应用，直接以
  > 分栏/源码视图启动的窗口会丢失偏好）。未开发的视图接入方式：在
  > `MAIN_VIEW_META` 里把对应子视图 `implemented` 置 true 即可——excel/sheet
  > 声明为 `page-width`，ppt/slide 声明为 `slide-zoom`（滑块含义为缩放，
  > 待该视图落地时接线），ppt/present 声明为 `none`（不显示滑块）。
