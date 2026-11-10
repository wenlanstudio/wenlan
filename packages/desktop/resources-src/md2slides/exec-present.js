"use strict";

/**
 * exec-present.js — 「示」视图放映中运行代码块：deck 页面侧执行桥。
 *
 * 归属：运行在 md2slides 的 deck.html 里（与 deck-full.js 同源），由
 * scripts/sync-md2slides.mjs 注入 <script> 并拷入 gitignored 资源包。
 * **不要手改 packages/desktop/resources/ 下的副本**——那是生成物。
 *
 * 分工（三层，跨源 iframe 决定的）：
 *   本文件：装饰 ▶/⏩、结果浮层、输入隔离、postMessage 客户端；零 Node / 零引擎依赖。
 *   Vue 宿主 deckPane.vue：唯一拿得到 docPath 的一层，转 window.mdcode2run IPC。
 *   main 进程：registry 单例引擎 + 子进程（已有，本次零改动）。
 *
 * 行号口径（关键）：deck 的 <pre data-src-start="N"> 中 N 是围栏开栏行 **1 基**；
 * 分页切片后的续片被改成「原 start + 切走行数 + 1」，仍落在原块体内。引擎
 * locate({line}) 是 **0 基** 区间 f.line <= line < f.end。故装饰时用
 * `line = N - 1` 做 **区间包含** 匹配（不能精确等于，续片会漏 ▶），点击时把
 * 匹配到的块开栏行 b.line 发回宿主——与引擎事件的 event.line 同口径。
 *
 * 契约：
 *   宿主→页  md2s:exec-capability { docPath, enabled, blocks:[{line,end,runnable,lang,job,replayable}] }
 *   页→宿主  md2s:exec { reqId, docPath, line, replay }
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
    ".md2s-exec-replay { right: calc(10px + 2.8em); }",
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
  var activeRun = null;  // { reqId, line, replay, docPath, started, ... }
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
      var line = n - 1; // 1 基 → 0 基
      // 区间包含：分页续片的 start 落在块体内，精确等于会漏掉它们。
      var b = null;
      for (var i = 0; i < blocks.length; i++) {
        if (line >= blocks[i].line && line < blocks[i].end) { b = blocks[i]; break; }
      }
      if (!b) return;
      try {
        if (window.getComputedStyle(pre).position === "static") pre.style.position = "relative";
      } catch (e) { pre.style.position = "relative"; }

      pre.appendChild(makeBtn("", "▶", "运行完整代码块（不受分页切片影响；聚焦后按 Enter 也可触发）",
        function () { startRun(b.line, false, b.lang); }));
      injected += 1;
      if (b.replayable) {
        pre.appendChild(makeBtn("md2s-exec-replay", "⏩", "从本章开头连跑到这里（重放）",
          function () { startRun(b.line, true, b.lang); }));
      }
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

  /** 浮层打开时按键归浮层：capture 先于 player 的 keyTarget / Esc 转发。 */
  var onKey = function (ev) {
    if (ev.key !== "Enter" && ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.key === "Enter" && overlay && overlay.confirmMode && overlay.confirmRun) {
      overlay.confirmRun();
      return;
    }
    closeOverlay();
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
      '  <span class="md2s-exec-alphabtn" title="切换背景透明度">◐</span>',
      '  <span class="md2s-exec-splitbtn" title="切换 居中浮层 / 左右分栏">⇆</span>',
      '  <span class="md2s-exec-close" title="关闭（Enter / Esc）">✕ 收起</span>',
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
    document.addEventListener("keydown", onKey, true);
    askOthersToDismiss();

    return {
      body: body,
      statusEl: statusEl,
      sessionEl: sessionEl,
      confirmMode: false,
      confirmRun: null,
      setStatus: function (text, cls) {
        statusEl.className = "md2s-exec-status " + (cls || "");
        statusEl.textContent = text;
      },
      applyLayout: applyLayout,
      destroy: function () {
        document.removeEventListener("keydown", onKey, true);
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
    try { window.focus(); } catch (e) { /* jsdom */ }
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
    post({ type: "md2s:exec", reqId: reqId, docPath: r.docPath, line: r.line, replay: r.replay });
  };

  var startRun = function (line, replay, lang) {
    closeOverlay();
    var o = createOverlay(replay ? "⏩ 重放" : "▶ 运行", lang);
    overlay = o;
    var reqId = "e" + (++reqSeq);
    activeRun = {
      reqId: reqId, line: line, replay: !!replay, docPath: capability.docPath,
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
      overlay.applyLayout();
    }
    // done：结算统一交给 md2s:exec-result（避免与 result 抢状态）
  };

  var handleResult = function (reqId, result) {
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
    if (!result.ok) {
      o.setStatus("失败", "md2s-exec-fail");
    } else {
      o.setStatus((KIND_LABEL[result.kind] || result.kind) + " · " + secs + "s", "md2s-exec-ok");
      if (result.stdout) {
        var s = ensureStream();
        if (s && !s.textContent.trim()) {
          r.streamBuf = result.stdout;
          s.textContent = stripVarEcho(r.streamBuf);
        }
      }
    }
    renderResult(result);
    o.applyLayout();
  };

  var handleError = function (reqId, message) {
    var r = activeRun;
    if (!r || r.reqId !== reqId || !overlay) return;
    overlay.setStatus("失败", "md2s-exec-fail");
    var err = document.createElement("pre");
    err.className = "md2s-exec-error";
    err.textContent = String(message || "执行失败");
    overlay.body.appendChild(err);
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

  // ── 消息入口 ────────────────────────────────────────────────────────────

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    var d = ev.data;
    if (!d || typeof d !== "object") return;
    switch (d.type) {
      case "md2s:exec-capability":
        // 重建（改字 / 换主题）会换掉整份 DOM 与 section 引用：丢掉旧浮层再装饰。
        closeOverlay();
        decorate(d);
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
