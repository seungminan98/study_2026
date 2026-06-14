/* ───────────────────────────────────────────────────────────
   학습 도우미 위젯 (Gemini 2.5 Flash + 읽어주기 · 브라우저 전용)
   기능: ① 페이지 내용 기반 질의응답  ② 단락 클릭 읽어주기(읽기 모드)
        ③ 음성 선택 + 속도 조절(부드러운 음성)
   - API 키는 이 브라우저(localStorage)에만 저장됩니다.
   - 음성은 브라우저 내장 음성합성(Web Speech). 엣지(Edge)에서 한국어 자연 음성이 가장 부드럽습니다.
   사용: 각 페이지 </body> 앞에  <script src="../assistant.js" defer></script>
   ─────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var MODEL = "gemini-2.5-flash";
  var LS_KEY = "gemini_api_key";
  var LS_AUTO = "ai_tts_auto";
  var LS_VOICE = "ai_tts_voice";
  var LS_RATE = "ai_tts_rate";
  var KEY_URL = "https://aistudio.google.com/apikey";
  var READ_SEL = ".wrap h1, .wrap h2, .wrap h3, .wrap p, .wrap li, .wrap td, .wrap blockquote, .wrap .key, .wrap .star, .wrap .hot, .wrap .qhead, .wrap .exp";

  var history = [];
  var autoRead = lsGet(LS_AUTO) === "1";
  var prefs = {
    voiceURI: lsGet(LS_VOICE) || "",
    rate: parseFloat(lsGet(LS_RATE)) || 0.95
  };

  /* ===================== 음성 (TTS) ===================== */
  var tts = {
    supported: function () { return "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"; },
    list: function () { return this.supported() ? (speechSynthesis.getVoices() || []) : []; },
    koVoices: function () { return this.list().filter(function (v) { return /ko/i.test(v.lang); }); },
    best: function () {
      var ko = this.koVoices();
      var pref = ko.filter(function (v) { return /natural|online|neural|sunhi|injoon|heami|yuna|google/i.test(v.name); });
      return (pref[0] || ko[0] || null);
    },
    chosen: function () {
      var all = this.list();
      if (prefs.voiceURI) {
        var m = all.filter(function (v) { return v.voiceURI === prefs.voiceURI; })[0];
        if (m) return m;
      }
      return this.best();
    },
    speaking: function () { return this.supported() && (speechSynthesis.speaking || speechSynthesis.pending); },
    stop: function () { if (this.supported()) speechSynthesis.cancel(); },
    speak: function (text, onend) {
      if (!this.supported()) { if (onend) onend(); return; }
      this.stop();
      var v = this.chosen();
      var parts = ttsChunk(text), i = 0;
      var next = function () {
        if (i >= parts.length) { if (onend) onend(); return; }
        var u = new SpeechSynthesisUtterance(parts[i++]);
        u.lang = "ko-KR";
        if (v) u.voice = v;
        u.rate = prefs.rate; u.pitch = 1;
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

  /* ===================== 스타일 ===================== */
  var FONT = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";
  var css = [
    ".ai-fabwrap{position:fixed;right:20px;bottom:20px;z-index:9998;display:flex;flex-direction:column;gap:8px;align-items:flex-end;}",
    ".ai-fab{font:600 14px/1 " + FONT + ";color:#fff;border:none;border-radius:24px;padding:11px 16px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.22);}",
    ".ai-fab.chat{background:#1a1a1a;}",
    ".ai-fab.read{background:#fff;color:#1a1a1a;border:1px solid #1a1a1a;}",
    ".ai-fab:hover{filter:brightness(.92);}",
    ".ai-panel{position:fixed;right:20px;bottom:20px;z-index:9999;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 40px);background:#fff;border:1px solid #1a1a1a;border-radius:10px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.25);font-family:" + FONT + ";}",
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
    /* 읽기 모드 */
    ".ai-rmode .ai-rblock{cursor:pointer;transition:background .12s;border-radius:3px;}",
    ".ai-rmode .ai-rblock:hover{background:#eef3ff;box-shadow:0 0 0 2px #dbe6ff;}",
    ".ai-rblock.ai-reading{background:#fff3b0 !important;box-shadow:0 0 0 3px #ffe87a;}",
    ".ai-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:10000;display:none;align-items:center;gap:6px;background:#1a1a1a;color:#fff;border-radius:30px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,.3);font-family:" + FONT + ";font-size:13px;max-width:calc(100vw - 24px);flex-wrap:wrap;justify-content:center;}",
    ".ai-bar.show{display:flex;}",
    ".ai-bar button{background:none;border:none;color:#fff;font-size:16px;cursor:pointer;padding:4px 7px;border-radius:50%;line-height:1;}",
    ".ai-bar button:hover{background:rgba(255,255,255,.16);}",
    ".ai-bar .lbl{color:#bbb;font-size:11px;margin-left:4px;}",
    ".ai-bar select{font:inherit;font-size:12px;background:#2a2a2a;color:#fff;border:1px solid #444;border-radius:5px;padding:3px 5px;max-width:140px;}",
    ".ai-bar input[type=range]{width:84px;vertical-align:middle;}",
    ".ai-bar .seg{display:flex;align-items:center;gap:4px;padding:0 4px;}",
    ".ai-hint{position:fixed;left:50%;transform:translateX(-50%);bottom:70px;z-index:10000;display:none;background:#fff;color:#333;border:1px solid #1a1a1a;border-radius:8px;padding:8px 12px;font:13px " + FONT + ";box-shadow:0 4px 16px rgba(0,0,0,.18);}",
    ".ai-hint.show{display:block;}",
    "@media (max-width:480px){.ai-panel{height:calc(100vh - 24px);bottom:12px;right:12px;}.ai-bar select{max-width:96px;}}"
  ].join("\n");
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ===================== FAB + 패널 ===================== */
  var fabwrap = el("div", "ai-fabwrap");
  var readFab = el("button", "ai-fab read", "📖 읽어주기");
  readFab.title = "단락을 클릭하면 그 지점부터 읽어줍니다";
  var chatFab = el("button", "ai-fab chat", "🅰 철학 도우미");
  chatFab.title = "이 페이지 내용으로 질문하기";
  if (tts.supported()) fabwrap.appendChild(readFab);
  fabwrap.appendChild(chatFab);
  document.body.appendChild(fabwrap);

  var panel = el("div", "ai-panel");
  panel.innerHTML =
    '<div class="ai-head"><b>철학과 인성 도우미</b>' +
    '<span class="sp"></span>' +
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
  var autoBtn = panel.querySelector('[data-act="auto"]');

  chatFab.onclick = function () { panel.classList.add("open"); fabwrap.style.display = "none"; boot(); input.focus(); };
  panel.querySelector('[data-act="close"]').onclick = function () { tts.stop(); panel.classList.remove("open"); fabwrap.style.display = ""; };
  panel.querySelector('[data-act="clear"]').onclick = function () { tts.stop(); history = []; msgs.innerHTML = ""; greeting(); };
  panel.querySelector('[data-act="key"]').onclick = function () { keyForm(); };
  sendBtn.onclick = send;
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener("input", function () { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; });
  autoBtn.classList.toggle("on", autoRead);
  autoBtn.onclick = function () {
    autoRead = !autoRead; lsSet(LS_AUTO, autoRead ? "1" : "0");
    autoBtn.classList.toggle("on", autoRead); if (!autoRead) tts.stop();
  };

  readFab.onclick = function () { reader.toggle(); };

  /* ===================== 읽기 모드 (read-along) ===================== */
  var reader = {
    on: false, blocks: [], idx: -1, playing: false, bar: null, voiceSel: null,
    build: function () {
      this.bar = el("div", "ai-bar");
      this.bar.innerHTML =
        '<button data-r="prev" title="이전 단락">⏮</button>' +
        '<button data-r="play" title="재생/일시정지">▶</button>' +
        '<button data-r="next" title="다음 단락">⏭</button>' +
        '<button data-r="stop" title="멈추고 닫기">⏹</button>' +
        '<span class="seg"><span class="lbl">속도</span><input type="range" min="0.7" max="1.3" step="0.05" data-r="rate"></span>' +
        '<span class="seg"><span class="lbl">음성</span><select data-r="voice"></select></span>';
      document.body.appendChild(this.bar);
      var self = this;
      this.bar.querySelector('[data-r="prev"]').onclick = function () { self.jump(self.idx - 1); };
      this.bar.querySelector('[data-r="next"]').onclick = function () { self.jump(self.idx + 1); };
      this.bar.querySelector('[data-r="stop"]').onclick = function () { self.toggle(); };
      this.playBtn = this.bar.querySelector('[data-r="play"]');
      this.playBtn.onclick = function () { self.playing ? self.pause() : self.resume(); };
      var rate = this.bar.querySelector('[data-r="rate"]');
      rate.value = prefs.rate;
      rate.oninput = function () { prefs.rate = parseFloat(this.value); lsSet(LS_RATE, this.value); };
      this.voiceSel = this.bar.querySelector('[data-r="voice"]');
      this.voiceSel.onchange = function () {
        prefs.voiceURI = this.value; lsSet(LS_VOICE, this.value);
        if (self.playing) self.speakCurrent();   // 즉시 새 음성으로
      };
      this.fillVoices();
      if (tts.supported()) speechSynthesis.onvoiceschanged = function () { self.fillVoices(); };
    },
    fillVoices: function () {
      if (!this.voiceSel) return;
      var ko = tts.koVoices();
      var list = ko.length ? ko : tts.list();
      var cur = prefs.voiceURI || (tts.best() && tts.best().voiceURI) || "";
      this.voiceSel.innerHTML = list.map(function (v) {
        var sel = v.voiceURI === cur ? " selected" : "";
        var nm = v.name.replace(/Microsoft\s|Google\s/i, "").replace(/\s*\(.*?\)/, "");
        return '<option value="' + v.voiceURI + '"' + sel + '>' + escapeHtml(nm) + (/ko/i.test(v.lang) ? "" : " · " + v.lang) + "</option>";
      }).join("");
      if (!list.length) this.voiceSel.innerHTML = '<option>기본 음성</option>';
    },
    collect: function () {
      var nodes = document.querySelectorAll(READ_SEL);
      var arr = [];
      nodes.forEach(function (n) {
        if (n.closest(".ai-panel") || n.closest(".ai-bar")) return;
        var txt = (n.innerText || n.textContent || "").trim();
        if (txt.length < 2) return;
        // 표 안 헤더(짧은 라벨)도 포함하되 너무 짧은 토막은 제외
        n.classList.add("ai-rblock");
        n.dataset.rIdx = arr.length;
        arr.push({ el: n, text: txt });
      });
      this.blocks = arr;
    },
    toggle: function () {
      this.on ? this.disable() : this.enable();
    },
    enable: function () {
      if (!tts.supported()) { alert("이 브라우저는 음성 읽기를 지원하지 않아요. (엣지/크롬 권장)"); return; }
      if (!this.bar) this.build();
      this.collect();
      if (!this.blocks.length) { alert("이 페이지에서 읽을 본문을 찾지 못했어요."); return; }
      this.on = true;
      document.body.classList.add("ai-rmode");
      this.bar.classList.add("show");
      readFab.classList.add("on"); readFab.textContent = "📖 읽기 끄기";
      this.fillVoices();
      hint("문단을 클릭하면 그 부분부터 읽어요. ▶로 처음부터 재생.");
      var self = this;
      this._click = function (e) {
        var b = e.target.closest(".ai-rblock");
        if (!b || !document.body.contains(b)) return;
        if (b.closest(".ai-panel") || b.closest(".ai-bar")) return;
        var i = parseInt(b.dataset.rIdx, 10);
        if (!isNaN(i)) { e.preventDefault(); self.start(i); }
      };
      document.addEventListener("click", this._click, true);
    },
    disable: function () {
      this.on = false; this.playing = false; tts.stop();
      document.body.classList.remove("ai-rmode");
      if (this.bar) this.bar.classList.remove("show");
      readFab.classList.remove("on"); readFab.textContent = "📖 읽어주기";
      this.clearHi();
      if (this._click) document.removeEventListener("click", this._click, true);
      this.blocks.forEach(function (b) { b.el.classList.remove("ai-rblock"); delete b.el.dataset.rIdx; });
      this.blocks = []; this.idx = -1;
    },
    start: function (i) { this.idx = i; this.playing = true; this.setPlay(true); this.speakCurrent(); },
    speakCurrent: function () {
      var b = this.blocks[this.idx]; if (!b) { this.finish(); return; }
      this.highlight(b.el);
      var self = this;
      tts.speak(b.text, function () { if (self.playing) self.jump(self.idx + 1, true); });
    },
    jump: function (i, auto) {
      if (i < 0) i = 0;
      if (i >= this.blocks.length) { this.finish(); return; }
      this.idx = i;
      if (this.playing || !auto) { this.playing = true; this.setPlay(true); this.speakCurrent(); }
    },
    pause: function () { this.playing = false; this.setPlay(false); tts.stop(); },
    resume: function () { if (this.idx < 0) this.idx = 0; this.playing = true; this.setPlay(true); this.speakCurrent(); },
    finish: function () { this.playing = false; this.setPlay(false); this.clearHi(); },
    setPlay: function (p) { if (this.playBtn) this.playBtn.textContent = p ? "⏸" : "▶"; },
    highlight: function (node) {
      this.clearHi();
      node.classList.add("ai-reading");
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    clearHi: function () {
      var prev = document.querySelector(".ai-rblock.ai-reading");
      if (prev) prev.classList.remove("ai-reading");
    }
  };

  /* ===================== 채팅 동작 ===================== */
  function boot() { if (msgs.childElementCount) return; getKey() ? greeting() : keyForm(); }
  function greeting() {
    note("이 페이지(<b>" + escapeHtml(document.title) + "</b>)의 내용을 읽고 답해드려요. 답변 옆 <b>🔊 듣기</b>로 음성도 가능. 페이지를 통째로 들으려면 오른쪽 아래 <b>📖 읽어주기</b>를 누르세요.");
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
      var v = ki.value.trim(); if (!v) { ki.focus(); return; }
      lsSet(LS_KEY, v); msgs.innerHTML = ""; greeting();
    };
    ki.focus();
  }
  function send() {
    var q = input.value.trim(); if (!q) return;
    if (!getKey()) { keyForm(); return; }
    input.value = ""; input.style.height = "auto";
    addMsg("user", q);
    var thinking = addMsg("model", "…", true);
    setBusy(true);
    ask(q).then(function (ans) { thinking.remove(); addMsg("model", ans); })
      .catch(function (err) {
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
      "소리로 읽힐 수 있으니 자연스러운 문장을 우선해.\n\n" +
      "[페이지 제목]\n" + document.title + "\n\n[페이지 내용]\n" + ctx;
    history.push({ role: "user", parts: [{ text: question }] });
    if (history.length > 12) history = history.slice(-12);
    var url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent?key=" + encodeURIComponent(getKey());
    var body = { systemInstruction: { parts: [{ text: sys }] }, contents: history, generationConfig: { temperature: 0.3, maxOutputTokens: 1024 } };
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) { throw new Error((data && data.error && data.error.message) || ("요청 실패 (" + res.status + ")")); }
          return data;
        });
      }).then(function (data) {
        var c = data.candidates && data.candidates[0];
        var text = c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ""; }).join("") : "";
        if (!text) text = (c && c.finishReason === "SAFETY") ? "(안전 필터로 답변이 제한되었어요.)" : "(응답이 비어 있어요. 다시 시도해 주세요.)";
        history.push({ role: "model", parts: [{ text: text }] });
        return text;
      });
  }

  /* ===================== 헬퍼 ===================== */
  function readContext() {
    var root = document.querySelector(".wrap") || document.body;
    return (root.innerText || root.textContent || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 14000);
  }
  function getKey() { return lsGet(LS_KEY); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function setBusy(b) { sendBtn.disabled = b; sendBtn.textContent = b ? "…" : "전송"; }
  function addMsg(role, text, raw) {
    var m = el("div", "ai-m " + role);
    m.appendChild(el("div", "who", role === "user" ? "나" : "도우미"));
    var bub = el("div", "bub"); bub.innerHTML = raw ? escapeHtml(text) : fmt(text);
    m.appendChild(bub);
    if (role === "model" && !raw && tts.supported()) {
      m.appendChild(listenBtn(text));
      if (autoRead) tts.speak(text);
    }
    msgs.appendChild(m); scrollDown(); return m;
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
  function hint(text) {
    var h = document.querySelector(".ai-hint") || el("div", "ai-hint");
    if (!h.parentNode) document.body.appendChild(h);
    h.textContent = text; h.classList.add("show");
    setTimeout(function () { h.classList.remove("show"); }, 3500);
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function fmt(s) { return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<strong>$1</strong>"); }

  // 음성 목록 미리 로드
  if (tts.supported()) { tts.list(); speechSynthesis.onvoiceschanged = function () { tts.list(); }; }
})();
