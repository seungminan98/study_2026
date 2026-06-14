/* ───────────────────────────────────────────────────────────
   학습 도우미 위젯 (Gemini 2.5 Flash + 음성 읽기 · 브라우저 전용)
   - API 키는 이 브라우저(localStorage)에만 저장됩니다. 저장소/서버로 전송되지 않습니다.
   - 현재 페이지 본문(.wrap)을 읽어 근거로 답하고, 답변·페이지를 소리로 읽어줍니다.
   - 음성은 브라우저 내장 음성합성(Web Speech)을 사용해 무료·키 불필요입니다.
   사용: 각 페이지 </body> 앞에  <script src="../assistant.js" defer></script>
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var MODEL = "gemini-2.5-flash";          // 무료 등급. 한도가 더 넉넉하려면 "gemini-2.5-flash-lite"
  var LS_KEY = "gemini_api_key";
  var LS_AUTO = "ai_tts_auto";
  var KEY_URL = "https://aistudio.google.com/apikey";
  var history = [];                         // {role, parts:[{text}]}
  var autoRead = (function () { try { return localStorage.getItem(LS_AUTO) === "1"; } catch (e) { return false; } })();

  /* ---------- 음성 읽기 (브라우저 내장, 무료·키 불필요) ---------- */
  var tts = {
    voice: null,
    init: function () {
      if (!this.supported()) return;
      var pick = function () {
        var vs = speechSynthesis.getVoices() || [];
        tts.voice = vs.filter(function (v) { return /ko/i.test(v.lang); })[0] || null;
      };
      pick();
      if (!tts.voice) speechSynthesis.onvoiceschanged = pick;
    },
    supported: function () { return "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"; },
    speaking: function () { return this.supported() && (speechSynthesis.speaking || speechSynthesis.pending); },
    stop: function () { if (this.supported()) speechSynthesis.cancel(); },
    speak: function (text, onend) {
      if (!this.supported()) return;
      this.stop();
      var parts = ttsChunk(text), i = 0;
      var next = function () {
        if (i >= parts.length) { if (onend) onend(); return; }
        var u = new SpeechSynthesisUtterance(parts[i++]);
        u.lang = "ko-KR";
        if (tts.voice) u.voice = tts.voice;
        u.rate = 1; u.pitch = 1;
        u.onend = next; u.onerror = next;
        speechSynthesis.speak(u);
      };
      next();
    }
  };
  function ttsChunk(text) {
    var clean = String(text).replace(/[*`#>_~]/g, "").replace(/[ \t]+/g, " ").trim();
    var parts = clean.match(/[^.!?。\n]+[.!?。]?/g) || [clean];
    var out = [], buf = "";
    parts.forEach(function (p) {
      p = p.trim(); if (!p) return;
      if ((buf + " " + p).length > 180) { if (buf) out.push(buf); buf = p; }
      else buf = buf ? buf + " " + p : p;
    });
    if (buf) out.push(buf);
    return out;
  }

  /* ---------- 스타일 ---------- */
  var css = [
    ".ai-fab{position:fixed;right:20px;bottom:20px;z-index:9998;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;background:#1a1a1a;color:#fff;border:none;border-radius:24px;padding:12px 18px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.22);}",
    ".ai-fab:hover{background:#000;}",
    ".ai-panel{position:fixed;right:20px;bottom:20px;z-index:9999;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 40px);background:#fff;border:1px solid #1a1a1a;border-radius:10px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;}",
    ".ai-panel.open{display:flex;}",
    ".ai-head{display:flex;align-items:center;gap:6px;padding:11px 12px;border-bottom:1px solid #e2e2e2;}",
    ".ai-head b{font-size:15px;margin-right:2px;}",
    ".ai-head .sp{margin-left:auto;}",
    ".ai-ic{background:none;border:none;color:#666;cursor:pointer;font-size:15px;padding:4px 6px;border-radius:4px;line-height:1;}",
    ".ai-ic:hover{background:#f2f2f2;color:#000;}",
    ".ai-ic.on{background:#1a1a1a;color:#fff;}",
    ".ai-msgs{flex:1;overflow-y:auto;padding:14px;font-size:14.5px;line-height:1.65;}",
    ".ai-m{margin:0 0 12px;}",
    ".ai-m .who{font-size:11px;letter-spacing:.06em;color:#999;text-transform:uppercase;margin-bottom:3px;}",
    ".ai-m.user .bub{background:#1a1a1a;color:#fff;}",
    ".ai-m .bub{display:inline-block;background:#f3f3f3;color:#1a1a1a;padding:9px 12px;border-radius:8px;white-space:pre-wrap;word-break:break-word;max-width:100%;}",
    ".ai-m strong{font-weight:700;}",
    ".ai-listen{margin-top:5px;}",
    ".ai-listen button{font:inherit;font-size:12px;color:#666;background:none;border:1px solid #ddd;border-radius:5px;padding:2px 9px;cursor:pointer;}",
    ".ai-listen button:hover{background:#f2f2f2;color:#000;}",
    ".ai-note{font-size:12.5px;color:#888;background:#fafafa;border:1px solid #eee;border-radius:6px;padding:9px 11px;margin:0 0 12px;}",
    ".ai-foot{border-top:1px solid #e2e2e2;padding:10px;}",
    ".ai-row{display:flex;gap:7px;}",
    ".ai-in{flex:1;font:inherit;font-size:14px;border:1px solid #ccc;border-radius:6px;padding:9px 11px;resize:none;max-height:120px;line-height:1.5;}",
    ".ai-in:focus{outline:none;border-color:#1a1a1a;}",
    ".ai-send{font:inherit;font-weight:600;font-size:14px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:6px;padding:0 14px;cursor:pointer;}",
    ".ai-send:hover{background:#000;}",
    ".ai-send:disabled{opacity:.45;cursor:default;}",
    ".ai-key{padding:14px;font-size:13.5px;color:#444;line-height:1.6;}",
    ".ai-key h4{margin:0 0 6px;font-size:14px;color:#1a1a1a;}",
    ".ai-key a{color:#1a1a1a;}",
    ".ai-key input{width:100%;font:inherit;font-size:13px;border:1px solid #ccc;border-radius:6px;padding:8px 10px;margin:8px 0;}",
    ".ai-key button{font:inherit;font-weight:600;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:6px;padding:8px 14px;cursor:pointer;}",
    "@media (max-width:480px){.ai-panel{height:calc(100vh - 24px);bottom:12px;right:12px;}}"
  ].join("\n");
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- DOM ---------- */
  var fab = el("button", "ai-fab", "🅰 철학 도우미");
  fab.title = "이 페이지 내용을 바탕으로 질문하거나, 소리로 읽어줍니다";
  document.body.appendChild(fab);

  var panel = el("div", "ai-panel");
  panel.innerHTML =
    '<div class="ai-head"><b>철학과 인성 도우미</b>' +
    '<span class="sp"></span>' +
    '<button class="ai-ic" data-act="page" title="이 페이지 소리내어 읽기 / 멈추기">📖</button>' +
    '<button class="ai-ic" data-act="auto" title="답변 자동 읽기 켜기/끄기">🔊</button>' +
    '<button class="ai-ic" data-act="key" title="API 키 설정">⚙</button>' +
    '<button class="ai-ic" data-act="clear" title="대화 지우기">↺</button>' +
    '<button class="ai-ic" data-act="close" title="닫기">✕</button></div>' +
    '<div class="ai-msgs" id="aiMsgs"></div>' +
    '<div class="ai-foot"><div class="ai-row">' +
    '<textarea class="ai-in" id="aiIn" rows="1" placeholder="이 페이지에 대해 물어보세요…"></textarea>' +
    '<button class="ai-send" id="aiSend">전송</button>' +
    '</div></div>';
  document.body.appendChild(panel);

  var msgs = panel.querySelector("#aiMsgs");
  var input = panel.querySelector("#aiIn");
  var sendBtn = panel.querySelector("#aiSend");
  var pageBtn = panel.querySelector('[data-act="page"]');
  var autoBtn = panel.querySelector('[data-act="auto"]');

  fab.onclick = function () { panel.classList.add("open"); fab.style.display = "none"; boot(); input.focus(); };
  panel.querySelector('[data-act="close"]').onclick = function () { tts.stop(); panel.classList.remove("open"); fab.style.display = ""; };
  panel.querySelector('[data-act="clear"]').onclick = function () { tts.stop(); history = []; msgs.innerHTML = ""; greeting(); };
  panel.querySelector('[data-act="key"]').onclick = function () { keyForm(); };
  sendBtn.onclick = send;
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", function () { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; });

  if (!tts.supported()) { pageBtn.style.display = "none"; autoBtn.style.display = "none"; }
  pageBtn.onclick = function () {
    if (tts.speaking()) { tts.stop(); pageBtn.classList.remove("on"); return; }
    pageBtn.classList.add("on");
    tts.speak(readContext(), function () { pageBtn.classList.remove("on"); });
  };
  autoBtn.classList.toggle("on", autoRead);
  autoBtn.onclick = function () {
    autoRead = !autoRead;
    try { localStorage.setItem(LS_AUTO, autoRead ? "1" : "0"); } catch (e) {}
    autoBtn.classList.toggle("on", autoRead);
    if (!autoRead) tts.stop();
  };

  /* ---------- 동작 ---------- */
  function boot() {
    if (msgs.childElementCount) return;
    if (!getKey()) { keyForm(); } else { greeting(); }
  }
  function greeting() {
    note("이 페이지(<b>" + escapeHtml(document.title) + "</b>)의 내용을 읽고 답해드려요. 답변 옆 <b>🔊 듣기</b>나 위쪽 <b>📖</b>(페이지 읽기)로 소리도 들을 수 있어요. 예: “칸트와 공리주의 차이”, “이 표 핵심만 요약”, “예상문제 3개 내줘”.");
  }
  function keyForm() {
    msgs.innerHTML = "";
    var box = el("div", "ai-key");
    box.innerHTML =
      "<h4>Gemini API 키 입력 (무료)</h4>" +
      "구글 AI Studio에서 무료 키를 발급받아 붙여넣으세요. 카드 등록 없이 하루 1,500회까지 무료입니다. " +
      "키는 <b>이 브라우저에만</b> 저장되고 외부로 전송되지 않습니다.<br>" +
      '<a href="' + KEY_URL + '" target="_blank" rel="noopener">→ 무료 키 발급받기</a>' +
      '<input type="password" id="aiKeyIn" placeholder="AIza… 키 붙여넣기" autocomplete="off">' +
      '<button id="aiKeySave">저장</button>';
    msgs.appendChild(box);
    var ki = box.querySelector("#aiKeyIn");
    ki.value = getKey() || "";
    box.querySelector("#aiKeySave").onclick = function () {
      var v = ki.value.trim();
      if (!v) { ki.focus(); return; }
      try { localStorage.setItem(LS_KEY, v); } catch (e) {}
      msgs.innerHTML = ""; greeting();
    };
    ki.focus();
  }

  function send() {
    var q = input.value.trim();
    if (!q) return;
    if (!getKey()) { keyForm(); return; }
    input.value = ""; input.style.height = "auto";
    addMsg("user", q);
    var thinking = addMsg("model", "…", true);
    setBusy(true);
    ask(q).then(function (ans) {
      thinking.remove();
      addMsg("model", ans);
    }).catch(function (err) {
      thinking.remove();
      note("⚠ " + escapeHtml(err.message || String(err)));
      if (/API key|키|401|403|400/i.test(err.message || "")) {
        var b = el("div", "ai-key");
        b.innerHTML = '<button id="aiReKey">API 키 다시 입력</button>';
        msgs.appendChild(b); scrollDown();
        b.querySelector("#aiReKey").onclick = keyForm;
      }
    }).finally(function () { setBusy(false); });
  }

  function ask(question) {
    var ctx = readContext();
    var sys =
      "너는 이 웹페이지의 학습 도우미야. 과목은 철학과 인성(동서양 인성론). " +
      "아래 페이지 내용을 1차 근거로 삼아 한국어로 간결하고 정확하게 답해. " +
      "페이지에 없는 내용은 일반 지식으로 보충하되 그럴 때는 (페이지 밖 보충)이라고 짧게 표시해. " +
      "추측이나 불확실한 건 분명히 밝혀. 불릿은 꼭 필요할 때만 쓰고 보통은 문장으로 답해. " +
      "소리로 읽힐 수 있으니 표나 기호 나열보다 자연스러운 문장을 우선해.\n\n" +
      "[페이지 제목]\n" + document.title + "\n\n[페이지 내용]\n" + ctx;

    history.push({ role: "user", parts: [{ text: question }] });
    if (history.length > 12) history = history.slice(-12);

    var url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      MODEL + ":generateContent?key=" + encodeURIComponent(getKey());
    var body = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: history,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
    };
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var m = (data && data.error && data.error.message) || ("요청 실패 (" + res.status + ")");
          throw new Error(m);
        }
        return data;
      });
    }).then(function (data) {
      var c = data.candidates && data.candidates[0];
      var text = c && c.content && c.content.parts
        ? c.content.parts.map(function (p) { return p.text || ""; }).join("")
        : "";
      if (!text) {
        if (c && c.finishReason === "SAFETY") text = "(안전 필터로 답변이 제한되었어요. 질문을 바꿔보세요.)";
        else text = "(응답이 비어 있어요. 다시 시도해 주세요.)";
      }
      history.push({ role: "model", parts: [{ text: text }] });
      return text;
    });
  }

  /* ---------- 헬퍼 ---------- */
  function readContext() {
    var root = document.querySelector(".wrap") || document.body;
    var t = (root.innerText || root.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
    return t.slice(0, 14000);
  }
  function getKey() { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } }
  function setBusy(b) { sendBtn.disabled = b; sendBtn.textContent = b ? "…" : "전송"; }
  function addMsg(role, text, raw) {
    var m = el("div", "ai-m " + role);
    var who = el("div", "who", role === "user" ? "나" : "도우미");
    var bub = el("div", "bub"); bub.innerHTML = raw ? escapeHtml(text) : fmt(text);
    m.appendChild(who); m.appendChild(bub);
    if (role === "model" && !raw && tts.supported()) {
      m.appendChild(listenBtn(text));
      if (autoRead) tts.speak(text);
    }
    msgs.appendChild(m); scrollDown();
    return m;
  }
  function listenBtn(text) {
    var wrap = el("div", "ai-listen");
    var b = el("button", null, "🔊 듣기");
    b.onclick = function () {
      if (tts.speaking()) { tts.stop(); b.textContent = "🔊 듣기"; return; }
      b.textContent = "■ 멈춤";
      tts.speak(text, function () { b.textContent = "🔊 듣기"; });
    };
    wrap.appendChild(b); return wrap;
  }
  function note(html) { var n = el("div", "ai-note"); n.innerHTML = html; msgs.appendChild(n); scrollDown(); }
  function scrollDown() { msgs.scrollTop = msgs.scrollHeight; }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function fmt(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<strong>$1</strong>");
  }

  tts.init();
})();
/* v1 */
