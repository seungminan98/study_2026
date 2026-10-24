/* ───────────────────────────────────────────────────────────
   필기 노트 위젯 (ink.js · 브라우저 전용, 서버 없음)
   기능: ① 동그라미 버튼 탭 → 필기 모드 on/off, 꾹 눌러 끌면 위치 이동(기억)
        ② 애플펜슬 = 필기 / 손가락 = 스크롤 (손가락 필기 토글 시 화면 고정)
        ③ 펜·형광펜·지우개·굵기·되돌리기  ④ IndexedDB 자동 저장(페이지별)
        ⑤ 공유: 링크(#ink=…) · 파일(.json) 내보내기/불러오기 · PDF(인쇄)
   - 필기는 가장 가까운 문단/표/박스 안에 비율 좌표로 저장되어, 화면 폭이 바뀌거나
     인쇄해도 그 블록을 따라 움직입니다.
   - 저장은 이 브라우저(이 기기)에만 됩니다. 다른 기기로 옮기려면 파일/링크를 쓰세요.
   사용: 각 페이지 </body> 앞에  <script src="../ink.js" defer></script>
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  if (window.__inkLoaded) return;
  window.__inkLoaded = true;

  var NS = "http://www.w3.org/2000/svg";
  var PAGE = location.pathname.replace(/index\.html$/, "");
  var ROOT = document.querySelector(".wrap") || document.body;
  var ANCHOR_SEL = "p,li,h1,h2,h3,h4,blockquote,.tbl,.eq,.fig,.note,.cap,.qtext,.sol,.box,.opts,.meta,.card,.links,header,section";
  var LS_POS = "ink_fab_pos";
  var LS_PREF = "ink_prefs";
  var COLORS = ["#1a1a1a", "#1f5eff", "#e5383b"];
  var HL_COLOR = "#ffd43b";
  var FONT = '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

  /* ---------- state ---------- */
  var mine = [];          // 내 필기 strokes
  var shared = null;      // 공유 링크로 받은 strokes (보기 모드)
  var undoStack = [], redoStack = [];
  var on = false;
  var prefs = loadPrefs();  // {tool, color, size, finger}
  var drawing = null;       // 현재 그리는 획
  var hidden = false;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function loadPrefs() {
    var d = { tool: "pen", color: COLORS[0], size: 1, finger: false };
    try { var p = JSON.parse(lsGet(LS_PREF) || "{}"); for (var k in p) d[k] = p[k]; } catch (e) {}
    return d;
  }
  function savePrefs() { lsSet(LS_PREF, JSON.stringify(prefs)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- storage (IndexedDB, localStorage 대체) ---------- */
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("no idb"));
      var r = indexedDB.open("study-ink", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("pages"); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbP;
  }
  function load() {
    return db().then(function (d) {
      return new Promise(function (res) {
        var q = d.transaction("pages").objectStore("pages").get(PAGE);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { res(null); };
      });
    }).catch(function () {
      try { return JSON.parse(lsGet("ink:" + PAGE) || "null"); } catch (e) { return null; }
    });
  }
  var saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      var rec = { v: 1, page: PAGE, title: document.title, updated: Date.now(), strokes: mine };
      db().then(function (d) {
        d.transaction("pages", "readwrite").objectStore("pages").put(rec, PAGE);
      }).catch(function () { lsSet("ink:" + PAGE, JSON.stringify(rec)); });
    }, 300);
  }

  /* ---------- anchors: 필기를 붙일 블록 ---------- */
  var anchorCache = null;
  function anchors() {
    if (anchorCache) return anchorCache;
    anchorCache = Array.prototype.filter.call(ROOT.querySelectorAll(ANCHOR_SEL), function (el) {
      return !el.closest(".ink-ui,.ai-panel,.ai-fabwrap,.ai-bar");
    });
    return anchorCache;
  }
  function snip(el) { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24); }
  function keyOf(el) {
    if (el === ROOT) return { i: -1, t: "" };
    return { i: anchors().indexOf(el), t: snip(el) };
  }
  function resolve(a) {
    if (!a || a.i < 0) return ROOT;
    var list = anchors(), el = list[a.i];
    if (el && snip(el) === a.t) return el;
    for (var i = 0; i < list.length; i++) if (snip(list[i]) === a.t) return list[i];
    return el || ROOT;
  }
  function clipsOverflow(el) {
    var cs = getComputedStyle(el);
    return cs.overflowX !== "visible" || cs.overflowY !== "visible";
  }
  function pickAnchor(cx, cy, box) {
    var stack = document.elementsFromPoint(cx, cy), el = null;
    for (var i = 0; i < stack.length; i++) {
      var s = stack[i];
      if (s.closest(".ink-ui")) continue;
      if (!ROOT.contains(s)) continue;
      el = s.closest(ANCHOR_SEL);
      if (el && !ROOT.contains(el)) el = null;
      break;
    }
    el = el || ROOT;
    // 스크롤/클립되는 블록(표 래퍼 등): 획이 그 안에 다 들어가면 그대로, 밖으로 나가면 잘리므로 부모로 올림
    while (el !== ROOT && clipsOverflow(el) && !inside(el, box)) {
      var up = el.parentElement && el.parentElement.closest(ANCHOR_SEL);
      el = (up && ROOT.contains(up)) ? up : ROOT;
    }
    return el;
  }
  function inside(el, box) {
    if (!box) return false;
    var r = el.getBoundingClientRect();
    return box.l >= r.left - 2 && box.r <= r.right + 2 && box.t >= r.top - 2 && box.b <= r.bottom + 2;
  }
  function layerOf(el, kind) {
    var cls = "ink-layer ink-" + kind;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.getAttribute && c.getAttribute("class") === cls) return c;
    }
    if (getComputedStyle(el).position === "static") { el.style.position = "relative"; }
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", cls);
    svg.setAttribute("viewBox", "0 0 1000 1000");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    el.appendChild(svg);
    return svg;
  }

  /* ---------- render ---------- */
  function widthFor(s, p) {
    var base = s.w;
    if (s.t === "hl") return base;
    return Math.max(0.6, base * (0.45 + 1.0 * (p == null ? 0.5 : p)));
  }
  function strokeNode(s) {
    var g = document.createElementNS(NS, "g");
    g.setAttribute("data-id", s.id);
    var pts = s.p;
    if (!pts.length) return g;
    function P(q) { return (q[0] * 1000).toFixed(1) + " " + (q[1] * 1000).toFixed(1); }
    var common = 'fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"';
    var html = "";
    if (s.t === "hl" || pts.length < 3) {
      var d = "M" + P(pts[0]);
      for (var i = 1; i < pts.length; i++) d += " L" + P(pts[i]);
      if (pts.length === 1) d += " L" + P(pts[0]);
      html = '<path d="' + d + '" stroke="' + s.c + '" stroke-width="' + widthFor(s, pts[0][2]).toFixed(2) + '" ' + common + "/>";
    } else {
      // 필압: 짧은 구간마다 굵기를 바꿔 이어 그림
      for (var j = 0; j < pts.length - 1; j += 2) {
        var a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)], c = pts[Math.min(j + 2, pts.length - 1)];
        var w = widthFor(s, (a[2] + b[2] + c[2]) / 3);
        html += '<path d="M' + P(a) + " Q" + P(b) + " " + P(c) + '" stroke="' + s.c + '" stroke-width="' + w.toFixed(2) + '" ' + common + "/>";
      }
    }
    g.innerHTML = html;
    return g;
  }
  function clearLayers() {
    Array.prototype.forEach.call(document.querySelectorAll("svg.ink-layer"), function (s) {
      while (s.firstChild) s.removeChild(s.firstChild);
    });
  }
  function renderAll() {
    anchorCache = null;
    clearLayers();
    var list = shared || mine;
    list.forEach(addNode);
  }
  function addNode(s) {
    var el = resolve(s.a);
    layerOf(el, s.t === "hl" ? "hl" : "pen").appendChild(strokeNode(s));
  }
  function removeNode(s) {
    var n = document.querySelector('svg.ink-layer g[data-id="' + s.id + '"]');
    if (n) n.parentNode.removeChild(n);
  }

  /* ---------- ops (undo/redo) ---------- */
  function apply(op, rev) {
    var add = (op.type === "add") !== !!rev;
    op.strokes.forEach(function (s) {
      if (add) { mine.push(s); addNode(s); }
      else { mine = mine.filter(function (m) { return m.id !== s.id; }); removeNode(s); }
    });
    save();
  }
  function commit(op) { apply(op); undoStack.push(op); redoStack = []; syncUndo(); }
  function undo() { var op = undoStack.pop(); if (op) { apply(op, true); redoStack.push(op); } syncUndo(); }
  function redo() { var op = redoStack.pop(); if (op) { apply(op); undoStack.push(op); } syncUndo(); }

  /* ---------- styles ---------- */
  var css = [
    "svg.ink-layer{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:2;}",
    "svg.ink-hl{mix-blend-mode:multiply;opacity:.45;z-index:1;}",
    "body.ink-hidden svg.ink-layer{display:none;}",
    ".ink-fab{position:fixed;z-index:9997;width:52px;height:52px;border-radius:50%;border:none;background:#1a1a1a;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(0,0,0,.25);cursor:pointer;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;transition:transform .15s,background .15s,box-shadow .15s;}",
    ".ink-fab svg{width:24px;height:24px;pointer-events:none;}",
    ".ink-fab.on{background:#1f5eff;}",
    ".ink-fab.lift{transform:scale(1.15);box-shadow:0 10px 28px rgba(0,0,0,.35);transition:none;}",
    ".ink-cap{position:fixed;inset:0;z-index:9990;display:none;touch-action:pan-x pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;cursor:crosshair;}",
    ".ink-cap.finger{touch-action:none;}",
    "body.ink-on .ink-cap{display:block;}",
    ".ink-live{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;}",
    ".ink-bar{width:max-content;position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 10px);z-index:9999;display:none;align-items:center;gap:4px;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 20px);background:#fff;border:1px solid #1a1a1a;border-radius:28px;padding:6px 8px;box-shadow:0 6px 22px rgba(0,0,0,.18);font:500 13px/1 " + FONT + ";color:#1a1a1a;-webkit-user-select:none;user-select:none;}",
    "body.ink-on .ink-bar{display:flex;}",
    ".ink-bar button{font:inherit;color:inherit;background:none;border:1px solid transparent;border-radius:18px;height:34px;min-width:34px;padding:0 10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px;}",
    ".ink-bar button:hover{background:#f4f4f4;}",
    ".ink-bar button.sel{border-color:#1a1a1a;background:#f4f4f4;}",
    ".ink-bar button:disabled{opacity:.3;cursor:default;}",
    ".ink-bar .sw{width:18px;height:18px;border-radius:50%;display:inline-block;}",
    ".ink-bar .sep{width:1px;height:22px;background:#ddd;margin:0 3px;}",
    ".ink-menu{position:fixed;z-index:10000;display:none;flex-direction:column;min-width:210px;background:#fff;border:1px solid #1a1a1a;border-radius:10px;padding:6px;box-shadow:0 8px 26px rgba(0,0,0,.2);font:14px/1.3 " + FONT + ";}",
    ".ink-menu.open{display:flex;}",
    ".ink-menu button{font:inherit;text-align:left;background:none;border:none;border-radius:6px;padding:10px 12px;cursor:pointer;color:#1a1a1a;}",
    ".ink-menu button:hover{background:#f4f4f4;}",
    ".ink-menu .danger{color:#c92a2a;}",
    ".ink-menu hr{border:none;border-top:1px solid #eee;margin:4px 0;}",
    ".ink-toast{width:max-content;position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 24px);z-index:10001;background:#1a1a1a;color:#fff;border-radius:8px;padding:10px 14px;font:14px/1.4 " + FONT + ";max-width:calc(100vw - 32px);display:none;box-shadow:0 6px 20px rgba(0,0,0,.25);}",
    ".ink-banner{width:max-content;position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 10px);z-index:9998;display:none;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;background:#eef3ff;border:1px solid #1f5eff;border-radius:10px;padding:8px 12px;font:14px/1.4 " + FONT + ";color:#1a1a1a;max-width:calc(100vw - 24px);}",
    ".ink-banner button{font:inherit;font-size:13px;border:1px solid #1a1a1a;background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;}",
    ".ink-banner button.pri{background:#1f5eff;border-color:#1f5eff;color:#fff;}",
    "body.ink-on .ink-banner{top:calc(env(safe-area-inset-top,0px) + 62px);}",
    "@media print{.ink-ui{display:none !important;} svg.ink-hl{opacity:.5;}}"
  ].join("\n");
  var st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ---------- UI: FAB (탭 = 토글, 꾹 = 이동) ---------- */
  var PEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var fab = el("button", "ink-fab ink-ui", PEN_ICON);
  fab.setAttribute("aria-label", "필기 모드");
  fab.title = "탭: 필기 모드 · 꾹 눌러 끌기: 위치 이동";
  document.body.appendChild(fab);

  function placeFab(pos) {
    var r = Math.max(8, Math.min(window.innerWidth - 60, pos.r));
    var b = Math.max(8, Math.min(window.innerHeight - 60, pos.b));
    fab.style.right = r + "px";
    fab.style.bottom = "calc(" + b + "px + env(safe-area-inset-bottom,0px))";
    return { r: r, b: b };
  }
  var fabPos = (function () {
    try { var p = JSON.parse(lsGet(LS_POS)); if (p && isFinite(p.r) && isFinite(p.b)) return p; } catch (e) {}
    return { r: 20, b: 128 };   // 기본: 학습 도우미 버튼 위
  })();
  fabPos = placeFab(fabPos);
  window.addEventListener("resize", function () { fabPos = placeFab(fabPos); });

  (function () {
    var t = null, sx = 0, sy = 0, start = null, lifted = false, moved = false, pid = null;
    fab.addEventListener("pointerdown", function (e) {
      pid = e.pointerId; sx = e.clientX; sy = e.clientY; start = { r: fabPos.r, b: fabPos.b };
      lifted = false; moved = false;
      try { fab.setPointerCapture(pid); } catch (x) {}
      t = setTimeout(function () { lifted = true; fab.classList.add("lift"); if (navigator.vibrate) navigator.vibrate(15); }, 420);
    });
    fab.addEventListener("pointermove", function (e) {
      if (e.pointerId !== pid) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!lifted) { if (Math.abs(dx) + Math.abs(dy) > 10) { clearTimeout(t); moved = true; } return; }
      fabPos = placeFab({ r: start.r - dx, b: start.b - dy });
    });
    function end(e) {
      if (e.pointerId !== pid) return;
      clearTimeout(t); pid = null;
      if (lifted) { fab.classList.remove("lift"); lsSet(LS_POS, JSON.stringify(fabPos)); toast("버튼 위치를 저장했어요"); }
      else if (!moved && e.type === "pointerup") toggle();
    }
    fab.addEventListener("pointerup", end);
    fab.addEventListener("pointercancel", end);
    fab.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  })();

  /* ---------- UI: toolbar ---------- */
  var bar = el("div", "ink-bar ink-ui");
  bar.setAttribute("role", "toolbar");
  var btn = {};
  function mk(key, html, title, fn) {
    var b = el("button", "", html); b.type = "button"; b.title = title; b.setAttribute("aria-label", title);
    b.addEventListener("click", function (e) { e.stopPropagation(); fn(b); });
    btn[key] = b; bar.appendChild(b); return b;
  }
  function sep() { bar.appendChild(el("span", "sep")); }
  COLORS.forEach(function (c, i) {
    mk("c" + i, '<span class="sw" style="background:' + c + '"></span>', ["검정", "파랑", "빨강"][i] + " 펜", function () {
      prefs.tool = "pen"; prefs.color = c; savePrefs(); syncBar();
    });
  });
  mk("hl", '<span class="sw" style="background:' + HL_COLOR + ';border-radius:3px;width:22px;height:12px"></span>', "형광펜", function () { prefs.tool = "hl"; savePrefs(); syncBar(); });
  mk("er", "지우개", "지우개 (획 단위)", function () { prefs.tool = "er"; savePrefs(); syncBar(); });
  sep();
  mk("size", "", "굵기", function () { prefs.size = (prefs.size + 1) % 3; savePrefs(); syncBar(); });
  sep();
  mk("undo", "↶", "되돌리기", undo);
  mk("redo", "↷", "다시 실행", redo);
  sep();
  mk("finger", "손가락", "손가락으로 필기 (화면 고정)", function () { prefs.finger = !prefs.finger; savePrefs(); syncBar(); });
  mk("more", "공유 ▾", "공유·저장", function (b) { toggleMenu(b); });
  document.body.appendChild(bar);

  var SIZE_LABEL = ["가늘게", "보통", "굵게"];
  function syncBar() {
    COLORS.forEach(function (c, i) { btn["c" + i].classList.toggle("sel", prefs.tool === "pen" && prefs.color === c); });
    btn.hl.classList.toggle("sel", prefs.tool === "hl");
    btn.er.classList.toggle("sel", prefs.tool === "er");
    btn.size.textContent = SIZE_LABEL[prefs.size];
    btn.finger.classList.toggle("sel", !!prefs.finger);
    btn.finger.textContent = prefs.finger ? "손가락 ✓" : "손가락";
    cap.classList.toggle("finger", !!prefs.finger);
    syncUndo();
  }
  function syncUndo() {
    if (!btn.undo) return;
    btn.undo.disabled = !undoStack.length || !!shared;
    btn.redo.disabled = !redoStack.length || !!shared;
  }

  /* ---------- UI: menu ---------- */
  var menu = el("div", "ink-menu ink-ui");
  function mi(label, fn, cls) {
    var b = el("button", cls || "", label); b.type = "button";
    b.addEventListener("click", function () { closeMenu(); fn(); });
    menu.appendChild(b);
  }
  mi("링크로 공유", shareLink);
  mi("파일로 내보내기 (.json)", exportFile);
  mi("파일 불러오기", function () { fileIn.click(); });
  mi("PDF로 저장 (인쇄)", function () { setMode(false); setTimeout(function () { window.print(); }, 50); });
  menu.appendChild(el("hr"));
  var hideBtn = el("button", "", "필기 숨기기"); hideBtn.type = "button";
  hideBtn.addEventListener("click", function () { closeMenu(); hidden = !hidden; document.body.classList.toggle("ink-hidden", hidden); hideBtn.textContent = hidden ? "필기 보이기" : "필기 숨기기"; });
  menu.appendChild(hideBtn);
  mi("이 페이지 필기 모두 지우기", clearPage, "danger");
  document.body.appendChild(menu);
  var fileIn = el("input"); fileIn.type = "file"; fileIn.accept = ".json,application/json"; fileIn.style.display = "none";
  fileIn.addEventListener("change", function () { if (fileIn.files[0]) importFile(fileIn.files[0]); fileIn.value = ""; });
  document.body.appendChild(fileIn);

  function toggleMenu(anchor) {
    if (menu.classList.contains("open")) return closeMenu();
    var r = anchor.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + "px";
    menu.style.left = Math.max(10, Math.min(window.innerWidth - 230, r.right - 210)) + "px";
    menu.classList.add("open");
  }
  function closeMenu() { menu.classList.remove("open"); }
  document.addEventListener("click", function (e) { if (!menu.contains(e.target) && e.target !== btn.more) closeMenu(); });

  /* ---------- UI: toast & banner ---------- */
  var toastEl = el("div", "ink-toast ink-ui"); document.body.appendChild(toastEl);
  var toastT = null;
  function toast(msg, ms) {
    toastEl.innerHTML = msg; toastEl.style.display = "block";
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.style.display = "none"; }, ms || 2200);
  }
  var banner = el("div", "ink-banner ink-ui");
  document.body.appendChild(banner);

  /* ---------- capture layer (필기 입력) ---------- */
  var cap = el("div", "ink-cap ink-ui");
  var live = document.createElementNS(NS, "svg"); live.setAttribute("class", "ink-live");
  cap.appendChild(live);
  document.body.appendChild(cap);

  // iPad: 펜슬 터치는 스크롤을 막고, 손가락 터치는 그대로 스크롤
  function stylusGuard(e) {
    if (prefs.finger) return;
    var t = e.touches && e.touches[0];
    if (t && t.touchType === "stylus") e.preventDefault();
  }
  cap.addEventListener("touchstart", stylusGuard, { passive: false });
  cap.addEventListener("touchmove", stylusGuard, { passive: false });

  function canDraw(e) {
    if (shared) return false;
    if (e.pointerType === "pen") return true;
    if (e.pointerType === "mouse") return e.button === 0;
    return !!prefs.finger;   // touch
  }
  var livePath = null, liveCls = null;
  function docPt(e) { return [e.clientX + window.scrollX, e.clientY + window.scrollY, e.pointerType === "pen" ? (e.pressure || 0.5) : 0.5]; }

  cap.addEventListener("pointerdown", function (e) {
    if (!canDraw(e)) return;
    e.preventDefault();
    closeMenu();
    try { cap.setPointerCapture(e.pointerId); } catch (x) {}
    if (prefs.tool === "er") { drawing = { id: e.pointerId, er: true, hit: {} }; erase(e); return; }
    var hl = prefs.tool === "hl";
    var w = hl ? [12, 18, 26][prefs.size] : [1.4, 2.4, 3.8][prefs.size];
    drawing = { id: e.pointerId, t: hl ? "hl" : "pen", c: hl ? HL_COLOR : prefs.color, w: w, pts: [docPt(e)] };
    livePath = document.createElementNS(NS, "path");
    livePath.setAttribute("fill", "none");
    livePath.setAttribute("stroke", drawing.c);
    livePath.setAttribute("stroke-width", w);
    livePath.setAttribute("stroke-linecap", "round");
    livePath.setAttribute("stroke-linejoin", "round");
    if (hl) { livePath.setAttribute("opacity", ".45"); }
    live.appendChild(livePath);
    drawLive();
  });
  cap.addEventListener("pointermove", function (e) {
    if (!drawing || e.pointerId !== drawing.id) return;
    e.preventDefault();
    if (drawing.er) { erase(e); return; }
    var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (!evs.length) evs = [e];
    evs.forEach(function (ev) {
      var p = docPt(ev), last = drawing.pts[drawing.pts.length - 1];
      if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= 1.2) drawing.pts.push(p);
    });
    drawLive();
  });
  function endStroke(e) {
    if (!drawing || e.pointerId !== drawing.id) return;
    var d = drawing; drawing = null;
    if (d.er) {
      var gone = mine.filter(function (s) { return d.hit[s.id]; });
      if (gone.length) { gone.forEach(function (s) { apply({ type: "add", strokes: [s] }, true); }); undoStack.push({ type: "del", strokes: gone }); redoStack = []; syncUndo(); }
      return;
    }
    if (livePath) { live.removeChild(livePath); livePath = null; }
    finalize(d);
  }
  cap.addEventListener("pointerup", endStroke);
  cap.addEventListener("pointercancel", endStroke);
  window.addEventListener("scroll", function () { if (drawing && !drawing.er) drawLive(); }, { passive: true });

  function drawLive() {
    if (!livePath || !drawing) return;
    var sx = window.scrollX, sy = window.scrollY, pts = drawing.pts;
    var d = "M" + (pts[0][0] - sx) + " " + (pts[0][1] - sy);
    for (var i = 1; i < pts.length; i++) d += " L" + (pts[i][0] - sx) + " " + (pts[i][1] - sy);
    if (pts.length === 1) d += " l0.01 0";
    livePath.setAttribute("d", d);
  }

  function finalize(d) {
    var pts = d.pts, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    pts.forEach(function (p) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); });
    var cx = (minx + maxx) / 2 - window.scrollX, cy = (miny + maxy) / 2 - window.scrollY;
    // 중심이 화면 밖이면 첫 점 기준
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) { cx = pts[0][0] - window.scrollX; cy = pts[0][1] - window.scrollY; }
    anchorCache = null;
    var sx = window.scrollX, sy = window.scrollY;
    var a = pickAnchor(cx, cy, { l: minx - sx, r: maxx - sx, t: miny - sy, b: maxy - sy });
    var r = a.getBoundingClientRect();
    var L = r.left + window.scrollX, T = r.top + window.scrollY, W = Math.max(r.width, 1), H = Math.max(r.height, 1);
    var s = {
      id: uid(), t: d.t, c: d.c, w: d.w, a: keyOf(a),
      p: pts.map(function (p) { return [+((p[0] - L) / W).toFixed(4), +((p[1] - T) / H).toFixed(4), +p[2].toFixed(2)]; })
    };
    commit({ type: "add", strokes: [s] });
  }

  /* ---------- 지우개 (획 단위) ---------- */
  function erase(e) {
    var x = e.clientX + window.scrollX, y = e.clientY + window.scrollY, R = 14;
    var rects = {};
    mine.forEach(function (s) {
      if (drawing.hit[s.id]) return;
      var a = resolve(s.a), k = s.a.i + "|" + s.a.t;
      var r = rects[k] || (rects[k] = a.getBoundingClientRect());
      if (!r.width && !r.height) return;   // 접힌 영역
      var L = r.left + window.scrollX, T = r.top + window.scrollY;
      for (var i = 0; i < s.p.length; i++) {
        var px = L + s.p[i][0] * r.width, py = T + s.p[i][1] * r.height;
        if (Math.abs(px - x) < R && Math.abs(py - y) < R) {
          drawing.hit[s.id] = 1;
          var n = document.querySelector('svg.ink-layer g[data-id="' + s.id + '"]');
          if (n) n.style.opacity = ".15";
          break;
        }
      }
    });
  }

  /* ---------- 모드 ---------- */
  function setMode(v) {
    on = !!v;
    document.body.classList.toggle("ink-on", on);
    fab.classList.toggle("on", on);
    fab.setAttribute("aria-pressed", on ? "true" : "false");
    if (!on) closeMenu();
    if (on && hidden) { hidden = false; document.body.classList.remove("ink-hidden"); hideBtn.textContent = "필기 숨기기"; }
  }
  function toggle() {
    setMode(!on);
    if (on && !prefs.finger && !("ontouchstart" in window) ) toast("마우스로 필기 · 휠로 스크롤");
    else if (on && !prefs.finger) toast("펜슬로 필기 · 손가락으로 스크롤");
  }
  document.addEventListener("keydown", function (e) {
    if (!on) return;
    var k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if (k === "escape") setMode(false);
  });

  /* ---------- 지우기 ---------- */
  function clearPage() {
    if (!mine.length) return toast("지울 필기가 없어요");
    if (!window.confirm("이 페이지의 필기를 모두 지울까요? (되돌리기로 복구 가능)")) return;
    commit({ type: "del", strokes: mine.slice() });
  }

  /* ---------- 공유: 링크 ---------- */
  function pack(strokes) {
    return JSON.stringify({ v: 1, s: strokes.map(function (s) {
      var flat = [], px = 0, py = 0;
      s.p.forEach(function (p) {
        var x = Math.round(p[0] * 10000), y = Math.round(p[1] * 10000);
        flat.push(x - px, y - py, Math.round(p[2] * 100)); px = x; py = y;
      });
      return [s.t === "hl" ? 1 : 0, s.c, s.w, s.a.i, s.a.t, flat];
    }) });
  }
  function unpack(json) {
    var o = JSON.parse(json);
    return (o.s || []).map(function (r) {
      var f = r[5], pts = [], x = 0, y = 0;
      for (var i = 0; i + 2 < f.length; i += 3) { x += f[i]; y += f[i + 1]; pts.push([x / 10000, y / 10000, f[i + 2] / 100]); }
      return { id: uid(), t: r[0] ? "hl" : "pen", c: r[1], w: r[2], a: { i: r[3], t: r[4] }, p: pts };
    });
  }
  function b64url(bytes) {
    var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64url(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "=";
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function streamBytes(bytes, Stream) {
    var s = new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw"));
    return new Response(s).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function encode(strokes) {
    var raw = new TextEncoder().encode(pack(strokes));
    if (window.CompressionStream) return streamBytes(raw, CompressionStream).then(function (b) { return "z" + b64url(b); });
    return Promise.resolve("j" + b64url(raw));
  }
  function decode(code) {
    var kind = code[0], bytes = fromB64url(code.slice(1));
    var p = kind === "z" ? streamBytes(bytes, DecompressionStream) : Promise.resolve(bytes);
    return p.then(function (b) { return unpack(new TextDecoder().decode(b)); });
  }
  function shareLink() {
    if (!mine.length) return toast("공유할 필기가 없어요");
    encode(mine).then(function (code) {
      var url = location.origin + location.pathname + "#ink=" + code;
      var long = url.length > 8000;
      if (navigator.share) {
        navigator.share({ title: document.title + " · 필기", url: url }).catch(function () {});
        if (long) toast("링크가 길어(" + Math.round(url.length / 1000) + "K자) 메신저에서 잘릴 수 있어요. 파일로 보내는 걸 추천해요.", 4500);
        return;
      }
      copy(url).then(function () {
        toast(long ? "링크 복사됨 · 길이 " + Math.round(url.length / 1000) + "K자라 메신저에서 잘릴 수 있어요. 파일 공유를 추천해요." : "필기 링크를 복사했어요", long ? 4500 : 2200);
      });
    }).catch(function () { toast("링크를 만들지 못했어요. 파일로 내보내기를 써 주세요."); });
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    var t = el("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(t);
  }

  /* ---------- 공유: 파일 ---------- */
  function exportFile() {
    if (!mine.length) return toast("내보낼 필기가 없어요");
    var data = { format: "study-ink", v: 1, page: PAGE, title: document.title, exported: new Date().toISOString(), strokes: mine };
    var name = "필기-" + document.title.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_").slice(0, 40) + "-" + new Date().toISOString().slice(0, 10) + ".json";
    var blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    var file = null;
    try { file = new File([blob], name, { type: "application/json" }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(function () {});
      return;
    }
    var a = el("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importFile(f) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var o = JSON.parse(r.result);
        if (o.format !== "study-ink" || !Array.isArray(o.strokes)) throw new Error("format");
        if (o.page && o.page !== PAGE && !window.confirm("다른 페이지(" + (o.title || o.page) + ")의 필기예요. 그래도 이 페이지에 불러올까요?")) return;
        var add = o.strokes.map(function (s) { return { id: uid(), t: s.t, c: s.c, w: s.w, a: s.a, p: s.p }; });
        exitShared();
        commit({ type: "add", strokes: add });
        toast("필기 " + add.length + "획을 불러왔어요");
      } catch (e) { toast("필기 파일이 아니에요"); }
    };
    r.readAsText(f);
  }

  /* ---------- 공유 링크로 열었을 때 ---------- */
  function showShared(strokes) {
    shared = strokes;
    renderAll();
    syncUndo();
    banner.innerHTML = "";
    banner.appendChild(el("span", "", "공유받은 필기 " + strokes.length + "획을 보고 있어요"));
    var sv = el("button", "pri", "내 필기에 추가"); sv.type = "button";
    sv.onclick = function () {
      var add = shared.map(function (s) { s.id = uid(); return s; });
      exitShared(); commit({ type: "add", strokes: add }); toast("내 필기에 추가했어요");
    };
    var cl = el("button", "", "내 필기 보기"); cl.type = "button";
    cl.onclick = exitShared;
    banner.appendChild(sv); banner.appendChild(cl);
    banner.style.display = "flex";
  }
  function exitShared() {
    if (!shared) return;
    shared = null; banner.style.display = "none";
    if (/^#ink=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
    renderAll(); syncUndo();
  }

  /* ---------- init ---------- */
  syncBar();
  function boot() {
    load().then(function (rec) {
      mine = (rec && Array.isArray(rec.strokes)) ? rec.strokes : [];
      var m = location.hash.match(/^#ink=(.+)$/);
      if (m) return decode(m[1]).then(showShared).catch(function () { toast("공유 링크를 읽지 못했어요"); renderAll(); });
      renderAll();
    });
  }
  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);
  window.addEventListener("beforeprint", closeMenu);
})();
