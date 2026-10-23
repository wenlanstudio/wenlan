- [ ] 现在Word/page视图中可以输入分栏代码， Word/columns视图可以看到分栏效果； 存在一个问题：现在的分栏符在page视图中无法编辑
- [ ] 现在存在两种块级分栏渲染，一种是 带中文字符的 “分栏开始”这种；一种是旧的 短实线、短虚线；把旧的给移除吧；

- [ ] txt文本的不同视图
  - word/page
  - word/columns
  - ppt/slide（还未开发）
  - ppt/present（还未开发）
  - excel/tables（还未开发）
  - dev/md源码
  这些都是txt的不同视图，能不能让他们进度同步，多视图同步滚动进度，屏幕显示的是文档的近似同一区域
- [ ] 同一滑块
  能不能都使用同一个滑块，但是不同视图下的滑块作用不同，
  - word/page 、word/columns 、 excel/tables（还未开发） 、dev/md源码 ： 调整页面宽度；
  - ppt/slide（还未开发） ： 调整幻灯片大小
  - ppt/present（还未开发）： 幻灯片播放模式就没有滑块的概念了。


- [ ] 现在word/page和word/columns的页宽是同步的，但是word/columns无页宽滚动滑块，word/columns也显示页宽调整滑块吧
- [ ]
    <div class="el-tree-node is-expanded is-focusable" role="treeitem" tabindex="-1" aria-expanded="true" aria-disabled="" aria-checked="false" draggable="false" data-key="17-局限与延伸直方图-vs-核密度估计"><div class="el-tree-node__content" style="padding-left: 20px;"><i class="el-icon el-tree-node__expand-icon is-leaf"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><path fill="currentColor" d="M340.864 149.312a30.59 30.59 0 0 0 0 42.752L652.736 512 340.864 831.872a30.59 30.59 0 0 0 0 42.752 29.12 29.12 0 0 0 41.728 0L714.24 534.336a32 32 0 0 0 0-44.672L382.592 149.376a29.12 29.12 0 0 0-41.728 0z"></path></svg></i><!--v-if--><!--v-if--><!-- eslint-disable vue/no-v-html -- sanitized by labelHtmlOf --><span class="el-tree-node__label" title="1.7 局限与延伸：直方图 vs 核密度估计">1.7 局限与延伸：直方图 vs 核密度估计</span><!-- eslint-enable vue/no-v-html --></div><div class="el-tree-node__children" role="group" aria-expanded="true"></div></div>
    将
    side-bar-toc .el-tree-node {
        margin-top: 8px;
    }
    给清除吧
