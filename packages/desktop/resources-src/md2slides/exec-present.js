"use strict";

/**
 * exec-present.js — 「示」视图放映中运行代码块：deck 页面侧执行桥。
 *
 * 归属：运行在 md2slides 的 deck.html 里（与 deck-full.js 同源），由
 * scripts/sync-md2slides.mjs 注入 <script> 并拷入 gitignored 资源包。
 * **不要手改 packages/desktop/resources/ 下的副本**——那是生成物。
 *
 * 分工（三层，跨源 iframe 决定的）：
 *   本文件：装饰 ▶、结果浮层、输入隔离、postMessage 客户端；零 Node / 零引擎依赖。
 *   Vue 宿主 deckPane.vue：唯一拿得到 docPath 的一层，转 window.mdcode2run IPC。
 *   main 进程：registry 单例引擎 + 子进程（已有，本次零改动）。
 *
 * 行号与连接口径（关键，#18）：deck 的 <pre data-src-start="N"> 中 N 是围栏开栏
 * 行 **1 基**——但那是 md2slides **compose 后文本**上的行号：front-matter 被
 * bodyOf 剥掉（整体提前 F 行）、正文里的「A；B；C。」被 splitSemicolons 展开成
 * 列表（推后 K 行）；而宿主 capability 的 blocks 行号是 **原始 md** 的 0 基行号。
 * 两套坐标系一有 front-matter/分号段就对不上——旧行号包含匹配会把 ▶ 挂到隔壁
 * 围栏上，引擎跑错块（hive 报错只是症状）。所以 pre→块 的连接改按 **内容**：
 * blocks 带围栏体正文 code（宿主 deckPane 从原始 md 切出，与引擎执行体同构），
 * ① 整块 pre 正文与 code 全等；② 分页续片（正文 = code 的整行子串）取行号距离
 * 最近者消歧；③ 宿主没带 code / 内容对不上时退回旧行号区间包含兜底。匹配到的
 * 块开栏行 b.line 发回宿主——与引擎 locate({line}) 的 **0 基** 区间同口径。
 *
 * 契约：
 *   宿主→页  md2s:exec-capability { docPath, enabled, blocks:[{line,end,runnable,lang,job,code}] }
 *   页→宿主  md2s:exec { reqId, docPath, line }
 *   宿主→页  md2s:exec-state { reqId, event } / md2s:exec-result { reqId, result }
 *            / md2s:exec-error { reqId, error }
 *   页→宿主  md2s:exec-stop { reqId, docPath, jobId } / md2s:exec-cancel { reqId }
 *   宿主→页  md2s:export（已有）→ 顺手关浮层，别让结果条留在出片里
 *   宿主→页  md2s:follow { page, locked } —— 课堂跟随：对齐到老师那一页；
 *            locked 时吃掉导航键（学生端只读跟随）。与 ▶ 桥同源：跨源宿主
 *            只有本文件能直调 window.deckFull.getPlayer()。
 *
 * 安全：▶ 等于在本机执行任意代码。首次对某文档点 ▶ 先在浮层里确认一次，
 * 确认结果按 docPath 记在 sessionStorage（本次会话有效）；未保存文档由宿主
 * 下发 enabled:false，根本不注入 ▶。
 */
