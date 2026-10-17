// Key bindings for Windows.

// 键位以 Typora 为准：取值来自本机 Typora 主进程 `app.asar` 内 `atom.compiled.dist.jsc`
// 的菜单定义（字符串表实测），不是照抄文档。
//
// 与 Typora 的两处冲突已按「全部照抄 Typora」裁决：
//   - 标题占 Ctrl+1..Ctrl+6，因此取消按数字切换标签页（Typora 单文档，本无标签页），
//     只保留 Ctrl+Tab / Ctrl+Shift+Tab 循环切换。
//   - 插入表格占 Ctrl+T，新建标签页改到 Ctrl+Shift+T。
//
// NOTE: Avoid `Ctrl+Alt` and `AltGr` shortcuts on Windows because these are used to produce alternative characters.
//       Unlike Linux, `Ctrl+Alt` is an alias to `AltGr` on Windows and will produce alternative characters too.
//       We'll should try bind no keys to `Alt` "modifiers" because there are only a few key bindings available.

const keybindings: Map<string, string> = new Map([
  // MarkText menu on macOS only
  ['mt.hide', ''],
  ['mt.hide-others', ''],

  // File menu
  ['file.new-window', 'Ctrl+N'],
  // Ctrl+T 让给「插入表格」，新建标签页顺移到 Ctrl+Shift+T。
  ['file.new-tab', 'Ctrl+Shift+T'],
  ['file.open-file', 'Ctrl+O'],
  ['file.open-folder', 'Ctrl+Shift+O'],
  ['file.save', 'Ctrl+S'],
  ['file.save-as', 'Ctrl+Shift+S'],
  ['file.move-file', ''],
  ['file.rename-file', ''],
  // Ctrl+P 让给「快速打开」，打印改用 Typora 的 Shift+Alt+P。
  ['file.print', 'Shift+Alt+P'],
  ['file.preferences', 'Ctrl+,'],
  ['file.close-tab', 'Ctrl+W'],
  ['file.close-window', 'Ctrl+Shift+W'],
  ['file.quit', 'Ctrl+Q'],

  // File > Export submenu
  // Typora 的 Ctrl+E 是「导出」，此处沿用（源码模式已改到 Ctrl+/）。
  ['file.export-file.pdf', 'Ctrl+E'],

  // Edit menu
  ['edit.undo', 'Ctrl+Z'],
  ['edit.redo', 'Ctrl+Y'],
  ['edit.cut', 'Ctrl+X'],
  ['edit.copy', 'Ctrl+C'],
  ['edit.paste', 'Ctrl+V'],
  ['edit.copy-as-rich', 'Ctrl+Shift+C'],
  ['edit.copy-as-html', ''],
  ['edit.paste-as-plaintext', 'Ctrl+Shift+V'],
  ['edit.select-all', 'Ctrl+A'],
  ['edit.duplicate', 'Ctrl+Alt+D'],
  ['edit.create-paragraph', 'Ctrl+Shift+N'],
  ['edit.delete-paragraph', 'Ctrl+Shift+D'],
  ['edit.find', 'Ctrl+F'],
  ['edit.find-next', 'F3'],
  ['edit.find-previous', 'Shift+F3'],
  ['edit.replace', 'Ctrl+H'],
  ['edit.screenshot', ''], // macOS only

  // Paragraph menu
  // NOTE: 用 Ctrl+1..Ctrl+6 而不是 Ctrl+Alt+数字：Windows 上 Ctrl+Alt 是 AltGr 的别名，
  //       会打出替代字符；Ctrl+Shift+数字则被底层字符占用。Ctrl+数字是唯一可行组合。
  ['paragraph.heading-1', 'Ctrl+1'],
  ['paragraph.heading-2', 'Ctrl+2'],
  ['paragraph.heading-3', 'Ctrl+3'],
  ['paragraph.heading-4', 'Ctrl+4'],
  ['paragraph.heading-5', 'Ctrl+5'],
  ['paragraph.heading-6', 'Ctrl+6'],
  ['paragraph.upgrade-heading', 'Ctrl+Plus'],
  ['paragraph.degrade-heading', 'Ctrl+-'],
  ['paragraph.table', 'Ctrl+T'],
  ['paragraph.code-fence', 'Ctrl+Shift+K'],
  ['paragraph.quote-block', 'Ctrl+Shift+Q'],
  ['paragraph.math-formula', 'Ctrl+Alt+N'],
  ['paragraph.html-block', 'Ctrl+Alt+H'],
  ['paragraph.order-list', 'Ctrl+G'],
  ['paragraph.bullet-list', 'Ctrl+H'],
  ['paragraph.task-list', 'Ctrl+Alt+X'],
  ['paragraph.loose-list-item', 'Ctrl+Alt+L'],
  ['paragraph.paragraph', 'Ctrl+0'],
  ['paragraph.horizontal-line', 'Ctrl+Shift+U'],
  ['paragraph.front-matter', 'Ctrl+Alt+Y'],

  // Format menu
  ['format.strong', 'Ctrl+B'],
  ['format.emphasis', 'Ctrl+I'],
  ['format.underline', 'Ctrl+U'],
  ['format.superscript', ''],
  ['format.subscript', ''],
  ['format.highlight', 'Ctrl+Shift+H'],
  ['format.inline-code', 'Ctrl+`'],
  ['format.inline-math', 'Ctrl+Shift+M'],
  ['format.strike', 'Ctrl+D'],
  // Typora 的 Ctrl+K 是插入链接，Ctrl+L 让位（原为 Ctrl+L）。
  ['format.hyperlink', 'Ctrl+K'],
  ['format.image', 'Ctrl+Shift+I'],
  ['format.clear-format', 'Ctrl+\\'],

  // Window menu
  ['window.minimize', 'Ctrl+M'],
  ['window.toggle-always-on-top', ''],
  ['window.zoomIn', ''],
  ['window.resetZoom', ''],
  ['window.zoomOut', ''],
  ['window.toggle-full-screen', 'F11'],

  // View menu
  ['view.command-palette', 'Ctrl+Shift+P'],
  ['view.source-code-mode', 'Ctrl+/'],
  ['view.typewriter-mode', 'Ctrl+Shift+G'],
  ['view.focus-mode', 'Ctrl+Shift+J'],
  // Typora：Ctrl+Shift+1 大纲、Ctrl+Shift+2 文件树。
  ['view.toggle-sidebar', 'Ctrl+Shift+2'],
  ['view.toggle-toc', 'Ctrl+Shift+1'],
  ['view.toggle-dev-tools', 'Ctrl+Alt+I'],
  ['view.dev-reload', 'Ctrl+F5'],
  ['view.reload-images', 'F5'],

  // ======== Not included in application menu ========================
  // 按数字直切标签页已取消：Ctrl+1..Ctrl+6 归标题，Ctrl+7..Ctrl+0 一并清空，
  // 避免同一套数字键一半是标题一半是标签页。
  ['tabs.cycleForward', 'Ctrl+Tab'],
  ['tabs.cycleBackward', 'Ctrl+Shift+Tab'],
  ['tabs.switchToLeft', ''],
  ['tabs.switchToRight', ''],
  ['tabs.switchToFirst', ''],
  ['tabs.switchToSecond', ''],
  ['tabs.switchToThird', ''],
  ['tabs.switchToFourth', ''],
  ['tabs.switchToFifth', ''],
  ['tabs.switchToSixth', ''],
  ['tabs.switchToSeventh', ''],
  ['tabs.switchToEighth', ''],
  ['tabs.switchToNinth', ''],
  ['tabs.switchToTenth', ''],
  ['file.quick-open', 'Ctrl+P']
])

export default keybindings