(function () {
  var CSS_ID = "md2s-exec-css";
  var CONFIRM_KEY = "md2s-exec-confirmed";
  var MAX_STREAM = 20000;
  var KIND_LABEL = { figure: "图形", table: "表格", text: "输出", none: "无返回值", job: "作业" };

  /* 结果浮层 = 居中覆盖的「半透明深色玻璃卡片」：形态参考 Typora 旧版
     code-exec/deck-out.js（#0d1117 / 圆角 10px / 状态条 / ✕ 收起），但背景半透明 +
     backdrop-filter，让被盖住的代码仍透得出来；◐ 可在三档透明度间循环。
     内部颜色/背景仍全部显式钉死，主题的 table/pre 样式不会渗进来。 */
  var EXEC_CSS = [
    ".md2s-exec-run { position: absolute; top: 6px; right: 10px; z-index: 30; cursor: pointer;",
    "  font-size: 1em; line-height: 1; padding: 0.15em 0.5em; color: #e6e6e6; opacity: 0.85;",
    "  background: rgba(30, 30, 30, 0.88); border: 1px solid #3c3c3c; border-radius: 0.25em;",
    "  user-select: none; }",
    ".md2s-exec-run:hover { opacity: 1; color: #ff9d2e; border-color: #ff9d2e; }",
    ".md2s-exec-run.md2s-step-current { opacity: 1; color: #ff6a3c; border-color: #ff6a3c;",
    "  box-shadow: 0 0 0.4em rgba(255, 190, 40, 0.75); }",
    ".md2s-exec-overlay { position: fixed; top: 7%; left: 7%; right: 7%; bottom: 7%; z-index: 100000;",
    "  display: flex; flex-direction: column; max-height: none;",
    "  background: rgba(13, 17, 23, 0.68); color: #d1d5db;",
    "  border: 1px solid rgba(90, 100, 115, 0.55); border-radius: 10px;",
    "  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);",
    /* 模糊压到 2px：6px 会把背后的代码糊成光斑，「透出来」等于没透（真浏览器截图实测）。 */
    "  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);",
    "  font-size: 13px; overflow: hidden; }",
    "/* ◐ 三档透明度：1=默认 68%（代码可辨），0=52% 更通透，2=94% 结果优先。 */",
    ".md2s-exec-overlay.md2s-exec-alpha-0 { background: rgba(13, 17, 23, 0.52);",
    "  backdrop-filter: blur(1px); -webkit-backdrop-filter: blur(1px); }",
    ".md2s-exec-overlay.md2s-exec-alpha-2 { background: rgba(13, 17, 23, 0.94);",
    "  backdrop-filter: none; -webkit-backdrop-filter: none; }",
    "/* 分栏态：代码与结果并排、互不遮挡，强制实心免得两层文字打架。 */",
    ".md2s-exec-overlay.md2s-exec-split { left: auto; right: 0; top: 0; bottom: 0; width: 44%;",
    "  max-height: 100%; border-radius: 0; border-top: none; border-right: none; border-bottom: none;",
    "  background: rgba(13, 17, 23, 0.97) !important;",
    "  backdrop-filter: none; -webkit-backdrop-filter: none; }",
    "section.md2s-exec-split { padding-right: 46% !important; }",
    ".md2s-exec-head { flex: none; display: flex; align-items: center; gap: 8px;",
    "  padding: 6px 10px; background: rgba(30, 34, 42, 0.86);",
    "  border-bottom: 1px solid #21262d; cursor: default; }",
    ".md2s-exec-title { font-weight: 600; color: #eee; }",
    ".md2s-exec-session { color: #9cdcfe; }",
    ".md2s-exec-status { margin-left: auto; color: #9cdcfe; font-variant-numeric: tabular-nums; }",
    ".md2s-exec-status.md2s-exec-busy { color: #f0a868; }",
    ".md2s-exec-status.md2s-exec-ok { color: #6ad08b; }",
    ".md2s-exec-status.md2s-exec-fail { color: #f48771; }",
    ".md2s-exec-close { cursor: pointer; color: #bbb; padding: 0 4px; }",
    ".md2s-exec-close:hover { color: #fff; }",
    "/* 焦点遍历的可见性：翻页笔走到的头钮要有圈，不然投影上看不出焦点在哪。 */",
    ".md2s-exec-head [tabindex='-1']:focus { outline: 1px solid #7ab3d9; outline-offset: 2px; }",
    ".md2s-exec-splitbtn { cursor: pointer; color: #bbb; padding: 0 6px; font-size: 1.1em; }",
    ".md2s-exec-splitbtn:hover { color: #fff; }",
    ".md2s-exec-splitbtn.md2s-exec-on { color: #ff9d2e; }",
    ".md2s-exec-alphabtn { cursor: pointer; color: #bbb; padding: 0 6px; font-size: 1.1em; }",
    ".md2s-exec-alphabtn:hover { color: #fff; }",
    ".md2s-exec-alphabtn.md2s-exec-on { color: #9cdcfe; }",
    ".md2s-exec-stop { cursor: pointer; color: #f48771; padding: 0 4px; }",
    ".md2s-exec-body { flex: 1 1 auto; overflow: auto; padding: 8px 12px; }",
    ".md2s-exec-body pre { margin: 0 0 8px; font-family: Consolas, monospace;",
    "  line-height: 1.5; white-space: pre-wrap; word-break: break-word;",
    "  color: #d4d4d4 !important; background: transparent !important; }",
    ".md2s-exec-error { color: #f48771 !important; }",
    ".md2s-exec-note { color: #9aa4b2 !important; }",
    ".md2s-exec-body img { display: block; max-width: 100%; background: #fff; border-radius: 4px; margin: 6px 0; }",
    ".md2s-exec-body table { border-collapse: collapse !important; margin: 6px 0; font-size: 0.95em;",
    "  background: rgba(13, 17, 23, 0.35) !important; color: #d1d5db !important; }",
    ".md2s-exec-body th, .md2s-exec-body td { border: 1px solid #30363d !important;",
    "  padding: 0.3em 0.9em; text-align: left; }",
    "/* !important 压过 renderTable 里跟随主题的内联底色，整张表也透得出代码。 */",
    ".md2s-exec-body th { background: rgba(42, 47, 56, 0.9) !important; }",
    ".md2s-exec-body td { color: #d4d4d4 !important; background: transparent !important; }",
    ".md2s-exec-body .md2s-exec-null { color: #6a737d !important; }",
    ".md2s-exec-confirm { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;",
    "  padding: 4px 0 10px; color: #e8c98a !important; }",
    ".md2s-exec-confirm span { flex: 1 1 240px; }",
    ".md2s-exec-confirm button { flex: none; border: 1px solid #ba7517; border-radius: 4px;",
    "  padding: 4px 14px; background: #3a2a12; color: #ffd79a; font-size: 0.95em; cursor: pointer; }",
    ".md2s-exec-confirm button:hover { background: #543c17; }"
  ].join("\n");

  var capability = { docPath: "", enabled: false, blocks: [] };
  var overlay = null;    // 当前浮层控制器（单例）
  var activeRun = null;  // { reqId, line, docPath, started, ... }
  var reqSeq = 0;
  var thStyle = null;

  var post = function (msg) {
    try { window.parent.postMessage(msg, "*"); } catch (e) { /* 宿主已卸载 */ }
  };

  /** 过滤 JShell 变量声明回显（s1 ==> "apple"）——纯展示层，不动引擎日志。 */
  var stripVarEcho = function (s) {
    return (s == null ? "" : String(s)).split(/\r?\n/)
      .filter(function (line) { return !/^\s*(?:\|\s*)?[\w$.]+\s*==>/.test(line); })
      .join("\n");
  };

  var confirmedList = function () {
    try {
      var v = JSON.parse(window.sessionStorage.getItem(CONFIRM_KEY) || "[]");
      return Object.prototype.toString.call(v) === "[object Array]" ? v : [];
    } catch (e) { return []; }
  };
  var isConfirmed = function (docPath) { return confirmedList().indexOf(docPath) >= 0; };
  var markConfirmed = function (docPath) {
    try {
      var list = confirmedList();
      if (list.indexOf(docPath) < 0) list.push(docPath);
      window.sessionStorage.setItem(CONFIRM_KEY, JSON.stringify(list));
    } catch (e) { /* 隐私模式下退化为每次都确认，不影响功能 */ }
  };

  var injectCss = function () {
    if (document.getElementById(CSS_ID)) return;
    var style = document.createElement("style");
    style.id = CSS_ID;
    style.textContent = EXEC_CSS;
    document.head.appendChild(style);
  };

  /** 表头跟随主题：量 deck 里真实 th 的渲染值，量不到回退深灰。 */
  var measureTh = function () {
    try {
      var sample = document.querySelector("section th");
      var cs = sample && window.getComputedStyle(sample);
      var bg = cs && cs.backgroundColor;
      if (sample && bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        thStyle = { bg: bg, fg: cs.color || "#eee" };
      }
    } catch (e) { /* 无布局环境保持回退 */ }
  };

  // ── 装饰 ────────────────────────────────────────────────────────────────

  /* pre → 块 的连接（内容优先，行号兜底）。理由见文件头「行号与连接口径」。 */
  var normCode = function (s) {
    return String(s == null ? "" : s).replace(/\r\n/g, "\n").replace(/\s+$/, "");
  };
  /* 整行子串：命中处左边界是串首或 \n、右边界是串尾或 \n——续片是围栏体的
     连续整行切片（md2slides overflow.js 逐行搬 textContent），松 indexOf 会把
     行中片段也算进去。 */
  var containsLineSlice = function (body, slice) {
    var i = body.indexOf(slice);
    while (i >= 0) {
      var before = i === 0 ? "\n" : body.charAt(i - 1);
      var after = i + slice.length >= body.length ? "\n" : body.charAt(i + slice.length);
      if (before === "\n" && after === "\n") return true;
      i = body.indexOf(slice, i + 1);
    }
    return false;
  };
  var matchBlock = function (blocks, content, srcLine) {
    var c = normCode(content);
    if (!c) return null;
    var i, b, bc, d, best = null, bestDist = Infinity;
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      if (b.code != null && normCode(b.code) === c) return b;
    }
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      if (b.code == null) continue;
      bc = normCode(b.code);
      if (bc && bc !== c && containsLineSlice(bc, c)) {
        d = Math.abs(srcLine - b.line);
        if (d < bestDist) { best = b; bestDist = d; }
      }
    }
    if (best) return best;
    for (i = 0; i < blocks.length; i++) {
      b = blocks[i];
      if (srcLine >= b.line && srcLine < b.end) return b;
    }
    return null;
  };

  var makeBtn = function (extraClass, text, title, onClick) {
    var el = document.createElement("div");
    el.className = "md2s-exec-run" + (extraClass ? " " + extraClass : "");
    el.textContent = text;
    el.title = title;
    // player 的 P4-a 契约：Enter / activate() 派发 click，翻页笔可逐元素走到 ▶。
    el.setAttribute("data-md2s-activatable", "");
    el.addEventListener("click", function (ev) { ev.stopPropagation(); onClick(); });
    return el;
  };

  /* ── 逐行运行（2026-11-17 拍板）────────────────────────────────────────
   * 代码块行粒度遍历（front-matter stepLines: true）时，会话族（java/python 有
   * 常驻 REPL、逐行追加共享变量；2026-11-24 起 bash/shell/powershell 也升级为
   * 常驻会话族，逐行=喂单行进活会话）的行挂 data-md2s-run-line：翻页笔走到该行、
   * 按 Enter，player 的 activate() 命中行并派发 click，这里接手 → 只执行该行。
   * 一次性族（mysql/hive/query）只逐行遍历、不逐行运行——行照常挂
   * run-line 但委托判定非 lineable 就忽略（翻页笔点它不运行，保留整块 ▶）。
   * 用独立属性 run-line 而非 activatable：行是内容，得进 IR/PPTX，activatable
   * 会被导出的 skipSelector 误删。
   *
   * ── 两栏活格（`python short`，2026-11-27 v2 定稿）──────────────────────
   * 构建期 pre 收窄为左列（kit/shortCode v2，不注入任何格子——无输出行零占用），
   * 右侧留白是版面的一部分。放映期本桥在页内造**绝对定位结果浮层**
   * （.md2s-short-zone，盖在留白上，不改文档流 → 页几何恒定），每行执行结果
   * 落成一张 .md2s-short-res 卡片：按内容自适配、自上而下堆叠、超留白区按份
   * 压帽；无输出的行只落一枚压缩到行高的「✓ 已执行」薄卡（有输出的利用无输出
   * 的空间——用户裁决 2026-11-27）。▶ 整块 = sweep：清浮层后从第 0 行依次喂
   * 引擎、结果逐卡落位。matchBlock 的内容匹配只读行 span（跑过之后
   * code.textContent 若混入卡片文本会连不上块——short 块按行拼回原文）。
   */
  var LINEABLE_FAMILIES = { java: 1, python: 1, shell: 1, powershell: 1 };

  /** short 块的行文本按行 span 拼（卡片在浮层里、不在 code 内，通常无需兜底）。 */
  var codeTextOf = function (code) {
    var spans = code.querySelectorAll(".code-line");
    if (!spans.length) return code.textContent;
    var parts = [];
    for (var i = 0; i < spans.length; i++) parts.push(spans[i].textContent);
    return parts.join("\n");
  };

  /** 行（.code-line）→ 它所在的 pre + 行号（0 基） + 匹配到的 capability 块。 */
  var resolveRunLine = function (lineEl) {
    var pre = lineEl.closest ? lineEl.closest("pre") : null;
    if (!pre) return null;
    var code = pre.querySelector("code");
    if (!code) return null;
    var lineEls = code.querySelectorAll(".code-line");
    var idx = Array.prototype.indexOf.call(lineEls, lineEl);
    if (idx < 0) return null;
    var srcLine = Number(pre.getAttribute("data-src-start"));
    if (!isFinite(srcLine) || srcLine <= 0) srcLine = 1;
    var block = matchBlock(capability.blocks, codeTextOf(code), srcLine - 1);
    if (!block) return null;
    return { block: block, lineOffset: idx, pre: pre, lineEl: lineEl };
  };

  /* ── 结果浮层（两栏活格专用）──────────────────────────────────────────
   * 每个改造块一区（zone = section 内绝对定位，盖在 pre 右侧留白上）。卡片状态
   * 类：md2s-short-busy（脉冲）/ -done（跑过；空结果=✓ 薄卡）/ -error（红字）/
   * -cur（当前行结果全亮，A 模式聚焦淡化）。 */
  var zoneOf = function (pre) {
    var sec = pre.closest ? pre.closest("section") : null;
    if (!sec) return null;
    var tag = String(Number(pre.getAttribute("data-src-start")) || 0);
    var zone = sec.querySelector(":scope > .md2s-short-zone[data-pre-md2s-line='" + tag + "']");
    if (!zone) {
      zone = document.createElement("div");
      zone.className = "md2s-short-zone";
      zone.setAttribute("data-pre-md2s-line", tag);
      try {
        if (window.getComputedStyle(sec).position === "static") sec.style.position = "relative";
      } catch (e) { sec.style.position = "relative"; }
      sec.appendChild(zone);
    }
    // 几何每次重算（幂等）：decorate 时块所在页多半 display:none（rect 全 0），
    // 只能等页可见后的首次运行/翻页来标定——量不到就保留旧值，绝不写 0。
    var secRect = sec.getBoundingClientRect();
    var preRect = pre.getBoundingClientRect();
    if (preRect.width > 0 && secRect.width > 0) {
      var ratio = secRect.width > 0 && sec.clientWidth > 0 ? secRect.width / sec.clientWidth : 1;
      var cs = window.getComputedStyle(sec);
      var padR = parseFloat(cs.paddingRight) || 0;
      var padB = parseFloat(cs.paddingBottom) || 0;
      zone.style.left = (preRect.right - secRect.left) / ratio + 28 + "px";
      zone.style.top = (preRect.top - secRect.top) / ratio + "px";
      zone.style.right = (padR + 6) + "px";
      zone.style.bottom = (padB + 6) + "px";
    }
    return zone;
  };

  var SHORT_MAX_TEXT = 400;

  /** 无输出行（import/赋值）的「已执行」落点在左列行尾（✓ 角标），右侧零占用
   *  ——用户裁决 2026-11-27：无输出行不配在右边占空间，有输出的利用无输出的空间。 */
  var markLineDone = function (hit) {
    if (hit.lineEl) hit.lineEl.classList.add("md2s-line-done");
  };
  var clearLineDone = function (pre) {
    Array.prototype.forEach.call(pre.querySelectorAll(".code-line.md2s-line-done"), function (el) {
      el.classList.remove("md2s-line-done");
    });
  };

  /** 卡片按行号有序插入（行序 = 语义序）；已有同线卡则复用。 */
  var cardOf = function (zone, lineIdx) {
    var found = zone.querySelector(".md2s-short-res[data-line='" + lineIdx + "']");
    if (found) return found;
    var card = document.createElement("div");
    card.className = "md2s-short-res";
    card.setAttribute("data-line", String(lineIdx));
    // 豁免属性（kit/shortCode.CELL_ATTR 同字面量）：IR skipSelector 与图片导出
    // 隐藏都认它——卡片是放映期 UI，导出必须零渗漏。
    card.setAttribute("data-md2s-short-cell", "");
    // v2.2：不放「行 N」章——卡片顺序即行序，chip 白占高度（用户裁决）。
    var out = document.createElement("span");
    out.className = "md2s-short-out";
    card.appendChild(out);
    var next = null;
    var cards = zone.querySelectorAll(".md2s-short-res[data-line]");
    for (var i = 0; i < cards.length; i++) {
      if (Number(cards[i].getAttribute("data-line")) > lineIdx) { next = cards[i]; break }
    }
    zone.insertBefore(card, next);
    return card;
  };

  /** 卡片回填：状态类 -busy/-done/-error、A 模式聚焦淡化（当前行卡片全亮）、
   *  表格分支优先（引擎对 kind=table 也带 images[0]，figure 判定必须排后——
   *  真机首跑抓过表格被拦成「已出图」注记）、文本截断。 */
  var fillCard = function (zone, lineIdx, result) {
    var card = cardOf(zone, lineIdx);
    var out = card.querySelector(".md2s-short-out");
    card.classList.remove("md2s-short-busy", "md2s-short-error");
    Array.prototype.forEach.call(zone.querySelectorAll(".md2s-short-res"), function (c) {
      c.classList.toggle("md2s-short-cur", c === card);
    });
    out.textContent = "";
    out.innerHTML = "";
    if (!result) { packZone(zone); return }
    if (!result.ok) {
      card.classList.add("md2s-short-error");
      var msg = String(result.error || "执行失败").split("\n").pop() || "执行失败";
      out.textContent = msg.length > SHORT_MAX_TEXT ? msg.slice(0, SHORT_MAX_TEXT) + "…" : msg;
      card.classList.add("md2s-short-done");
      packZone(zone);
      return;
    }
    card.classList.add("md2s-short-done");
    if (result.rows && (result.rows.columns || []).length) {
      // 表格走**原生 HTML**（引擎出规格不画图，matplotlib 依赖解除——2026-11-27
      // 用户裁决）。renderTable 与 ▶ 面板同源；行数帽 8，超出部分靠 tfoot 计数。
      var tbl = renderTable(result.rows, 8);
      tbl.classList.add("md2s-short-table");
      out.appendChild(tbl);
      if (result.note) {
        var tn = document.createElement("div");
        tn.className = "md2s-short-note";
        tn.textContent = result.note;
        out.appendChild(tn);
      }
      packZone(zone);
      return;
    }
    if (result.kind === "table" && (result.images || []).length === 1) {
      // 老引擎兜底（PNG 表格）：解码异步，onload 再排一次。
      var img = document.createElement("img");
      img.src = result.images[0];
      img.onload = function () { packZone(zone) };
      out.appendChild(img);
      packZone(zone);
      return;
    }
    if (result.kind === "figure" || (result.images || []).length) {
      var fig = document.createElement("span");
      fig.className = "md2s-short-fig";
      fig.textContent = "已出图 ×" + ((result.images || []).length || 1) + "（面板查看）";
      out.appendChild(fig);
      packZone(zone);
      return;
    }
    var text = String(result.text || result.stdout || "").trim();
    if (text) {
      out.textContent = text.length > SHORT_MAX_TEXT
        ? text.slice(0, SHORT_MAX_TEXT) + "\n…" : text;
    }
    packZone(zone);
  };

  /** 结果分配（内容感知，2026-11-27 用户裁决「有输出的利用无输出的空间」）：
   *  浮层里只有内容卡（无输出行零占用——✓ 在左列行尾）；文本卡给自然高（封顶
   *  ~3.5 行）；表格卡按「满宽时的自然显示高」申报需求——总需求 ≤ 留白区就原样
   *  给（留白优先，绝不硬撑），超了才按比例缩；再按真实溢出二次收敛两轮——
   *  「绝不裁内容、绝不撑页」不靠猜，靠量。 */
  var packZone = function (zone) {
    var cards = Array.prototype.slice.call(zone.querySelectorAll(".md2s-short-res"));
    if (!cards.length) return;
    var H = zone.clientHeight;
    if (H <= 0) return;
    var rowGap = parseFloat(window.getComputedStyle(zone).rowGap) || 0;
    var used = rowGap * Math.max(0, cards.length - 1);   // 卡间距是真实开销
    var wants = [];
    Array.prototype.forEach.call(cards, function (c) {
      var out = c.querySelector(".md2s-short-out");
      if (!out) return;
      var img = out.querySelector("img");
      var tbl = out.querySelector("table");
      var natural;
      if (img) {
        natural = img.naturalHeight > 0 && img.naturalWidth > 0
          ? Math.round(out.clientWidth * img.naturalHeight / img.naturalWidth)
          : 120;
      } else if (tbl) {
        // 表格卡：自然内容高（scrollHeight 含被 maxHeight 钳住的部分），帽 600 防失控
        natural = Math.min(out.scrollHeight, 600);
      } else {
        natural = Math.min(Math.max(out.scrollHeight, 20), 84);   // 文本卡封顶 ~3.5 行
      }
      wants.push({
        card: c, out: out, img: img, tbl: !!tbl,
        natural: Math.max(40, natural),
        chrome: 12,   // 无 chip（v2.2）：只剩卡内边距+边框
      });
    });
    var chromeSum = 0;
    var sum = 0;
    Array.prototype.forEach.call(wants, function (w) {
      chromeSum += w.chrome;
      sum += w.natural;
    });
    var avail = Math.max(120, H - used - chromeSum);
    var k = sum > avail ? avail / sum : 1;   // 超了才缩；不超原样给（留白优先）
    Array.prototype.forEach.call(wants, function (w) {
      var cap = Math.max(40, Math.floor(w.natural * k));
      if (w.tbl) {
        // 表格卡：out 定高盒，表 height:100% 撑满（行随高均摊，满卡观感）
        w.out.style.height = cap + "px";
        w.out.style.maxHeight = cap + "px";
      } else {
        w.out.style.maxHeight = cap + "px";
        if (w.img) w.img.style.maxHeight = Math.max(24, cap - 4) + "px";
      }
    });
    // 二次实测收敛：常数估不准的部分用真实溢出量等比收掉，三轮封顶。削减只从
    // 可收缩卡（maxHeight 高于地板）扣——已到地板的卡（一行文本）扣不动，摊派
    // 给它们只会白轮空转、把贴底裁切留着（真机行6 抓到）。
    // 溢出即标 clipped（CSS 底部渐隐）——「下面还有」比硬裁半行体面。
    var markClipped = function () {
      zone.querySelectorAll(".md2s-short-res").forEach(function (c) { c.classList.remove("md2s-short-clipped") });
      zone.querySelectorAll(".md2s-short-res").forEach(function (c) {
        var o = c.querySelector(".md2s-short-out");
        if (o && o.scrollHeight > o.clientHeight + 1) c.classList.add("md2s-short-clipped");
      });
    };
    try { markClipped() } catch (e) {}
    for (var round = 0; round < 3 && zone.scrollHeight > zone.clientHeight + 1; round++) {
      var over = zone.scrollHeight - zone.clientHeight;
      var shrinkable = wants.filter(function (w) {
        return (parseInt(w.out.style.maxHeight, 10) || 0) > 40;
      });
      if (!shrinkable.length) break;
      var cut = Math.ceil(over / shrinkable.length);
      Array.prototype.forEach.call(shrinkable, function (w) {
        var cur = parseInt(w.out.style.maxHeight, 10) || 0;
        var next = Math.max(40, cur - cut);
        w.out.style.maxHeight = next + "px";
        if (w.tbl) w.out.style.height = next + "px";
        if (w.img) w.img.style.maxHeight = Math.max(30, next - 4) + "px";
      });
      try { markClipped() } catch (e) {}
    }
    try { markClipped() } catch (e) {}
  };

  /** short 块的 sweep 状态：整块 ▶ 点下后逐行喂引擎，行序即语义序。 */
  var sweep = null;  // { block, pre, zone, els, i }

  /** 行级执行的统一入口：short 块（有浮层）→ busy 卡 + 结果回填；无输出行 →
   *  撤卡、左列行尾 ✓；非 short 块（java 等 stepLines 行）→ 维持现契约（▶ 面板）。
   *  onDone 供 sweep 步进。 */
  var runOneLine = function (hit, onDone) {
    var pre = hit.pre || (hit.lineEl && hit.lineEl.closest("pre"));
    var zone = pre && pre.classList.contains("md2s-short") ? zoneOf(pre) : null;
    if (!zone) {
      startRun(hit.block.line, hit.block.lang, hit.lineOffset);
      if (onDone) onDone();
      return;
    }
    var card = cardOf(zone, hit.lineOffset);
    card.classList.add("md2s-short-busy");
    card.classList.remove("md2s-short-done", "md2s-short-error");
    var busyOut = card.querySelector(".md2s-short-out");
    if (busyOut) { busyOut.textContent = ""; busyOut.innerHTML = ""; }
    startRun(hit.block.line, hit.block.lang, hit.lineOffset, function (result) {
      var hasContent = !!result && (
        !result.ok ||
        (String(result.text || "").trim() !== "" ||
          String(result.stdout || "").trim() !== "" ||
          (result.images || []).length > 0 ||
          (result.rows && (result.rows.columns || []).length > 0))
      );
      if (!hasContent) {
        // 无输出（import / 赋值行）：撤卡 + 左列行尾 ✓——右侧只留有输出的卡。
        markLineDone(hit);
        if (card.parentElement) card.remove();
      } else {
        hit.lineEl && hit.lineEl.classList.remove("md2s-line-done");
        fillCard(zone, hit.lineOffset, result);
      }
      if (onDone) onDone(result);
    });
  };

  var onRunLineClick = function (ev) {
    var lineEl = ev.target && ev.target.closest ? ev.target.closest("[data-md2s-run-line]") : null;
    if (!lineEl || !capability.enabled) { console.warn("[exec-click] 早退: enabled=" + capability.enabled + " lineEl=" + !!lineEl); return }
    if (!lineEl.classList || !lineEl.classList.contains("code-line")) { console.warn("[exec-click] 早退: 非code-line"); return }
    var hit = resolveRunLine(lineEl);
    if (!hit) { console.warn("[exec-click] 早退: resolveRunLine null"); return }
    // 只有会话族（有常驻 REPL、共享变量）才逐行运行；一次性族点行不运行。
    if (!LINEABLE_FAMILIES[hit.block.family]) { console.warn("[exec-click] 早退: family=" + hit.block.family); return }
    ev.stopPropagation();
    if (sweep) { console.warn("[exec-click] 早退: sweep 进行中"); return }
    if (activeRun) { console.warn("[exec-click] 早退: activeRun 面板流"); return }
    runOneLine(hit);
  };
  document.addEventListener("click", onRunLineClick, true);

  // 页翻到可见的那一刻重标定浮层几何（deck-full-entry 的 onChange 派发）：decorate
  // 时块多半在隐藏页量不到（rect 全 0），zoneOf 对量不到的页保留旧值、这里补一刀。
  window.addEventListener("md2s-page-shown", function () {
    if (!capability.enabled) return;
    Array.prototype.forEach.call(document.querySelectorAll("pre.md2s-short"), function (pre) {
      try { zoneOf(pre) } catch (e) { /* 几何标定失败不拦放映 */ }
    });
  });

  var decorate = function (cap) {
    capability = {
      docPath: String(cap.docPath || ""),
      enabled: !!cap.enabled,
      blocks: Array.isArray(cap.blocks) ? cap.blocks : []
    };
    injectCss();
    measureTh();
    if (!capability.enabled) return;

    var blocks = capability.blocks.filter(function (b) { return b && b.runnable; });
    var injected = 0;
    var preList = document.querySelectorAll("pre > code[class*='language-']");
    Array.prototype.forEach.call(preList, function (code) {
      var pre = code.closest ? code.closest("pre") : code.parentElement;
      if (!pre || pre.querySelector(".md2s-exec-run")) return;
      var n = Number(pre.getAttribute("data-src-start"));
      if (!isFinite(n) || n <= 0) return;
      // composed 口径的 0 基行号：只作消歧提示与兜底（见 matchBlock）。
      var line = n - 1;
      // 内容优先连接（#18 坐标系错位修复）。codeTextOf：short 块跑过之后
      // code.textContent 会混进格子里的回填文本——按行 span 拼回纯源码再匹配。
      var b = matchBlock(blocks, codeTextOf(code), line);
      if (!b) return;
      try {
        if (window.getComputedStyle(pre).position === "static") pre.style.position = "relative";
      } catch (e) { pre.style.position = "relative"; }

      // 两栏活格（short）：▶ = sweep 逐行喂引擎、结果逐卡落进右侧留白浮层（与
      // Enter 逐行同语义，一次点完整个短 demo）；非 short 块维持现契约（整块执行
      // + 结果面板）。浮层随装饰即造（几何按页实测，重建换 DOM 后重造）。
      var shorted = pre.classList.contains("md2s-short");
      if (shorted) zoneOf(pre);
      pre.appendChild(makeBtn("", "▶",
        shorted
          ? "逐行运行整个短代码块：每行依次执行、结果落进右侧留白（共享会话变量）"
          : "运行完整代码块（不受分页切片影响；聚焦后按 Enter 也可触发）",
        shorted
          ? function () { startSweep(b, pre) }
          : function () { startRun(b.line, b.lang) }));
      injected += 1;
    });
    // 装饰后必须重建步进表，否则 ▶ 进不了翻页笔的步序列。
    if (injected) {
      try {
        var player = window.deckFull && window.deckFull.getPlayer && window.deckFull.getPlayer();
        if (player && player.refreshSteps) player.refreshSteps();
      } catch (e) { /* 播放器尚未就绪：下次 ready 会再装饰 */ }
    }
  };

  // ── 结果浮层 ────────────────────────────────────────────────────────────

  var askOthersToDismiss = function () {
    try {
      window.dispatchEvent(new CustomEvent("md2s-overlay-dismiss", { detail: { by: "exec" } }));
    } catch (e) { /* 老环境无 CustomEvent */ }
  };

  /** 浮层的模态键盘——翻页笔控制与 kit/lightbox.js 对齐（2026-11-14）：
   *  开着时拦下导航键（页码冻结，关闭即回原页原步）；PgDn/↓/Tab=头部按钮焦点
   *  遍历（到边界停住），PgUp/↑ 反向；确定键（Enter/空格，很多翻页笔发空格）=
   *  按下聚焦的按钮；焦点不在按钮上时：确认态=确认运行、已完成=收起、
   *  **运行中=空操作**——确定键不该误杀正在跑的作业（想停就翻页键走到「终止」
   *  再确定，那是明确意图）。挂 window capture 抢在播放器 keyTarget 之前，
   *  与 lightbox 同层；两者靠 md2s-overlay-dismiss 互斥，不会同时开着。
   *  Ctrl 组合键（复制输出）不在拦截之列，照常放行——lightbox 没有可复制物，
   *  全拦无妨；这里的 body 是运行结果，得能 Ctrl+C。 */
  var SWALLOW_KEYS = { Home: 1, End: 1, ArrowLeft: 1, ArrowRight: 1, Backspace: 1 };

  /** 头部可聚焦钮（DOM 序 = [终止] ◐ ⇆ ✕ 收起）。tabindex=-1 不进原生 Tab 序，
   *  焦点全由本层的翻页键遍历与完成态聚焦掌握。 */
  var focusablesOf = function () {
    if (!overlay || !overlay.el) return [];
    var head = overlay.el.querySelector(".md2s-exec-head");
    return head ? Array.prototype.slice.call(head.querySelectorAll("[tabindex='-1']")) : [];
  };

  /** 完成态把焦点交给 ✕ 收起：结果一出来按确定就收（lightbox「默认落在 ✕」同款）。 */
  var focusCloseBtn = function () {
    var list = focusablesOf();
    if (list.length) list[list.length - 1].focus();
  };

  /** 翻页键移动焦点：到边界停住（lightbox 同款）。焦点在浮层外时 PgDn 进第一个、PgUp 进最后一个。 */
  var moveFocus = function (dir) {
    var list = focusablesOf();
    if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    if (i < 0) i = dir > 0 ? -1 : list.length;
    list[Math.min(list.length - 1, Math.max(0, i + dir))].focus();
  };

  var onKey = function (ev) {
    if (!overlay) return;
    switch (ev.key) {
      case "Escape":
        closeOverlay();
        break;
      case "PageDown": case "ArrowDown": case "Tab":
        moveFocus(ev.shiftKey ? -1 : 1);
        break;
      case "PageUp": case "ArrowUp":
        moveFocus(-1);
        break;
      case "Enter": case " ": {
        if (overlay.confirmMode && overlay.confirmRun) {
          overlay.confirmRun();
          break;
        }
        var list = focusablesOf();
        var i = list.indexOf(document.activeElement);
        if (i >= 0) list[i].click();
        else if (overlay.done) closeOverlay();
        break;
      }
      default:
        if (!SWALLOW_KEYS[ev.key]) return;  // 无导航含义的键放行
        break;
    }
    if (ev.cancelable) ev.preventDefault();
    ev.stopPropagation();
  };

  var createOverlay = function (title, lang) {
    var el = document.createElement("div");
    el.className = "md2s-exec-overlay";
    // 静态骨架，不带任何文档数据；标题走 textContent，杜绝 info-string 注入。
    el.innerHTML = [
      '<div class="md2s-exec-head">',
      '  <span class="md2s-exec-title"></span>',
      '  <span class="md2s-exec-session"></span>',
      '  <span class="md2s-exec-status md2s-exec-busy">准备中…</span>',
      '  <span class="md2s-exec-alphabtn" tabindex="-1" title="切换背景透明度">◐</span>',
      '  <span class="md2s-exec-splitbtn" tabindex="-1" title="切换 居中浮层 / 左右分栏">⇆</span>',
      '  <span class="md2s-exec-close" tabindex="-1" title="关闭（Esc；确定键按下聚焦钮）">✕ 收起</span>',
      '</div>',
      '<div class="md2s-exec-body"></div>'
    ].join("");
    el.querySelector(".md2s-exec-title").textContent = title + " · " + (lang || "code");
    document.body.appendChild(el);

    // 字号跟随幻灯片：投屏上写死 13px 是蚂蚁字；封顶 24 免得大表格爆炸。
    try {
      var sample = document.querySelector("section pre");
      var slideFs = sample ? parseFloat(window.getComputedStyle(sample).fontSize) : 0;
      if (slideFs > 0) el.style.fontSize = Math.max(12, Math.min(24, Math.round(slideFs * 0.8))) + "px";
    } catch (e) { /* 保持 CSS 默认 */ }

    var statusEl = el.querySelector(".md2s-exec-status");
    var sessionEl = el.querySelector(".md2s-exec-session");
    var body = el.querySelector(".md2s-exec-body");
    var splitBtn = el.querySelector(".md2s-exec-splitbtn");
    var alphaBtn = el.querySelector(".md2s-exec-alphabtn");
    var sec = document.querySelector("section.md2s-current");
    var splitMode = false;
    var alphaLevel = 1;  // 1=68% 默认；0=52% 更透；2=94% 近实心
    var ALPHA_LABEL = ["52% 通透", "68% 默认", "94% 实心"];

    // 浮层是覆盖在代码之上的：背景半透明，文字/表格保持清晰；◐ 循环三档。
    var applyAlpha = function () {
      el.classList.remove("md2s-exec-alpha-0", "md2s-exec-alpha-1", "md2s-exec-alpha-2");
      el.classList.add("md2s-exec-alpha-" + alphaLevel);
      alphaBtn.classList.toggle("md2s-exec-on", alphaLevel !== 1);
      alphaBtn.title = "背景透明度：" + ALPHA_LABEL[alphaLevel] + "（点按循环切换）";
    };

    var restoreSec = function () {
      if (!sec) return;
      sec.classList.remove("md2s-exec-split");
      sec.style.paddingBottom = "";
      sec.style.paddingRight = "";
    };
    var enableSplit = function () {
      splitMode = true;
      if (sec) {
        sec.style.paddingBottom = "";
        sec.style.paddingRight = "46%";
        sec.classList.add("md2s-exec-split");
      }
      el.classList.add("md2s-exec-split");
      splitBtn.classList.add("md2s-exec-on");
      alphaBtn.title = "分栏态下无需透明度；点 ⇆ 回到居中浮层";
    };
    // 居中覆盖：不再给 section 让位（那会把代码顶走），靠透明度让代码透出来。
    var applyFloat = function () {
      splitMode = false;
      el.classList.remove("md2s-exec-split");
      splitBtn.classList.remove("md2s-exec-on");
      restoreSec();
      applyAlpha();
    };
    var applyLayout = function () { return splitMode ? enableSplit() : applyFloat(); };
    applyAlpha();

    el.querySelector(".md2s-exec-close").addEventListener("click", function () { closeOverlay(); });
    alphaBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (splitMode) applyFloat();  // 分栏态点 ◐ 先回到居中浮层，再改透明度
      alphaLevel = (alphaLevel + 2) % 3;  // 1 → 0 → 2 → 1
      applyAlpha();
    });
    splitBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      splitMode = !splitMode;
      applyLayout();
    });
    window.addEventListener("keydown", onKey, true);
    askOthersToDismiss();

    return {
      el: el,
      body: body,
      statusEl: statusEl,
      sessionEl: sessionEl,
      confirmMode: false,
      confirmRun: null,
      /** 终态标记：结果/错误/作业完结后为 true——确定键的兜底语义（收起）只在
       *  终态生效，运行中空操作防误杀。 */
      done: false,
      setStatus: function (text, cls) {
        statusEl.className = "md2s-exec-status " + (cls || "");
        statusEl.textContent = text;
      },
      applyLayout: applyLayout,
      destroy: function () {
        window.removeEventListener("keydown", onKey, true);
        restoreSec();
        el.remove();
      }
    };
  };

  var closeOverlay = function () {
    var o = overlay;
    if (!o) return;
    overlay = null;
    var r = activeRun;
    if (r) {
      // 作业是常驻子进程：关面板就终止，别留后台无声运行。
      if (r.jobId && !r.jobDone) {
        post({ type: "md2s:exec-stop", reqId: r.reqId, docPath: r.docPath, jobId: r.jobId });
      }
      post({ type: "md2s:exec-cancel", reqId: r.reqId });
      if (r.timer) clearInterval(r.timer);
    }
    activeRun = null;
    o.destroy();
    // 焦点还给播放器容器（lightbox onClose → rootOf().focus() 同款）：翻页笔的
    // 下一次确定键回到播放器手里，不会误触页面上别的可激活元素。
    try {
      var deckEl = document.getElementById("deck");
      (deckEl || document.body).focus();
    } catch (e) { /* jsdom */ }
  };

  var ensureStream = function () {
    var r = activeRun;
    if (!r || !overlay) return null;
    if (!r.streamEl) {
      r.streamEl = document.createElement("pre");
      overlay.body.insertBefore(r.streamEl, overlay.body.firstChild);
    }
    return r.streamEl;
  };

  // ── 运行 ────────────────────────────────────────────────────────────────

  var showConfirm = function (o, onConfirm) {
    var box = document.createElement("div");
    box.className = "md2s-exec-confirm";
    var hint = document.createElement("span");
    hint.textContent = "运行讲义代码会在本机执行子进程。仅在信任此文档时继续。";
    var btn = document.createElement("button");
    btn.textContent = "允许并运行";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (o.confirmRun) o.confirmRun();
    });
    box.appendChild(hint);
    box.appendChild(btn);
    o.body.appendChild(box);
    try { btn.focus(); } catch (e) { /* jsdom */ }  // 确定键直落在「允许并运行」上
    o.confirmMode = true;
    o.confirmRun = function () {
      if (!o.confirmMode) return;
      o.confirmMode = false;
      o.confirmRun = null;
      box.remove();
      onConfirm();
    };
    o.setStatus("等待确认", "md2s-exec-busy");
  };

  var beginExec = function (reqId) {
    var r = activeRun;
    if (!r || r.reqId !== reqId || r.startedExec) return;
    r.startedExec = true;
    if (overlay) { overlay.confirmMode = false; overlay.confirmRun = null; }
    var msg = { type: "md2s:exec", reqId: reqId, docPath: r.docPath, line: r.line };
    if (r.lineOffset != null) msg.lineOffset = r.lineOffset;
    post(msg);
  };

  /* 行级执行（两栏活格）：结果进格子，不开面板。activeLine 与 activeRun（面板流）
   * 共用 md2s:exec-result / exec-error 通道——结果路由先查 activeRun、再查 activeLine。 */
  var activeLine = null;   // { reqId, onResult }

  var beginLineExec = function (line, lang, lineOffset, onResult) {
    var reqId = "e" + (++reqSeq);
    activeLine = { reqId: reqId, onResult: onResult };
    post({
      type: "md2s:exec", reqId: reqId, docPath: capability.docPath,
      line: line, lineOffset: lineOffset,
    });
  };

  var startRun = function (line, lang, lineOffset, onResult) {
    closeOverlay();
    // 行级（lineOffset + 回调）：结果回填格子（fillCell），不建结果面板。
    if (lineOffset != null && typeof onResult === "function") {
      if (!isConfirmed(capability.docPath)) {
        // 首次运行确认复用面板；确认即关面板、继续行级执行。
        var o = createOverlay("▶ 逐行运行", lang);
        overlay = o;
        showConfirm(o, function () {
          markConfirmed(capability.docPath);
          closeOverlay();
          beginLineExec(line, lang, lineOffset, onResult);
        });
        return;
      }
      beginLineExec(line, lang, lineOffset, onResult);
      return;
    }
    var o = createOverlay(lineOffset == null ? "▶ 运行" : "▶ 逐行运行", lang);
    overlay = o;
    var reqId = "e" + (++reqSeq);
    activeRun = {
      reqId: reqId, line: line, lineOffset: lineOffset == null ? undefined : lineOffset,
      docPath: capability.docPath,
      started: Date.now(), startedExec: false, jobId: null, jobDone: false,
      timer: null, streamEl: null, streamBuf: "", streamChars: 0
    };
    if (!isConfirmed(capability.docPath)) {
      showConfirm(o, function () { markConfirmed(capability.docPath); beginExec(reqId); });
    } else {
      o.setStatus("运行中…", "md2s-exec-busy");
      beginExec(reqId);
    }
  };

  /* short 块 ▶ = sweep：先经宿主重置会话（定稿 2026-11-26：整块重跑=清空命名空间
   * 从头回放，防 df=df.dropna() 非幂等行连跑两遍；引擎重建后 sessionRun 自动重跑
   * 引导块），收到 exec-reset-done 回执再逐行喂引擎、结果逐格落位（与逐行 Enter
   * 同语义——赋值行 ✓、表达式行落结果）。空行跳过（引擎对空行报错，空行没有
   * 教学内容）。重建换 DOM 时（pre 断连）中止。 */
  var resetPending = null;   // sweep 等待重置回执的放行回调

  var startSweep = function (block, pre) {
    if (sweep) return;
    var begin = function () {
      // 重置是异步 IPC：等回执再跑，别和引擎的会话重建竞速（1.5s 兜底放行——
      // 宿主旧版本没有回执也不至于卡死）。
      post({ type: "md2s:exec-reset", line: block.line });
      resetPending = function () { resetPending = null; doSweep(block, pre) };
      setTimeout(function () {
        if (resetPending) { resetPending = null; doSweep(block, pre) }
      }, 1500);
    };
    if (!isConfirmed(capability.docPath)) {
      var o = createOverlay("▶ 运行", block.lang);
      overlay = o;
      showConfirm(o, function () {
        markConfirmed(capability.docPath);
        closeOverlay();
        begin();
      });
      return;
    }
    begin();
  };

  var doSweep = function (block, pre) {
    var els = pre.querySelectorAll(".code-line");
    if (!els.length) return;
    var zone = zoneOf(pre);
    if (!zone) return;
    // 重放从清零开始（reset-session 之后命名空间归零）：卡片撤光、行尾 ✓ 清光。
    zone.innerHTML = "";
    clearLineDone(pre);
    sweep = { block: block, pre: pre, els: els, i: 0 };
    var step = function () {
      if (!sweep || !pre.isConnected) { sweep = null; return }
      var i = sweep.i;
      // 空行跳过：不给引擎喂（喂了只会收一条「该行为空」的错误），也不落卡。
      while (i < els.length && !els[i].textContent.trim()) i += 1;
      if (i >= els.length) { sweep = null; return }
      sweep.i = i + 1;   // 先占位：回调里再步进（防 runOneLine 同步抛错重入）
      var hit = resolveRunLine(els[i]);
      if (!hit || !LINEABLE_FAMILIES[hit.block.family]) { step(); return }
      runOneLine(hit, function () { if (sweep) { sweep.i = Math.max(sweep.i, i + 1); step() } });
    };
    step();
  };

  // ── 结果渲染 ────────────────────────────────────────────────────────────

  var renderTable = function (rows, maxRows) {
    var head = thStyle || { bg: "#2a2a2a", fg: "#eee" };
    var table = document.createElement("table");
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    (rows.columns || []).forEach(function (c) {
      var th = document.createElement("th");
      th.textContent = c;
      th.style.backgroundColor = head.bg;
      th.style.color = head.fg;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    var cells = rows.cells || [];
    cells.slice(0, maxRows || 20).forEach(function (row) {
      var tr = document.createElement("tr");
      for (var i = 0; i < (rows.columns || []).length; i++) {
        var td = document.createElement("td");
        var cell = row[i];
        td.textContent = cell == null ? "NULL" : String(cell);
        if (cell == null || cell === "NULL") td.className = "md2s-exec-null";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    if (cells.length > (maxRows || 20)) {
      var foot = document.createElement("tfoot");
      var fr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = (rows.columns || []).length;
      td.textContent = "… 共 " + cells.length + " 行（已显示前 " + (maxRows || 20) + "）";
      fr.appendChild(td);
      foot.appendChild(fr);
      table.appendChild(foot);
    }
    return table;
  };

  var renderResult = function (result) {
    if (!overlay) return;
    var body = overlay.body;
    (result.images || []).forEach(function (src) {
      var img = document.createElement("img");
      img.src = src;
      body.appendChild(img);
    });
    if (result.rows && result.rows.columns && result.rows.columns.length) {
      body.appendChild(renderTable(result.rows));
      if (result.note) {
        var rn = document.createElement("pre");
        rn.className = "md2s-exec-note";
        rn.textContent = result.note;
        body.appendChild(rn);
      }
    }
    var note = stripVarEcho(result.text || "");
    if (note.trim()) {
      var pre = document.createElement("pre");
      pre.className = "md2s-exec-note";
      pre.textContent = note;
      body.appendChild(pre);
    }
    if (!result.ok && result.error) {
      var err = document.createElement("pre");
      err.className = "md2s-exec-error";
      err.textContent = result.error;
      body.appendChild(err);
    }
    if (result.session) {
      var s = result.session;
      overlay.sessionEl.textContent = "〔" + (s.chapter || "本章") + " · " +
        (s.replayed ? "重放" : "会话") + " " + s.ran + "/" + s.total +
        (s.stale > 0 ? " · 过期" + s.stale : "") + "〕";
    }
    body.scrollTop = body.scrollHeight;
  };

  var handleState = function (reqId, event) {
    var r = activeRun;
    if (!r || r.reqId !== reqId || !overlay || !event) return;
    if (event.type === "started") {
      overlay.setStatus("运行中…", "md2s-exec-busy");
    } else if (event.type === "chunk") {
      if (event.stream !== "stdout" || r.streamChars > MAX_STREAM) return;
      r.streamChars += String(event.text || "").length;
      r.streamBuf += String(event.text || "");
      var s = ensureStream();
      if (s) s.textContent = stripVarEcho(r.streamBuf);
      overlay.body.scrollTop = overlay.body.scrollHeight;
      overlay.applyLayout();
    } else if (event.type === "job-done") {
      var o = event.outcome || {};
      if (r.timer) { clearInterval(r.timer); r.timer = null; }
      var stopBtn = overlay.statusEl.parentElement.querySelector(".md2s-exec-stop");
      if (stopBtn) stopBtn.remove();
      var secs = ((o.durationMs || 0) / 1000).toFixed(1);
      var label = o.killed ? "已终止 · " + secs + "s"
        : o.code === 0 ? "完成 · " + secs + "s" : "退出码 " + o.code + " · " + secs + "s";
      overlay.setStatus(label, o.killed || o.code !== 0 ? "md2s-exec-fail" : "md2s-exec-ok");
      if (o.error) {
        var err = document.createElement("pre");
        err.className = "md2s-exec-error";
        err.textContent = o.error;
        overlay.body.appendChild(err);
      }
      r.jobDone = true;
      o.done = true;
      focusCloseBtn();  // 作业完结：确定键即可收起
      overlay.applyLayout();
    }
    // done：结算统一交给 md2s:exec-result（避免与 result 抢状态）
  };

  var handleResult = function (reqId, result) {
    // 行级（两栏活格）：结果进卡片回调（fillCard），不碰面板。回调异常不能吞——
    // 吞了卡片就永远停在 busy（v2.1 真机抓过），console 留痕 + 卡片落错误态。
    var lr = activeLine;
    if (lr && lr.reqId === reqId) {
      activeLine = null;
      try { lr.onResult?.(result) } catch (e) {
        console.warn("[exec-present] 行级回填异常：", e && (e.stack || e.message) || e);
        try { lr.onResult?.({ ok: false, kind: "none", text: "", error: "回填异常：" + (e && e.message || e) }) } catch (e2) { /* 尽力而为 */ }
      }
      return;
    }
    var r = activeRun;
    if (!r || r.reqId !== reqId || !overlay || !result) return;
    var o = overlay;
    if (result.kind === "job" && result.job) {
      r.jobId = result.job.id;
      r.jobDone = false;
      o.setStatus("作业运行中 · 0.0s", "md2s-exec-busy");
      r.timer = setInterval(function () {
        if (activeRun === r && overlay === o) {
          o.setStatus("作业运行中 · " + ((Date.now() - r.started) / 1000).toFixed(1) + "s", "md2s-exec-busy");
        }
      }, 500);
      var stop = document.createElement("span");
      stop.className = "md2s-exec-stop";
      stop.tabIndex = -1;  // 进头部焦点遍历：翻页笔可走到「终止」再确定
      stop.textContent = "终止";
      stop.title = "终止作业进程（Windows 上按进程树终止）";
      stop.addEventListener("click", function () {
        stop.textContent = "终止中…";
        post({ type: "md2s:exec-stop", reqId: reqId, docPath: r.docPath, jobId: r.jobId });
      });
      o.statusEl.parentElement.insertBefore(stop, o.statusEl);
      renderResult({ ok: result.ok, text: result.text });
      o.applyLayout();
      return;
    }
    var secs = ((Date.now() - r.started) / 1000).toFixed(1);
    o.done = true;  // 同步执行的终态：确定键兜底=收起
    if (!result.ok) {
      o.setStatus("失败", "md2s-exec-fail");
    } else {
      o.setStatus((KIND_LABEL[result.kind] || result.kind) + " · " + secs + "s", "md2s-exec-ok");
      if (result.kind === "table") {
        /* 表格已表达全部行列：原始 TSV 流（含 beeline 横幅）收掉——
           同一份数据显示两遍是噪声，不是「日志」。text/none 维持原文展示。 */
        if (r.streamEl) { r.streamEl.remove(); r.streamEl = null; }
        r.streamBuf = "";
      } else if (result.stdout) {
        var s = ensureStream();
        if (s && !s.textContent.trim()) {
          r.streamBuf = result.stdout;
          s.textContent = stripVarEcho(r.streamBuf);
        }
      }
    }
    renderResult(result);
    focusCloseBtn();  // 结果一出来焦点落 ✕：确定键即可收起
    o.applyLayout();
  };

  var handleError = function (reqId, message) {
    // 行级：错误也进格子回调（fillCell 红字），不碰面板。
    var lr = activeLine;
    if (lr && lr.reqId === reqId) {
      activeLine = null;
      try { lr.onResult?.({ ok: false, kind: "none", text: "", error: String(message || "执行失败") }) } catch (e) { /* 同上 */ }
      return;
    }
    var r = activeRun;
    if (!r || r.reqId !== reqId || !overlay) return;
    overlay.done = true;
    overlay.setStatus("失败", "md2s-exec-fail");
    var err = document.createElement("pre");
    err.className = "md2s-exec-error";
    err.textContent = String(message || "执行失败");
    overlay.body.appendChild(err);
    focusCloseBtn();
    overlay.applyLayout();
  };

  // ── 课堂跟随（学生端）──────────────────────────────────────────────────
  // 宿主 deckPane 收到 ws 的 teaching.session.page 后发 md2s:follow；本层直调
  // player.go(1 基页号)。跨源宿主碰不到 iframe DOM，能直调 player 的只有这里
  // ——与 ▶ 桥同一条理由（见文件头），所以跟随也落在本文件，不进 deck-full.js。
  //
  // locked = 服务端 followLocked（课堂锁定跟随）：
  //   锁 → 导航键在 capture 阶段吃掉，学生翻不走，页永跟老师；
  //   不锁 → 只跟不锁，学生可自己翻，老师下次翻页再对齐。
  // 回弹由宿主做（它有 md2s:change），本层只管对齐与拦键。

  var follow = { page: 0, locked: false };

  var deckPlayer = function () {
    try {
      return window.deckFull && window.deckFull.getPlayer ? window.deckFull.getPlayer() : null;
    } catch (e) { return null; }
  };

  /** 返回是否真的对齐了。播放器还没起来（build 未完成）就返回 false，等下次 ready。 */
  var followTo = function (page) {
    if (!page || page < 1) return false;
    var player = deckPlayer();
    if (!player || typeof player.go !== "function") return false;
    if (player.index === page) return true;
    try { player.go(page); return true; } catch (e) { return false; }
  };

  var NAV_KEYS = {
    ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
    PageUp: 1, PageDown: 1, Home: 1, End: 1, " ": 1, Spacebar: 1
  };

  /* player 的 keyTarget 是 #deck，事件从 window 捕获下来先到本层；stopPropagation
     后它收不到。结果浮层也会 capture 拦 Enter/Esc，但那是另一个键集，互不遮挡。 */
  var onFollowKey = function (ev) {
    if (!follow.locked) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!NAV_KEYS[ev.key]) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  document.addEventListener("keydown", onFollowKey, true);

  var applyFollow = function (d) {
    follow.locked = d.locked === true;
    var page = Number(d.page) || 0;
    if (page) follow.page = page;
    followTo(follow.page);
  };


  // ══ 课堂发题（2026-11-16）：页面注入模式 ═══════════════════════════════
  // 「发题」按钮与两栏浮层（左题右实况）都在 deck 页面内——跟幻灯片融为一体，
  // 独占态自然可见；宿主（deckPane）只当数据桥：quiz-open 请求发题、quiz-state
  // 推实况/揭晓投影。模态锁页与执行浮层同一纪律：浮层开着导航键全拦（题目
  // 做完才往下讲），Esc 关浮层恢复翻页。选项是本班显示序（opened 广播投影），
  // 与学生看到的一致；页面侧不含答案字段（揭晓的 answer 由宿主投影下发）。

  var quizEnabled = false;
  var quizOverlay = null;   // { el, questionKey }
  var quizState = null;     // 宿主投影（md2s:quiz-state）
  var quizTick = null;

  /* 浮层与行内发题按钮的 DOM/CSS/键位只有一份源码：
     md2slides/kit/quiz/deck-overlay.js（页面里是 window.Md2sQuizDeck）。
     文览与文枢 Web 都加载同一份脚本，这里只做数据桥。 */
  var injectQuizCss = function () {
    if (window.Md2sQuizDeck) window.Md2sQuizDeck.injectCss();
  };
  var quizDeck = function () { return window.Md2sQuizDeck || null; };
  var quizVoidArmed = false;
  var quizVoidTimer = null;
  var quizViewState = function () {
    return Object.assign({}, quizState || {}, {
      showControls: true,
      voidArmed: quizVoidArmed,
      leaderboard: (quizState && quizState.reveal && quizState.reveal.leaderboard) || []
    });
  };
  var disarmQuizVoid = function () {
    quizVoidArmed = false;
    if (quizVoidTimer) { clearTimeout(quizVoidTimer); quizVoidTimer = null; }
    if (quizOverlay && !quizOverlay.fatal && quizDeck()) {
      quizDeck().render(quizOverlay.el, quizViewState());
    }
  };

  /* 讲义 DOM 里的题目是公开信息（题干/选项就在幻灯片上），页面侧自己读——
     参考 kit/quiz/panel.js 的 readQuizzes。这样点发题浮层左侧立刻有题目，
     不必空等宿主回填 quiz-state（宿主一卡就永远停在"等待发题…"）。
     答案不在这里读：揭晓的正确答案只认宿主投影，页面侧不能提前泄题。 */
  var quizTextOf = function (el) {
    if (!el) return "";
    // 发题按钮现在是题干的行内子元素；读题时必须剔掉，否则会把「发题/答题中…」
    // 混进题干。clone 后再清理，不动放映 DOM。
    var clone = el.cloneNode(true);
    if (clone.querySelectorAll) {
      Array.prototype.forEach.call(clone.querySelectorAll(".md2s-quiz-launch"), function (b) { b.remove(); });
    }
    if (!clone.querySelector || !clone.querySelector(".katex")) return (clone.textContent || "").trim();
    // KaTeX 一份公式渲染出三份内容（MathML + katex-html + annotation），
    // 直接 textContent 会把公式重复三遍；换回 $tex$ 才是作者写的原文。
    var nodes = clone.querySelectorAll(".katex");
    for (var i = 0; i < nodes.length; i++) {
      var ann = nodes[i].querySelector("annotation");
      var tex = ann ? (ann.textContent || "") : "";
      nodes[i].replaceWith(clone.ownerDocument.createTextNode(tex ? "$" + tex + "$" : ""));
    }
    return (clone.textContent || "").trim();
  };
  var readQuizFromDom = function (questionKey) {
    if (!questionKey) return null;
    var escKey = String(questionKey).replace(/["\\]/g, "\\$&");
    var stemEl = document.querySelector('[data-md2s-quiz="' + escKey + '"]');
    if (!stemEl) return null;
    var optionsEl = document.querySelector('[data-md2s-quiz-options="' + escKey + '"]');
    var options = [];
    if (optionsEl) {
      Array.prototype.forEach.call(optionsEl.children, function (li) {
        if (li.tagName !== "LI") return;
        var t = quizTextOf(li);
        if (t) options.push(t);
      });
    }
    var limitSec = 30;
    try {
      var meta = JSON.parse(stemEl.getAttribute("data-md2s-quiz-meta") || "{}");
      if (Number(meta.limit) > 0) limitSec = Number(meta.limit);
    } catch (e) { /* 题面 meta 坏了就用默认限时，不让浮层开不出来 */ }
    return {
      questionKey: questionKey,
      stem: quizTextOf(stemEl),
      options: options,
      limitSec: limitSec
    };
  };

  /* 题干旁注入「发题」按钮（幂等）；quiz-capability 关闭时整体移除。 */
  var decorateQuizButtons = function () {
    // 关键：注入按钮时就要注入 CSS。原实现只在 openQuizOverlay 里注入，
    // 导致首次就绪时按钮是浏览器默认灰色小按钮（用户截图1），点一次开浮层后才
    // 变绿（截图2）。提前注入让按钮一开始就是绿色大按钮，去掉那个难看的过渡态。
    injectQuizCss();
    var stems = document.querySelectorAll("[data-md2s-quiz]");
    Array.prototype.forEach.call(stems, function (stemEl) {
      var key = stemEl.getAttribute("data-md2s-quiz");
      if (!key) return;
      // 行内按钮：既支持新版（题干内），也认旧版（题干后的兄弟节点），重建后都幂等。
      var exists = Array.prototype.some.call(stemEl.children, function (c) {
        return c.classList && c.classList.contains("md2s-quiz-launch");
      });
      var next = stemEl.nextElementSibling;
      if (next && next.classList && next.classList.contains("md2s-quiz-launch")) {
        next.remove();
      }
      if (exists) return;
      var btn = document.createElement("button");
      btn.className = "md2s-quiz-launch";
      btn.setAttribute("data-quiz-key", key);
      // player 的 Enter / 翻页笔 activate() 靠此标记命中并派发 click；
      // 不打这个标记，聚焦放映区按 Enter 就翻页而点不到发题按钮。
      btn.setAttribute("data-md2s-activatable", "");
      btn.textContent = "发题";
      btn.addEventListener("click", function () { requestQuizOpen(key); });
      // 题干原文先收进 flex 文本列，按钮作为第二个 flex item 落到题干右侧。
      // 用 span 包住原有子节点（题干是 <p>），不复制、不改写 KaTeX DOM。
      // capability 关→开时按钮被移除但文本列还在，复用它，避免套娃。
      var textWrap = null;
      Array.prototype.some.call(stemEl.children, function (c) {
        if (c.classList && c.classList.contains("md2s-quiz-inline-text")) { textWrap = c; return true; }
        return false;
      });
      if (!textWrap) {
        textWrap = document.createElement("span");
        textWrap.className = "md2s-quiz-inline-text";
        while (stemEl.firstChild) textWrap.appendChild(stemEl.firstChild);
        stemEl.appendChild(textWrap);
      }
      stemEl.classList.add("md2s-quiz-with-launch");
      stemEl.appendChild(btn);
    });
  };
  var removeQuizButtons = function () {
    Array.prototype.forEach.call(document.querySelectorAll(".md2s-quiz-launch"), function (b) { b.remove(); });
  };
  var updateQuizButtons = function () {
    var running = quizState && quizState.phase === "running";
    Array.prototype.forEach.call(document.querySelectorAll(".md2s-quiz-launch"), function (b) {
      b.disabled = !!running;
      b.textContent = running ? "答题中…" : "发题";
    });
  };

  var requestQuizOpen = function (questionKey) {
    // 揭晓后重按同题按钮 = 重看结果浮层（不重复发题），沿用现有揭晓态
    if (quizState && quizState.phase === "revealed" && quizState.questionKey === questionKey) {
      openQuizOverlay(questionKey);
      return;
    }
    // 参考 kit/quiz/panel.js：题目是讲义 DOM 里的公开信息，页面侧直接读来渲染浮层左侧。
    // 绝不把 quizState 清空成 null —— 那是"等待发题…"卡死的根因：宿主 quiz-state
    // 一来晚/一来空，浮层就永远没题目。宿主数据到达后只覆盖实况与本班显示序选项。
    var local = readQuizFromDom(questionKey) || { questionKey: questionKey };
    quizState = Object.assign({ phase: "idle" }, local);
    openQuizOverlay(questionKey);
    post({ type: "md2s:quiz-open", questionKey: questionKey });
  };

  /* 两栏浮层：DOM/CSS/键位统一由 Md2sQuizDeck 提供；这里只做数据桥。 */
  var openQuizOverlay = function (questionKey) {
    injectQuizCss();
    if (quizOverlay) closeQuizOverlay();
    quizState = quizState || { phase: "idle", questionKey: questionKey };
    quizState.questionKey = questionKey;
    var deck = quizDeck();
    if (!deck) {
      // deck.html 未加载统一模块是构建事故；显式报错，不退回第二套自绘 UI。
      var fatal = document.createElement("div");
      fatal.className = "md2s-quiz-ov";
      fatal.textContent = "发题浮层模块未加载（quiz-deck.js）";
      document.body.appendChild(fatal);
      quizOverlay = { el: fatal, questionKey: questionKey, fatal: true };
      return;
    }
    var el = deck.mount(quizViewState(), {
      onClose: function () { closeQuizOverlay(); },
      onAction: function (action) {
        if (action === "exit") { closeQuizOverlay(); return; }
        if (action === "void" && !quizVoidArmed) {
          quizVoidArmed = true;
          if (quizDeck()) quizDeck().render(quizOverlay.el, quizViewState());
          quizVoidTimer = setTimeout(disarmQuizVoid, 4000);
          return;
        }
        disarmQuizVoid();
        post({ type: "md2s:quiz-action", questionKey: questionKey, action: action });
      }
    });
    quizOverlay = { el: el, questionKey: questionKey };
  };
  var closeQuizOverlay = function () {
    if (!quizOverlay) return;
    disarmQuizVoid();
    if (quizOverlay.fatal) quizOverlay.el.remove();
    else if (quizDeck()) quizDeck().destroy(quizOverlay.el);
    else quizOverlay.el.remove();
    quizOverlay = null;
    if (quizTick) { clearInterval(quizTick); quizTick = null; }
    post({ type: "md2s:quiz-close", questionKey: quizState ? quizState.questionKey : null });
  };

  var renderQuizOverlay = function () {
    if (!quizOverlay || !quizState || quizOverlay.fatal || !quizDeck()) return;
    quizDeck().render(quizOverlay.el, quizViewState());
    if (quizState.phase === "running" && !quizTick) {
      // 倒计时用宿主下发的 remainingSec（源于服务端 closeAt），页面只递减显示，
      // 新状态帧一到会被宿主重新覆盖，不再自己推算开题时间。
      quizTick = setInterval(function () {
        if (!quizState || quizState.phase !== "running") {
          clearInterval(quizTick); quizTick = null; return;
        }
        if (quizState.remainingSec > 0) quizState.remainingSec -= 1;
        if (quizOverlay && !quizOverlay.fatal && quizDeck()) {
          quizDeck().render(quizOverlay.el, quizViewState());
        }
      }, 1000);
    } else if (quizState.phase !== "running" && quizTick) {
      clearInterval(quizTick); quizTick = null;
    }
    updateQuizButtons();
  };

  var handleQuizState = function (d) {
    // 宿主只负责实况 + 本班显示序选项。它若没读到题（题列表未加载 / sessionId 被清），
    // stem/options 会是空——这时保留本地 DOM 读来的题目，别把浮层左侧打回"等待发题…"。
    var prev = quizState || {};
    var merged = Object.assign({}, prev, d || {});
    if (!merged.stem && prev.stem) merged.stem = prev.stem;
    if ((!merged.options || !merged.options.length) && prev.options && prev.options.length) {
      merged.options = prev.options;
    }
    if (d && d.questionKey == null && prev.questionKey) merged.questionKey = prev.questionKey;
    quizState = merged;
    if (quizOverlay) renderQuizOverlay();
    updateQuizButtons();
  };


  // ── 消息入口 ────────────────────────────────────────────────────────────

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (!d || typeof d !== "object") return;
    switch (d.type) {
      case "md2s:quiz-capability":
        quizEnabled = d.enabled === true;
        if (quizEnabled) {
          decorateQuizButtons();
        } else {
          // 退房 / 被另一放映端接管：撤按钮并收浮层，别留一个还能点的旧态。
          if (quizOverlay) closeQuizOverlay();
          removeQuizButtons();
        }
        break;
      case "md2s:quiz-state":
        handleQuizState(d);
        break;
      case "md2s:quiz-close":
        // 页面浮层已自行关闭（协议对称通知），无动作
        break;
      case "md2s:exec-capability":
        // 重建（改字 / 换主题）会换掉整份 DOM 与 section 引用：丢掉旧浮层再装饰。
        // sweep/行级回调也一并作废（doSweep 的 pre.isConnected 查询会兜住其余）。
        closeOverlay();
        sweep = null;
        resetPending = null;
        activeLine = null;
        decorate(d);
        break;
      case "md2s:exec-reset-done":
        // sweep 的会话重置回执：放行逐行回放。
        if (resetPending) { var go = resetPending; resetPending = null; go(); }
        break;
      case "md2s:exec-state":
        handleState(d.reqId, d.event);
        break;
      case "md2s:exec-result":
        handleResult(d.reqId, d.result);
        break;
      case "md2s:exec-error":
        handleError(d.reqId, d.error);
        break;
      case "md2s:follow":
        applyFollow(d);
        break;
      case "md2s:export":
        // 出片前收掉结果条（▶ 本身由既有 [data-md2s-activatable] 规则排除）。
        closeOverlay();
        break;
      default:
        break;
    }
  });

  // 其它浮层（图片查看器等）打开时礼貌让位——Esc 归它，不两个一起抢。
  window.addEventListener("md2s-overlay-dismiss", function (ev) {
    if (ev.detail && ev.detail.by !== "exec") closeOverlay();
  });
})();
