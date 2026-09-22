/**
 * ============================================================
 * PHRAORTES STUDY ARTIFACTS — artifacts.js
 * ============================================================
 * Interactive blocks the assistant can emit inside a reply:
 *
 *   ```graph       function / parametric / polar plots — pan, pinch-zoom, tap to trace, zeros & intersections, area under a curve
 *   ```sim         physics simulations — projectile, pendulum, spring, wave, incline (live sliders + readouts)
 *   ```solution    worked solutions, revealable one step at a time
 *   ```quiz        multiple-choice practice with instant feedback and a score
 *   ```flashcards  tap-to-flip cards
 *
 * Nothing here evaluates model text as code: expressions go through a small hand-written parser (no eval / Function),
 * all text is escaped, math is rendered by KaTeX with trust:false (see security.js).
 * Everything is drawn on <canvas>/DOM — no network, no libraries besides KaTeX (optional).
 * If this file is missing, those fences simply show as ordinary code blocks.
 * ============================================================
 */
(function () {
  "use strict";
  if (window.PHRW) return;
  var W = window.PHRW = { version: "1.0", kinds: {} };
  var esc = window.PHR_esc || function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var inline = window.PHR_inline || esc;
  W.esc = esc;

  // ---------------------------------------------------------------- i18n (widget chrome only; content is written by the model)
  var I18N = {
    en: { play: "Play", pause: "Pause", reset: "Reset", expand: "Expand", close: "Close", resetView: "Reset view", trace: "Tap the graph to read values", zeros: "Zeros", cross: "Intersections", area: "Area", reveal: "Step by step", showAll: "Show all", next: "Next step", given: "Given", find: "Find", answer: "Answer", check: "Check", solution: "Worked solution", quiz: "Practice quiz", correct: "Correct!", wrong: "Not quite", nextQ: "Next", finish: "Finish", score: "Score", retry: "Try again", flash: "Flashcards", flip: "Tap to flip", prev: "Prev", speed: "Speed", graph: "Graph", sim: "Simulation", building: "Building", of: "of", second: "Reverse 2nd wave", none: "none" },
    fa: { play: "پخش", pause: "توقف", reset: "ریست", expand: "بزرگ‌نمایی", close: "بستن", resetView: "بازنشانی نما", trace: "برای خواندن مقدار، روی نمودار بزن", zeros: "ریشه‌ها", cross: "نقاط برخورد", area: "مساحت", reveal: "گام‌به‌گام", showAll: "نمایش همه", next: "گام بعدی", given: "داده‌ها", find: "خواسته", answer: "پاسخ", check: "بررسی", solution: "حل تشریحی", quiz: "آزمون تمرینی", correct: "درسته!", wrong: "درست نیست", nextQ: "بعدی", finish: "پایان", score: "امتیاز", retry: "تلاش دوباره", flash: "فلش‌کارت", flip: "برای چرخاندن بزن", prev: "قبلی", speed: "سرعت", graph: "نمودار", sim: "شبیه‌سازی", building: "در حال ساخت", of: "از", second: "موج دوم معکوس", none: "ندارد" }
  };
  W.t = function (lang, k) { return (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k; };

  // ---------------------------------------------------------------- config parsing  ("key: value" lines)
  var KEY_RE = /^\s*([A-Za-z_\u0600-\u06FF][\w*\u0600-\u06FF\-]*)\s*[:=]\s*(.*)$/;
  var FN_RE = /^\s*([A-Za-z]\w*)\s*\(\s*[A-Za-z]\s*\)\s*=\s*(.*)$/;
  W.parseLines = function (body) {
    var out = [], lines = String(body || "").replace(/\r/g, "").split("\n"), last = null;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln.trim()) continue;
      var m = FN_RE.exec(ln), key, val;
      if (m) { key = m[1].toLowerCase(); val = m[2]; }
      else {
        m = KEY_RE.exec(ln);
        if (m) { key = m[1].toLowerCase(); val = m[2]; }
        else {
          var b = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(ln);
          if (b) { key = "-"; val = b[1]; }
          else { if (last) last.val += " " + ln.trim(); continue; }
        }
      }
      last = { key: key, val: val.trim() };
      out.push(last);
    }
    return out;
  };
  W.cfgMap = function (lines) { var m = {}; lines.forEach(function (l) { if (!(l.key in m)) m[l.key] = l.val; }); return m; };
  W.fmt = function (v, sig) {
    if (v === 0 || Math.abs(v) < 1e-10) return "0";
    if (!isFinite(v)) return v > 0 ? "∞" : v < 0 ? "−∞" : "—";
    sig = sig || 4;
    var a = Math.abs(v), s;
    if (a >= 1e6 || a < 1e-3) s = v.toExponential(Math.max(0, sig - 1)).replace(/\.?0+e/, "e").replace("e+", "e");
    else s = String(parseFloat(v.toPrecision(sig)));
    return s.replace("-", "−");
  };

  // ---------------------------------------------------------------- expression parser (NO eval / Function)
  var FN1 = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: function (x) { return 1 / Math.tan(x); }, sec: function (x) { return 1 / Math.cos(x); }, csc: function (x) { return 1 / Math.sin(x); },
    asin: Math.asin, acos: Math.acos, atan: Math.atan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
    deg: function (x) { return x * 180 / Math.PI; }, rad: function (x) { return x * Math.PI / 180; }
  };
  var FN2 = { atan2: Math.atan2, pow: Math.pow, min: Math.min, max: Math.max, hypot: Math.hypot, mod: function (a, b) { return ((a % b) + b) % b; } };
  var CONST = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

  function pw(a, b) { // real-valued power: (-8)^(1/3) = -2 like a school textbook
    if (a >= 0 || Math.abs(b - Math.round(b)) < 1e-12) return Math.pow(a, b);
    for (var q = 3; q <= 9; q += 2) { var pn = b * q; if (Math.abs(pn - Math.round(pn)) < 1e-9) return (Math.round(pn) % 2 ? -1 : 1) * Math.pow(-a, b); }
    return NaN;
  }

  function tokenize(src) {
    var s = String(src)
      .replace(/\\left|\\right/g, "").replace(/\\cdot|\\times/g, "*").replace(/\\(?=[a-zA-Z])/g, "")
      .replace(/[−–]/g, "-").replace(/[×·⋅]/g, "*").replace(/÷/g, "/").replace(/π/g, "pi").replace(/√/g, "sqrt")
      .replace(/²/g, "^2").replace(/³/g, "^3").replace(/\*\*/g, "^").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\[/g, "(").replace(/\]/g, ")");
    var t = [], i = 0, m;
    while (i < s.length) {
      var c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
        if (!m) throw new Error("bad number");
        t.push({ k: "n", v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (/[A-Za-z_]/.test(c)) { m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(s.slice(i)); t.push({ k: "i", v: m[0].toLowerCase() === m[0] ? m[0] : m[0] }); i += m[0].length; continue; }
      if ("+-*/^(),%".indexOf(c) >= 0) { t.push({ k: "o", v: c }); i++; continue; }
      if (c === "=" || c === "<" || c === ">") throw new Error("unexpected " + c);
      i++; // silently drop stray symbols
    }
    return t;
  }

  function compile(src) {
    var toks = tokenize(src), p = 0, vars = {};
    function peek() { return toks[p]; }
    function isFactorStart(t) { return t && (t.k === "n" || t.k === "i" || (t.k === "o" && t.v === "(")); }
    function expr() {
      var l = term();
      while (peek() && peek().k === "o" && (peek().v === "+" || peek().v === "-")) {
        var op = toks[p++].v, r = term(), a = l;
        l = op === "+" ? (function (a, r) { return function (s) { return a(s) + r(s); }; })(a, r) : (function (a, r) { return function (s) { return a(s) - r(s); }; })(a, r);
      }
      return l;
    }
    function term() {
      var l = unary();
      for (;;) {
        var t = peek();
        if (t && t.k === "o" && (t.v === "*" || t.v === "/" || t.v === "%")) {
          p++; var r = unary(), a = l, op = t.v;
          l = op === "*" ? (function (a, r) { return function (s) { return a(s) * r(s); }; })(a, r)
            : op === "/" ? (function (a, r) { return function (s) { return a(s) / r(s); }; })(a, r)
              : (function (a, r) { return function (s) { return a(s) % r(s); }; })(a, r);
        } else if (isFactorStart(t)) { // implicit multiplication: 2x, 3(x+1), x sin(x)
          var r2 = unary(), a2 = l;
          l = (function (a, r) { return function (s) { return a(s) * r(s); }; })(a2, r2);
        } else break;
      }
      return l;
    }
    function unary() {
      var t = peek();
      if (t && t.k === "o" && t.v === "-") { p++; var f = unary(); return function (s) { return -f(s); }; }
      if (t && t.k === "o" && t.v === "+") { p++; return unary(); }
      return power();
    }
    function power() {
      var b = primary(), t = peek();
      if (t && t.k === "o" && t.v === "^") { p++; var e = unary(); return function (s) { return pw(b(s), e(s)); }; }
      return b;
    }
    function primary() {
      var t = toks[p++];
      if (!t) throw new Error("unexpected end");
      if (t.k === "n") { var v = t.v; return function () { return v; }; }
      if (t.k === "o" && t.v === "(") { var e = expr(); var c = toks[p++]; if (!c || c.v !== ")") throw new Error("missing )"); return e; }
      if (t.k === "i") {
        var name = t.v, lname = name.toLowerCase(), nx = peek();
        if (nx && nx.k === "o" && nx.v === "(" && (FN1[lname] || FN2[lname])) {
          p++; var args = [];
          if (!(peek() && peek().v === ")")) { args.push(expr()); while (peek() && peek().v === ",") { p++; args.push(expr()); } }
          var cl = toks[p++]; if (!cl || cl.v !== ")") throw new Error("missing )");
          if (FN2[lname]) { var f2 = FN2[lname], a0 = args[0], a1 = args[1] || args[0]; return function (s) { return f2(a0(s), a1(s)); }; }
          var f1 = FN1[lname], a = args[0]; return function (s) { return f1(a(s)); };
        }
        if (FN1[lname] && !(nx && nx.v === "(")) { // "sin x" without brackets: apply to the next factor
          var arg = power(), fn = FN1[lname]; return function (s) { return fn(arg(s)); };
        }
        vars[name] = 1;
        return function (s) { var v = s[name]; if (v !== undefined) return v; var cv = CONST[lname]; return cv !== undefined ? cv : NaN; };
      }
      throw new Error("unexpected " + t.v);
    }
    var f = expr();
    if (p < toks.length) throw new Error("unexpected " + toks[p].v);
    return { fn: f, vars: vars };
  }
  W.math = {
    compile: compile,
    evaluate: function (src, scope) { try { return compile(src).fn(scope || {}); } catch (e) { return NaN; } },
    FN1: FN1
  };

  // ---------------------------------------------------------------- shared UI plumbing
  var CSS = "\
.phr-w{position:relative;margin:14px 0;border:1px solid var(--brd,rgba(255,255,255,.12));border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));overflow:hidden;direction:ltr;text-align:left;font-family:'Space Grotesk','Vazirmatn',sans-serif;color:rgba(255,255,255,.9);-webkit-user-select:none;user-select:none}\
.phr-w *{box-sizing:border-box}\
.phr-w.fa{direction:rtl;text-align:right}\
.phr-w-head{display:flex;align-items:center;gap:10px;padding:12px 14px 8px}\
.phr-w-badge{font:600 9.5px 'Space Mono',monospace;letter-spacing:1.4px;text-transform:uppercase;color:var(--p,#D4A24C);background:var(--pa-12,rgba(212,162,76,.12));padding:3px 8px;border-radius:20px;white-space:nowrap}\
.phr-w-title{flex:1;min-width:0;font:600 14px/1.35 'Syne','Vazirmatn',sans-serif;color:#fff}\
.phr-w-btn{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:rgba(255,255,255,.85);border-radius:11px;padding:6px 11px;font:500 12px 'Space Grotesk','Vazirmatn',sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;white-space:nowrap;transition:background .15s,transform .15s}\
.phr-w-btn:active{transform:scale(.95);background:rgba(255,255,255,.1)}\
.phr-w-btn.on{background:var(--pa-12,rgba(212,162,76,.14));border-color:var(--pa-38,rgba(212,162,76,.4));color:var(--p,#D4A24C)}\
.phr-w-btn.gold{background:linear-gradient(135deg,var(--p-hi,#F6E3A6),var(--p,#D4A24C));color:#1a1005;border-color:transparent;font-weight:700}\
.phr-w canvas{display:block;width:100%;touch-action:none;background:#0b0806}\
.phr-w-body{padding:12px 14px 14px}\
.phr-legend{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px 4px}\
.phr-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border-radius:20px;background:rgba(255,255,255,.05);font:12px 'Space Mono',monospace;color:rgba(255,255,255,.8);max-width:100%}\
.phr-chip i{width:9px;height:9px;border-radius:50%;flex-shrink:0}\
.phr-info{padding:2px 14px 12px;font:11.5px 'Space Mono',monospace;color:rgba(255,255,255,.55);line-height:1.7}\
.phr-info b{color:rgba(255,255,255,.85);font-weight:600}\
.phr-controls{display:grid;grid-template-columns:1fr;gap:9px;padding:12px 14px 4px}\
.phr-sl{display:grid;grid-template-columns:96px 1fr 74px;align-items:center;gap:10px;font-size:12px}\
.phr-sl-l{color:rgba(255,255,255,.65);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.phr-sl-v{font:12px 'Space Mono',monospace;color:var(--p,#D4A24C);text-align:right;white-space:nowrap}\
.phr-w.fa .phr-sl-v{text-align:left}\
.phr-sl input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:28px;background:transparent;margin:0;touch-action:pan-y}\
.phr-sl input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:linear-gradient(90deg,var(--p,#D4A24C) var(--fill,50%),rgba(255,255,255,.14) var(--fill,50%))}\
.phr-sl input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-9px;border-radius:50%;background:#fff;border:3px solid var(--p,#D4A24C);box-shadow:0 2px 8px rgba(0,0,0,.5)}\
.phr-sl input[type=range]::-moz-range-track{height:4px;border-radius:4px;background:rgba(255,255,255,.14)}\
.phr-sl input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#fff;border:3px solid var(--p,#D4A24C)}\
.phr-bar{display:flex;flex-wrap:wrap;gap:8px;padding:8px 14px 12px;align-items:center}\
.phr-reads{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:8px;padding:6px 14px 14px}\
.phr-read{background:rgba(255,255,255,.045);border-radius:12px;padding:8px 10px}\
.phr-read small{display:block;font:10px 'Space Mono',monospace;letter-spacing:.3px;color:rgba(255,255,255,.5)}\
.phr-read span{display:block;font:600 13.5px 'Space Mono',monospace;color:#fff;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.phr-formula{padding:2px 14px 12px;font-size:14px;overflow-x:auto;-webkit-user-select:text;user-select:text}\
.phr-formula .katex-display{margin:.4em 0}\
.phr-note{padding:0 14px 12px;font-size:12.5px;line-height:1.7;color:rgba(255,255,255,.6)}\
.phr-skel{padding:22px 16px;font:12px 'Space Mono',monospace;color:rgba(255,255,255,.5);display:flex;align-items:center;gap:10px}\
.phr-skel::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--p,#D4A24C);animation:agentStepPulse 1.1s ease-in-out infinite}\
.phr-err{padding:14px;font:12px 'Space Mono',monospace;color:#ff8a80}\
.phr-w.phr-full{position:fixed;inset:0;z-index:99990;margin:0;border-radius:0;overflow:auto;background:#0b0806;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}\
/* solution */\
.phr-sol-tags{display:flex;flex-direction:column;gap:6px;padding:2px 14px 6px}\
.phr-sol-tag{font-size:13.5px;line-height:1.7;-webkit-user-select:text;user-select:text}\
.phr-sol-tag b.k{font:600 10px 'Space Mono',monospace;letter-spacing:1px;text-transform:uppercase;color:var(--p,#D4A24C);margin-inline-end:8px}\
.phr-w .phr-steps{margin:6px 0 0;padding:4px 14px 6px;counter-reset:st}\
.phr-w .phr-step{position:relative;padding:0 0 14px 40px;min-height:34px;counter-increment:st;animation:phrStepIn .35s var(--ease,ease) both}\
.phr-w.fa .phr-step{padding:0 40px 14px 0}\
.phr-step::before{content:counter(st);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--pa-12,rgba(212,162,76,.14));color:var(--p,#D4A24C);font:700 12px 'Space Mono',monospace;display:flex;align-items:center;justify-content:center}\
.phr-w.fa .phr-step::before{left:auto;right:0}\
.phr-step::after{content:'';position:absolute;left:13.5px;top:32px;bottom:2px;width:1px;background:rgba(255,255,255,.1)}\
.phr-w.fa .phr-step::after{left:auto;right:13.5px}\
.phr-step:last-child::after{display:none}\
.phr-step-l{font-size:13.5px;line-height:1.6;color:rgba(255,255,255,.92);padding-top:3px;-webkit-user-select:text;user-select:text}\
.phr-step-m{margin-top:4px;overflow-x:auto;overflow-y:hidden;-webkit-user-select:text;user-select:text}\
.phr-step-m .katex-display{margin:.35em 0;text-align:left}\
.phr-ans{margin:2px 14px 14px;padding:12px 14px;border-radius:14px;border:1px solid var(--pa-38,rgba(212,162,76,.4));background:var(--pa-12,rgba(212,162,76,.1));animation:phrStepIn .4s var(--ease,ease) both}\
.phr-ans small{display:block;font:600 10px 'Space Mono',monospace;letter-spacing:1.2px;text-transform:uppercase;color:var(--p,#D4A24C);margin-bottom:4px}\
.phr-ans .katex-display{margin:.3em 0}\
@keyframes phrStepIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}\
/* quiz + flashcards */\
.phr-q{padding:4px 14px 6px}\
.phr-q-t{font-size:14.5px;line-height:1.75;font-weight:500;margin:6px 0 12px;-webkit-user-select:text;user-select:text}\
.phr-q-prog{height:3px;background:rgba(255,255,255,.08);border-radius:3px;margin:0 14px 4px;overflow:hidden}\
.phr-q-prog i{display:block;height:100%;background:linear-gradient(90deg,var(--p,#D4A24C),var(--p-hi,#F6E3A6));transition:width .4s var(--ease,ease)}\
.phr-opt{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:inherit;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:rgba(255,255,255,.9);border-radius:14px;padding:11px 13px;margin-bottom:8px;font:13.5px/1.6 'Space Grotesk','Vazirmatn',sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s,border-color .15s,transform .12s}\
.phr-opt:active{transform:scale(.985)}\
.phr-opt b{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.08);font:700 11px 'Space Mono',monospace;display:flex;align-items:center;justify-content:center;margin-top:1px}\
.phr-opt.ok{border-color:#3fd07a;background:rgba(63,208,122,.13)}\
.phr-opt.ok b{background:#3fd07a;color:#04140a}\
.phr-opt.bad{border-color:#ff6b6b;background:rgba(255,107,107,.12)}\
.phr-opt.bad b{background:#ff6b6b;color:#1a0505}\
.phr-opt[disabled]{cursor:default}\
.phr-exp{margin:2px 0 10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);font-size:13px;line-height:1.7;color:rgba(255,255,255,.75);animation:phrStepIn .3s var(--ease,ease) both}\
.phr-score{text-align:center;padding:18px 14px 8px}\
.phr-score big{display:block;font:700 40px 'Syne','Vazirmatn',sans-serif;color:var(--p,#D4A24C)}\
.phr-card{margin:8px 14px;min-height:150px;perspective:900px;cursor:pointer}\
.phr-card-in{position:relative;min-height:150px;transition:transform .5s var(--ease,ease);transform-style:preserve-3d}\
.phr-card.flip .phr-card-in{transform:rotateY(180deg)}\
.phr-face{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:16px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);backface-visibility:hidden;-webkit-backface-visibility:hidden;font-size:15px;line-height:1.7;overflow:auto}\
.phr-face.back{transform:rotateY(180deg);background:var(--pa-12,rgba(212,162,76,.1));border-color:var(--pa-38,rgba(212,162,76,.35))}\
.phr-face small{position:absolute;top:8px;left:12px;font:9.5px 'Space Mono',monospace;letter-spacing:1px;color:rgba(255,255,255,.4)}\
@media (max-width:430px){.phr-sl{grid-template-columns:78px 1fr 64px}}\
@media (prefers-reduced-motion:reduce){.phr-step,.phr-ans,.phr-exp{animation:none}.phr-card-in{transition:none}}\
";
  (function () { var st = document.createElement("style"); st.id = "phr-artifacts-css"; st.textContent = CSS; document.head.appendChild(st); })();

  var PALETTE = ["#E8B84A", "#5AC8FA", "#FF6B81", "#7BE495", "#B18CFF", "#FF9F43", "#4DD4C0", "#F78FB3"];
  W.PALETTE = PALETTE;
  function accent() { try { var v = getComputedStyle(document.body).getPropertyValue("--p").trim(); return v || "#D4A24C"; } catch (e) { return "#D4A24C"; } }
  W.accent = accent;
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  W.el = el;
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  W.clamp = clamp;

  // canvas that follows its container width and the device pixel ratio
  W.fitCanvas = function (cv, aspect, minH, maxH) {
    var dpr = Math.min(3, window.devicePixelRatio || 1), w = cv.parentElement.clientWidth || 320;
    var h = Math.round(clamp(w * aspect, minH || 180, maxH || 420));
    if (cv.parentElement.closest(".phr-full")) h = Math.round(clamp(window.innerHeight * 0.5, 240, 640));
    cv.style.height = h + "px"; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.direction = "ltr";
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  };

  // expand / collapse (full screen) — shared by graph and sim
  W.attachExpand = function (root, btn, onResize) {
    btn.addEventListener("click", function () {
      var full = root.classList.toggle("phr-full");
      btn.textContent = full ? W.t(root._lang, "close") + " ✕" : "⤢";
      try { window.PHR_haptic && window.PHR_haptic("light"); } catch (e) {}
      setTimeout(onResize, 30);
    });
  };
  W.observeResize = function (root, cb) {
    if (window.ResizeObserver) { var t = 0; new ResizeObserver(function () { clearTimeout(t); t = setTimeout(cb, 40); }).observe(root); }
    else window.addEventListener("resize", cb);
  };

  // ---------------------------------------------------------------- entry points used by renderMD
  var ALIAS = { graph: "graph", plot: "graph", "function-plot": "graph", sim: "sim", simulation: "sim", physics: "sim", solution: "solution", steps: "solution", worked: "solution", quiz: "quiz", practice: "quiz", flashcards: "flash", cards: "flash", flashcard: "flash" };
  var LABEL = { graph: "graph", sim: "sim", solution: "solution", quiz: "quiz", flash: "flash" };
  W.kindOf = function (lang) { return ALIAS[String(lang || "").toLowerCase()] || null; };
  W.kinds = { graph: 1, sim: 1, solution: 1, quiz: 1, flash: 1 };
  // Returns TRUSTED html (the caller wraps it in PHR_trusted). Config is carried in an encoded attribute, mounted after insertion.
  W.html = function (kind, body, streaming) {
    kind = ALIAS[String(kind).toLowerCase()] || kind;
    if (streaming) return '<div class="phr-w"><div class="phr-skel">' + esc(W.t("en", "building")) + " " + esc(kind) + "…</div></div>";
    return '<div class="phr-w" data-w="' + esc(kind) + '" data-cfg="' + encodeURIComponent(String(body || "")) + '"></div>';
  };

  W.mount = function (root) {
    // `_m` lives on the JS object, not in the markup: a copy made by innerHTML (focus view, clones…) has the attribute but no
    // behaviour, so it is simply mounted again from its data-cfg.
    if (!root || root._m) return;
    root._m = true; root.setAttribute("data-mounted", "1");
    var kind = root.getAttribute("data-w"), body = "";
    try { body = decodeURIComponent(root.getAttribute("data-cfg") || ""); } catch (e) {}
    var lines = W.parseLines(body), map = W.cfgMap(lines);
    root._lang = /^(fa|persian|farsi|fas)/i.test(map.lang || "") ? "fa" : "en";
    if (root._lang === "fa") root.classList.add("fa");
    try {
      var build = W.builders[kind];
      if (!build) throw new Error("unknown block: " + kind);
      build(root, lines, map);
    } catch (e) {
      console.warn("[PHRW] " + kind + ":", e);
      root.innerHTML = '<div class="phr-w-head"><span class="phr-w-badge">' + esc(kind) + '</span></div><div class="phr-err">' + esc(e && e.message || e) + '</div><pre style="margin:0;padding:0 14px 14px;font:11px/1.6 \'Space Mono\',monospace;color:rgba(255,255,255,.55);white-space:pre-wrap;-webkit-user-select:text;user-select:text">' + esc(body) + "</pre>";
    }
  };
  W.builders = {};

  // auto-mount whatever the chat inserts (live stream, history, regenerate…) — independent of the render path
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.classList && node.classList.contains("phr-w") && node.getAttribute("data-w")) { W.mount(node); return; }
    var list = node.querySelectorAll ? node.querySelectorAll(".phr-w[data-w]") : [];
    for (var i = 0; i < list.length; i++) W.mount(list[i]);
  }
  var queued = false, pending = [];
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) for (var j = 0; j < muts[i].addedNodes.length; j++) pending.push(muts[i].addedNodes[j]);
    if (!queued) { queued = true; (window.requestAnimationFrame || setTimeout)(function () { queued = false; var p = pending; pending = []; p.forEach(scan); }); }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", function () { scan(document.body); });
  if (document.body) scan(document.body);

  // ================================================================ GRAPH
  function parseRange(str) {
    str = String(str == null ? "" : str).trim().replace(/^[\[(]\s*/, "").replace(/\s*[\])]$/, "");
    var parts = str.split(/\s*(?:\.\.\.?|\bto\b|;|,)\s*/i);
    if (parts.length < 2) return null;
    var a = W.math.evaluate(parts[0]), b = W.math.evaluate(parts[1]);
    return isFinite(a) && isFinite(b) && a < b ? [a, b] : null;
  }
  W.parseRange = parseRange;
  function niceStep(range, target) {
    var raw = range / Math.max(1, target), pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
  }
  W.niceStep = niceStep;
  function quantile(sorted, q) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]; }
  function findRoots(g, x0, x1, N, limit) {
    var out = [], prev = g(x0), px = x0, i;
    for (i = 1; i <= N; i++) {
      var x = x0 + (x1 - x0) * i / N, y = g(x);
      if (isFinite(prev) && isFinite(y) && (prev === 0 || (prev < 0) !== (y < 0))) {
        var a = px, b = x, fa = prev;
        for (var it = 0; it < 48; it++) { var m = (a + b) / 2, fm = g(m); if (!isFinite(fm)) break; if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m; }
        var r = (a + b) / 2, fr = g(r);
        if (isFinite(fr) && Math.abs(fr) < 1e-5 * Math.max(1, Math.abs(prev), Math.abs(y)) + 1e-7 && (!out.length || Math.abs(out[out.length - 1] - r) > (x1 - x0) * 1e-6)) out.push(r);
        if (out.length >= limit) break;
      }
      prev = y; px = x;
    }
    return out;
  }
  function simpson(f, a, b, n) {
    n = n % 2 ? n + 1 : n; var h = (b - a) / n, s = f(a) + f(b);
    for (var i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
    return s * h / 3;
  }

  W.builders.graph = function (root, lines, map) {
    var lang = root._lang, T = function (k) { return W.t(lang, k); };
    var scope = {}, curves = [], points = [], fills = [], errors = [];
    var xr = null, yr = null, equal = false, grid = true;
    var subs = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉" };
    function label(name) { return name.replace(/\d/g, function (d) { return subs[d]; }); }
    function addFunc(name, expr) {
      try { var c = W.math.compile(expr); curves.push({ kind: "fn", name: name, src: expr, f: c.fn, color: PALETTE[curves.length % PALETTE.length] }); }
      catch (e) { errors.push(name + ": " + e.message); }
    }
    function parseParam(v, polar) {
      var m = polar ? /^\s*r\s*=\s*(.*?)(?:\s*,\s*t\s*[=:]\s*(.*))?$/i.exec(v) : /^\s*x\s*(?:\(t\))?\s*=\s*(.*?)\s*,\s*y\s*(?:\(t\))?\s*=\s*(.*?)(?:\s*,\s*t\s*[=:]\s*(.*))?$/i.exec(v);
      if (!m) { errors.push((polar ? "polar" : "param") + ": bad format"); return; }
      try {
        var tr = parseRange(polar ? m[2] : m[3]) || [0, 2 * Math.PI], fx, fy;
        if (polar) { var r = W.math.compile(m[1]).fn; fx = function (s) { return r(s) * Math.cos(s.t); }; fy = function (s) { return r(s) * Math.sin(s.t); }; }
        else { fx = W.math.compile(m[1]).fn; fy = W.math.compile(m[2]).fn; }
        curves.push({ kind: "param", name: polar ? "r(t)" : "(x(t), y(t))", src: polar ? "r = " + m[1] : "x = " + m[1] + ", y = " + m[2], fx: fx, fy: fy, t0: tr[0], t1: tr[1], color: PALETTE[curves.length % PALETTE.length] });
      } catch (e) { errors.push("param: " + e.message); }
    }
    lines.forEach(function (l) {
      var k = l.key, v = l.val, m;
      if (k === "title" || k === "lang" || k === "height" || k === "note") return;
      if (k === "xmin" || k === "xmax" || k === "ymin" || k === "ymax") { var n = W.math.evaluate(v); if (isFinite(n)) { (k[0] === "x" ? (xr = xr || [-10, 10]) : (yr = yr || [-10, 10]))[k.slice(1) === "min" ? 0 : 1] = n; } return; }
      if (k === "grid") { grid = !/^(off|no|false|0)/i.test(v); return; }
      if (k === "equal" || k === "square") { equal = !/^(off|no|false|0)/i.test(v); return; }
      if (k === "param" || k === "parametric") { parseParam(v, false); return; }
      if (k === "polar") { parseParam(v, true); return; }
      if (k === "params" || k === "let" || k === "vars") { v.split(/[,;]/).forEach(function (kv) { var mm = /^\s*([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(kv); if (mm) { var val = W.math.evaluate(mm[2], scope); if (isFinite(val)) scope[mm[1]] = val; } }); return; }
      if (k === "points" || k === "point" || k === "pt") {
        var re = /([A-Za-z]\w*)?\s*\(\s*([^,()]+?)\s*,\s*([^()]+?)\s*\)/g;
        while ((m = re.exec(v))) { var px = W.math.evaluate(m[2], scope), py = W.math.evaluate(m[3], scope); if (isFinite(px) && isFinite(py)) points.push({ x: px, y: py, label: m[1] || "" }); }
        return;
      }
      if (k === "fill" || k === "area" || k === "shade") {
        var fm = /^\s*([fgh]\d*|y\d*)?\s*(?:from\s+)?(.+)$/i.exec(v), rg = fm && parseRange(fm[2]);
        if (rg) fills.push({ ref: fm[1] || "", a: rg[0], b: rg[1] });
        return;
      }
      if (k === "x" || k === "xrange" || k === "xlim" || k === "domain") { var r1 = parseRange(v); if (r1) xr = r1; return; }
      if ((k === "y" || k === "yrange" || k === "ylim") && /\.\.|\bto\b/.test(v) && !/[a-zA-Z]/.test(v.replace(/\bto\b|pi|e/gi, ""))) { var r2 = parseRange(v); if (r2) { yr = r2; return; } }
      if (/^(f|g|h|y|fn|curve|p)\d*$/.test(k)) { addFunc(/^[fgh]\d*$/.test(k) ? k : /^y\d*$/.test(k) ? k : "f" + (curves.length + 1), v.replace(/^\s*(?:y|f\d*|g|h)\s*(?:\(\s*x\s*\))?\s*=\s*/i, "")); return; }
      if (k === "-") { var bm = /^\s*(y|f\d*|g|h)\s*(?:\(\s*x\s*\))?\s*=\s*(.+)$/i.exec(v); if (bm) addFunc(bm[1].toLowerCase(), bm[2]); }
    });
    if (!curves.length && !points.length) throw new Error(errors[0] || "graph: no function found (use  f1: sin(x) )");
    if (!root.querySelector) return;

    // ---- DOM
    root.innerHTML = '<div class="phr-w-head"><span class="phr-w-badge">' + esc(T("graph")) + '</span><span class="phr-w-title">' + esc(map.title || "") + '</span><button class="phr-w-btn" data-a="reset" title="' + esc(T("resetView")) + '">⟲</button><button class="phr-w-btn" data-a="full">⤢</button></div><div class="phr-cvwrap"><canvas></canvas></div><div class="phr-legend"></div><div class="phr-info"></div>';
    var cv = root.querySelector("canvas"), legend = root.querySelector(".phr-legend"), info = root.querySelector(".phr-info");
    curves.forEach(function (c) { legend.insertAdjacentHTML("beforeend", '<span class="phr-chip"><i style="background:' + c.color + '"></i>' + esc(c.kind === "fn" ? label(c.name) + "(x) = " + c.src : c.name + ": " + c.src) + "</span>"); });
    if (errors.length) legend.insertAdjacentHTML("beforeend", '<span class="phr-chip" style="color:#ff8a80">' + esc(errors[0]) + "</span>");
    if (!curves.filter(function (c) { return c.kind === "fn"; }).length) { legend.style.display = curves.length ? "" : "none"; }

    // ---- initial view
    function evalAt(c, x) { scope.x = x; return c.f(scope); }
    var fnCurves = curves.filter(function (c) { return c.kind === "fn"; });
    var x0 = xr ? xr[0] : -10, x1 = xr ? xr[1] : 10;
    if (!xr && !fnCurves.length) { // only parametric/points: range from the data
      var xs = [], ys = [];
      curves.forEach(function (c) { for (var i = 0; i <= 200; i++) { scope.t = c.t0 + (c.t1 - c.t0) * i / 200; var X = c.fx(scope), Y = c.fy(scope); if (isFinite(X) && isFinite(Y)) { xs.push(X); ys.push(Y); } } });
      points.forEach(function (p) { xs.push(p.x); ys.push(p.y); });
      if (xs.length) { var mnx = Math.min.apply(null, xs), mxx = Math.max.apply(null, xs), mny = Math.min.apply(null, ys), mxy = Math.max.apply(null, ys), px = (mxx - mnx) * 0.15 || 1, py = (mxy - mny) * 0.15 || 1; x0 = mnx - px; x1 = mxx + px; if (!yr) yr = [mny - py, mxy + py]; }
    }
    var y0, y1;
    if (yr) { y0 = yr[0]; y1 = yr[1]; }
    else {
      var vals = [];
      fnCurves.forEach(function (c) { for (var i = 0; i <= 240; i++) { var v = evalAt(c, x0 + (x1 - x0) * i / 240); if (isFinite(v) && Math.abs(v) < 1e6) vals.push(v); } });
      points.forEach(function (p) { vals.push(p.y); });
      vals.sort(function (a, b) { return a - b; });
      if (vals.length) {
        var lo = quantile(vals, 0.03), hi = quantile(vals, 0.97);
        if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
        if (lo > 0 && lo < (hi - lo) * 0.9) lo = 0; if (hi < 0 && -hi < (hi - lo) * 0.9) hi = 0;
        var pad = (hi - lo) * 0.14; y0 = lo - pad; y1 = hi + pad;
      } else { y0 = -10; y1 = 10; }
    }
    var base = { x0: x0, x1: x1, y0: y0, y1: y1 }, view = { x0: x0, x1: x1, y0: y0, y1: y1 };

    // ---- analysis on the initial window: zeros, intersections, area
    var marks = [], infoHtml = "";
    (function analyse() {
      var zs = [];
      fnCurves.slice(0, 4).forEach(function (c) {
        var r = findRoots(function (x) { return evalAt(c, x); }, x0, x1, 900, 6);
        r.forEach(function (x) { marks.push({ x: x, y: 0, c: c.color }); });
        if (r.length) zs.push("<b>" + esc(label(c.name)) + "</b> <bdi dir=\"ltr\">x = " + r.map(function (v) { return W.fmt(v); }).join(", ") + "</bdi>");
      });
      if (zs.length) infoHtml += esc(T("zeros")) + " · " + zs.join(" · ") + "<br>";
      var xs = [];
      for (var i = 0; i < Math.min(3, fnCurves.length); i++) for (var j = i + 1; j < Math.min(3, fnCurves.length); j++) {
        (function (a, b) {
          var r = findRoots(function (x) { return evalAt(a, x) - evalAt(b, x); }, x0, x1, 900, 5);
          r.forEach(function (x) { var y = evalAt(a, x); if (isFinite(y)) { marks.push({ x: x, y: y, c: "#fff", hollow: true }); xs.push("(" + W.fmt(x) + ", " + W.fmt(y) + ")"); } });
        })(fnCurves[i], fnCurves[j]);
      }
      if (xs.length) infoHtml += esc(T("cross")) + " · <bdi dir=\"ltr\">" + xs.slice(0, 5).join("  ") + "</bdi><br>";
      fills.forEach(function (f) {
        var c = fnCurves.filter(function (q) { return q.name === f.ref; })[0] || fnCurves[0]; if (!c) return;
        f.c = c; var val = simpson(function (x) { var v = evalAt(c, x); return isFinite(v) ? v : 0; }, f.a, f.b, 600);
        infoHtml += esc(T("area")) + " · <bdi dir=\"ltr\"><b>∫ " + esc(label(c.name)) + " dx</b> [" + W.fmt(f.a) + ", " + W.fmt(f.b) + "] ≈ <b>" + W.fmt(val, 5) + "</b></bdi><br>";
      });
      infoHtml += '<span class="phr-hint">' + esc(T("trace")) + "</span>";
      info.innerHTML = infoHtml;
    })();

    // ---- drawing
    var S = null, traceX = null, raf = 0;
    var userMoved = false;
    function fitEqual() { // 1 unit is the same length on both axes: expand whichever axis has room, never crop the data
      var bx = base.x1 - base.x0, by = base.y1 - base.y0, s = Math.min(S.w / bx, S.h / by), cx0 = (base.x0 + base.x1) / 2, cy0 = (base.y0 + base.y1) / 2;
      view.x0 = cx0 - S.w / s / 2; view.x1 = cx0 + S.w / s / 2; view.y0 = cy0 - S.h / s / 2; view.y1 = cy0 + S.h / s / 2;
    }
    function size() { S = W.fitCanvas(cv, 0.68, 210, 380); if (equal && !userMoved) fitEqual(); draw(); }
    function sx(x) { return (x - view.x0) / (view.x1 - view.x0) * S.w; }
    function sy(y) { return S.h - (y - view.y0) / (view.y1 - view.y0) * S.h; }
    function ix(px) { return view.x0 + px / S.w * (view.x1 - view.x0); }
    function dec(step) { return Math.max(0, Math.min(8, -Math.floor(Math.log10(step)) + (step < 1 ? 0 : 0))); }
    function draw() {
      raf = 0; if (!S) return;
      var ctx = S.ctx, w = S.w, h = S.h, acc = accent();
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#0b0806"; ctx.fillRect(0, 0, w, h);
      var stx = niceStep(view.x1 - view.x0, w / 70), sty = niceStep(view.y1 - view.y0, h / 55), i, v;
      ctx.font = "10px 'Space Mono',monospace"; ctx.lineWidth = 1;
      if (grid) {
        ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.beginPath();
        for (v = Math.ceil(view.x0 / stx) * stx; v <= view.x1; v += stx) { var X = Math.round(sx(v)) + .5; ctx.moveTo(X, 0); ctx.lineTo(X, h); }
        for (v = Math.ceil(view.y0 / sty) * sty; v <= view.y1; v += sty) { var Y = Math.round(sy(v)) + .5; ctx.moveTo(0, Y); ctx.lineTo(w, Y); }
        ctx.stroke();
      }
      var ax = clampN(sx(0), 0, w), ay = clampN(sy(0), 0, h);
      ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.beginPath(); ctx.moveTo(0, ay + .5); ctx.lineTo(w, ay + .5); ctx.moveTo(ax + .5, 0); ctx.lineTo(ax + .5, h); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      var dx = dec(stx), dy = dec(sty), ly = clampN(ay + 4, 2, h - 14);
      for (v = Math.ceil(view.x0 / stx) * stx; v <= view.x1; v += stx) { if (Math.abs(v) < stx * 1e-6) continue; ctx.fillText(String(parseFloat(v.toFixed(dx))).replace("-", "−"), clampN(sx(v), 12, w - 12), ly); }
      ctx.textAlign = ax > w - 40 ? "right" : "left"; ctx.textBaseline = "middle"; var lx = ax > w - 40 ? ax - 5 : ax + 5;
      for (v = Math.ceil(view.y0 / sty) * sty; v <= view.y1; v += sty) { if (Math.abs(v) < sty * 1e-6) continue; ctx.fillText(String(parseFloat(v.toFixed(dy))).replace("-", "−"), lx, clampN(sy(v), 8, h - 8)); }
      // shaded areas
      fills.forEach(function (f) {
        if (!f.c) return; ctx.beginPath(); var a = Math.max(f.a, view.x0), b = Math.min(f.b, view.x1); if (a >= b) return;
        ctx.moveTo(sx(a), sy(0));
        for (var k = 0; k <= 160; k++) { var xx = a + (b - a) * k / 160, yy = evalAt(f.c, xx); ctx.lineTo(sx(xx), sy(isFinite(yy) ? yy : 0)); }
        ctx.lineTo(sx(b), sy(0)); ctx.closePath(); ctx.fillStyle = hexA(f.c.color, .2); ctx.fill();
      });
      // curves
      ctx.lineWidth = 2.2; ctx.lineJoin = "round";
      curves.forEach(function (c) {
        ctx.strokeStyle = c.color; ctx.beginPath(); var pen = false, lastY = 0, N = Math.min(2400, Math.ceil(w / 1.2));
        for (i = 0; i <= N; i++) {
          var X, Y, val;
          if (c.kind === "fn") { var xx = view.x0 + (view.x1 - view.x0) * i / N; val = evalAt(c, xx); if (!isFinite(val) || Math.abs(val) > 1e9) { pen = false; continue; } X = sx(xx); Y = sy(val); }
          else { scope.t = c.t0 + (c.t1 - c.t0) * i / N; var vx = c.fx(scope), vy = c.fy(scope); if (!isFinite(vx) || !isFinite(vy)) { pen = false; continue; } X = sx(vx); Y = sy(vy); }
          if (pen && c.kind === "fn" && Math.abs(Y - lastY) > h * 2) pen = false; // asymptote (tan x, 1/x …)
          if (!pen) { ctx.moveTo(X, Y); pen = true; } else ctx.lineTo(X, Y);
          lastY = Y;
        }
        ctx.stroke();
      });
      // zeros / intersections
      marks.forEach(function (m) { var X = sx(m.x), Y = sy(m.y); if (X < 0 || X > w || Y < 0 || Y > h) return; ctx.beginPath(); ctx.arc(X, Y, 4.2, 0, 6.2832); if (m.hollow) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.6; ctx.stroke(); } else { ctx.fillStyle = m.c; ctx.fill(); ctx.strokeStyle = "#0b0806"; ctx.lineWidth = 1.4; ctx.stroke(); } });
      // points
      ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.font = "600 11px 'Space Mono',monospace";
      points.forEach(function (p) { var X = sx(p.x), Y = sy(p.y); ctx.beginPath(); ctx.arc(X, Y, 4.6, 0, 6.2832); ctx.fillStyle = acc; ctx.fill(); ctx.strokeStyle = "#0b0806"; ctx.lineWidth = 1.5; ctx.stroke(); var txt = (p.label ? p.label + " " : "") + "(" + W.fmt(p.x, 3) + ", " + W.fmt(p.y, 3) + ")", tw = ctx.measureText(txt).width; ctx.fillStyle = "#fff"; if (X + 8 + tw > w - 4) { ctx.textAlign = "right"; ctx.fillText(txt, X - 8, Y - 6); ctx.textAlign = "left"; } else ctx.fillText(txt, X + 7, Y - 6); });
      // trace
      if (traceX != null) {
        var TX = sx(traceX); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(TX + .5, 0); ctx.lineTo(TX + .5, h); ctx.stroke(); ctx.setLineDash([]);
        var rows = ["x = " + W.fmt(traceX, 5)];
        fnCurves.forEach(function (c) { var v2 = evalAt(c, traceX); if (isFinite(v2)) { ctx.beginPath(); ctx.arc(TX, sy(v2), 4.4, 0, 6.2832); ctx.fillStyle = c.color; ctx.fill(); ctx.strokeStyle = "#0b0806"; ctx.lineWidth = 1.4; ctx.stroke(); } rows.push(label(c.name) + " = " + (isFinite(v2) ? W.fmt(v2, 5) : "—")); });
        ctx.font = "11px 'Space Mono',monospace"; var bw = 0; rows.forEach(function (r) { bw = Math.max(bw, ctx.measureText(r).width); }); bw += 16;
        var bx = TX > w / 2 ? 8 : w - bw - 8; ctx.fillStyle = "rgba(14,10,6,.9)"; ctx.strokeStyle = "rgba(255,255,255,.18)"; roundRect(ctx, bx, 8, bw, rows.length * 16 + 10, 9); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.textBaseline = "top"; ctx.textAlign = "left"; rows.forEach(function (r, k) { ctx.fillStyle = k ? fnCurves[k - 1].color : "#fff"; ctx.fillText(r, bx + 8, 13 + k * 16); });
      }
    }
    function clampN(v, a, b) { return Math.min(b, Math.max(a, v)); }
    function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; }
    function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function redraw() { if (!raf) raf = requestAnimationFrame(draw); }

    // ---- interaction: drag = pan, pinch / wheel = zoom, tap = trace, double-tap = reset
    var ptrs = {}, moved = false, startPt = null, pinch = null, lastTap = 0;
    function count() { return Object.keys(ptrs).length; }
    function zoomAt(px, py, k) {
      var cx = ix(px), cyv = view.y0 + (S.h - py) / S.h * (view.y1 - view.y0);
      view.x0 = cx - (cx - view.x0) * k; view.x1 = cx + (view.x1 - cx) * k;
      if (!equal) { view.y0 = cyv - (cyv - view.y0) * k; view.y1 = cyv + (view.y1 - cyv) * k; }
      else { var ry = (view.x1 - view.x0) * S.h / S.w, cm = (view.y0 + view.y1) / 2; view.y0 = cm - ry / 2; view.y1 = cm + ry / 2; }
    }
    cv.addEventListener("pointerdown", function (e) {
      try { cv.setPointerCapture(e.pointerId); } catch (er) {}
      ptrs[e.pointerId] = { x: e.offsetX, y: e.offsetY }; moved = false; startPt = { x: e.offsetX, y: e.offsetY };
      if (count() === 2) { var k = Object.keys(ptrs), a = ptrs[k[0]], b = ptrs[k[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), v: { x0: view.x0, x1: view.x1, y0: view.y0, y1: view.y1 } }; moved = true; }
    });
    cv.addEventListener("pointermove", function (e) {
      var p = ptrs[e.pointerId]; if (!p) return;
      if (count() === 2 && pinch) {
        p.x = e.offsetX; p.y = e.offsetY; var k = Object.keys(ptrs), a = ptrs[k[0]], b = ptrs[k[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        view.x0 = pinch.v.x0; view.x1 = pinch.v.x1; view.y0 = pinch.v.y0; view.y1 = pinch.v.y1; zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.d / d); userMoved = true; redraw(); return;
      }
      var ddx = e.offsetX - p.x, ddy = e.offsetY - p.y;
      if (!moved && Math.hypot(e.offsetX - startPt.x, e.offsetY - startPt.y) < 6) return;
      moved = true; userMoved = true; p.x = e.offsetX; p.y = e.offsetY;
      var rx = view.x1 - view.x0, ry = view.y1 - view.y0;
      view.x0 -= ddx / S.w * rx; view.x1 -= ddx / S.w * rx; view.y0 += ddy / S.h * ry; view.y1 += ddy / S.h * ry; redraw();
    });
    function up(e) {
      var was = ptrs[e.pointerId]; delete ptrs[e.pointerId]; if (count() < 2) pinch = null;
      if (was && !moved && count() === 0 && e.type === "pointerup") {
        var now = Date.now();
        if (now - lastTap < 320) { view = { x0: base.x0, x1: base.x1, y0: base.y0, y1: base.y1 }; userMoved = false; if (equal) fitEqual(); traceX = null; lastTap = 0; }
        else { var x = ix(was.x); traceX = (traceX != null && Math.abs(sx(traceX) - was.x) < 8) ? null : x; lastTap = now; var hint = info.querySelector(".phr-hint"); if (hint) hint.style.display = "none"; }
        redraw();
      }
    }
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) { e.preventDefault(); var r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY > 0 ? 1.15 : 1 / 1.15); userMoved = true; redraw(); }, { passive: false });
    root.querySelector('[data-a="reset"]').addEventListener("click", function () { view = { x0: base.x0, x1: base.x1, y0: base.y0, y1: base.y1 }; userMoved = false; traceX = null; if (equal) fitEqual(); redraw(); });
    W.attachExpand(root, root.querySelector('[data-a="full"]'), size);
    W.observeResize(root, size);
    size();
  };

  // ================================================================ PHYSICS SIMULATIONS
  var TAU = Math.PI * 2, D2R = Math.PI / 180;
  function arrow(ctx, x1, y1, x2, y2, color, wd) {
    var dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy); if (L < 2) return;
    var ux = dx / L, uy = dy / L, hs = Math.min(9, L * 0.45);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = wd || 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - ux * hs * 0.6, y2 - uy * hs * 0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * hs - uy * hs * 0.5, y2 - uy * hs + ux * hs * 0.5); ctx.lineTo(x2 - ux * hs + uy * hs * 0.5, y2 - uy * hs - ux * hs * 0.5); ctx.closePath(); ctx.fill();
  }
  function series(ctx, x, y, w, h, hist, key, color, ymax, tspan, title) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = "rgba(255,255,255,.03)"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, h / 2 + .5); ctx.lineTo(w, h / 2 + .5); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.font = "10px 'Space Mono',monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(title, 6, 4);
    if (hist.length > 1) {
      var t1 = hist[hist.length - 1].t, t0 = t1 - tspan; ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.beginPath(); var first = true;
      for (var i = 0; i < hist.length; i++) { var p = hist[i]; if (p.t < t0) continue; var px = (p.t - t0) / tspan * w, py = h / 2 - p[key] / ymax * (h / 2 - 6); if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.restore();
  }

  var SIMS = {};

  // ---- projectile -------------------------------------------------
  SIMS.projectile = {
    title: { en: "Projectile motion", fa: "حرکت پرتابی" },
    params: [
      { k: "v0", al: ["v", "v0", "speed", "u"], label: "v₀", min: 0, max: 60, step: 0.5, def: 20, unit: " m/s" },
      { k: "angle", al: ["angle", "theta", "alpha", "deg"], label: "θ", min: 0, max: 90, step: 1, def: 45, unit: "°" },
      { k: "h0", al: ["h0", "h", "height", "y0"], label: "h₀", min: 0, max: 50, step: 0.5, def: 0, unit: " m" },
      { k: "g", al: ["g", "gravity"], label: "g", min: 1, max: 25, step: 0.01, def: 9.81, unit: " m/s²" }
    ],
    formula: "\\begin{aligned}R&=\\dfrac{v_0\\cos\\theta}{g}\\Big(v_0\\sin\\theta+\\sqrt{v_0^2\\sin^2\\theta+2gh_0}\\Big)\\\\ H&=h_0+\\dfrac{v_0^2\\sin^2\\theta}{2g}\\end{aligned}",
    reset: function (P, st) {
      var th = P.angle * D2R, vx = P.v0 * Math.cos(th), vy = P.v0 * Math.sin(th), g = P.g;
      st.vx = vx; st.vy0 = vy; st.T = (vy + Math.sqrt(vy * vy + 2 * g * P.h0)) / g; st.R = vx * st.T; st.H = P.h0 + vy * vy / (2 * g); st.tA = vy > 0 ? vy / g : 0; st.t = 0; st.trail = [];
      st.done = false;
    },
    step: function (dt, st, P) { if (st.done) return; st.t += dt; if (st.t >= st.T) { st.t = st.T; st.done = true; } },
    pos: function (st, P, t) { return { x: st.vx * t, y: P.h0 + st.vy0 * t - 0.5 * P.g * t * t }; },
    draw: function (ctx, w, h, st, P, acc) {
      var m = 34, X = Math.max(st.R, 1) * 1.06, Y = Math.max(st.H, P.h0, 1) * 1.18, sc = Math.min((w - m - 16) / X, (h - m - 16) / Y), ox = m, oy = h - 26;
      var sx = function (x) { return ox + x * sc; }, sy = function (y) { return oy - y * sc; };
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, oy + .5); ctx.lineTo(w, oy + .5); ctx.stroke();
      if (P.h0 > 0) { ctx.fillStyle = "rgba(255,255,255,.07)"; ctx.fillRect(0, sy(P.h0), ox, oy - sy(P.h0)); ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.strokeRect(0, sy(P.h0), ox, oy - sy(P.h0)); }
      ctx.setLineDash([5, 5]); ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 1.3; ctx.beginPath();
      for (var i = 0; i <= 80; i++) { var p = SIMS.projectile.pos(st, P, st.T * i / 80); if (i) ctx.lineTo(sx(p.x), sy(Math.max(0, p.y))); else ctx.moveTo(sx(p.x), sy(p.y)); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = acc; ctx.lineWidth = 2.4; ctx.beginPath();
      for (var j = 0; j <= 80; j++) { var tj = st.t * j / 80, q = SIMS.projectile.pos(st, P, tj); if (j) ctx.lineTo(sx(q.x), sy(Math.max(0, q.y))); else ctx.moveTo(sx(q.x), sy(q.y)); }
      ctx.stroke();
      ctx.font = "10px 'Space Mono',monospace"; ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.textAlign = "center";
      var apex = SIMS.projectile.pos(st, P, st.tA); if (st.H > P.h0 + 0.01) { ctx.beginPath(); ctx.arc(sx(apex.x), sy(apex.y), 3, 0, TAU); ctx.fill(); ctx.textBaseline = "bottom"; ctx.fillText("H = " + W.fmt(st.H, 3) + " m", sx(apex.x), sy(apex.y) - 6); }
      ctx.textBaseline = "top"; ctx.fillText("R = " + W.fmt(st.R, 3) + " m", sx(st.R), oy + 5);
      ctx.beginPath(); ctx.arc(sx(st.R), oy, 3, 0, TAU); ctx.fill();
      var c = SIMS.projectile.pos(st, P, st.t), vy = st.vy0 - P.g * st.t, cx = sx(c.x), cy = sy(Math.max(0, c.y));
      var va = 46 / Math.max(P.v0, 1); if (!st.done) { arrow(ctx, cx, cy, cx + st.vx * va, cy, "#5AC8FA", 2); arrow(ctx, cx, cy, cx, cy - vy * va, "#FF6B81", 2); }
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.fill(); ctx.strokeStyle = acc; ctx.lineWidth = 2.5; ctx.stroke();
    },
    reads: function (st, P) { var c = SIMS.projectile.pos(st, P, st.t), vy = st.vy0 - P.g * st.t; return [["time  t", W.fmt(st.t, 3) + " s"], ["x", W.fmt(c.x, 4) + " m"], ["height  y", W.fmt(Math.max(0, c.y), 4) + " m"], ["speed  v", W.fmt(Math.hypot(st.vx, vy), 4) + " m/s"], ["flight time  T", W.fmt(st.T, 4) + " s"], ["range  R", W.fmt(st.R, 4) + " m"], ["max height  H", W.fmt(st.H, 4) + " m"]]; }
  };

  // ---- pendulum ---------------------------------------------------
  SIMS.pendulum = {
    title: { en: "Simple pendulum", fa: "آونگ ساده" },
    params: [
      { k: "L", al: ["l", "length"], label: "L", min: 0.2, max: 5, step: 0.05, def: 1, unit: " m" },
      { k: "theta0", al: ["theta0", "theta", "angle", "amplitude"], label: "θ₀", min: 5, max: 170, step: 1, def: 30, unit: "°" },
      { k: "g", al: ["g", "gravity"], label: "g", min: 1, max: 25, step: 0.01, def: 9.81, unit: " m/s²" },
      { k: "damping", al: ["damping", "c", "b", "friction"], label: "damping", min: 0, max: 2, step: 0.01, def: 0, unit: "" }
    ],
    formula: "\\begin{aligned}\\ddot\\theta&=-\\dfrac{g}{L}\\sin\\theta-c\\,\\dot\\theta\\\\ T_0&=2\\pi\\sqrt{\\dfrac{L}{g}}\\quad(\\text{small }\\theta_0)\\end{aligned}",
    reset: function (P, st) { st.th = P.theta0 * D2R; st.w = 0; st.t = 0; st.hist = []; st.cross = []; st.E0 = P.g * P.L * (1 - Math.cos(st.th)) || 1e-9; st.acc = 0; },
    step: function (dt, st, P) {
      var g = P.g, L = P.L, c = P.damping, n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
      function acc(th, w) { return -(g / L) * Math.sin(th) - c * w; }
      for (var i = 0; i < n; i++) {
        var th = st.th, w = st.w, k1t = w, k1w = acc(th, w), k2t = w + h / 2 * k1w, k2w = acc(th + h / 2 * k1t, w + h / 2 * k1w), k3t = w + h / 2 * k2w, k3w = acc(th + h / 2 * k2t, w + h / 2 * k2w), k4t = w + h * k3w, k4w = acc(th + h * k3t, w + h * k3w);
        var nth = th + h / 6 * (k1t + 2 * k2t + 2 * k3t + k4t); st.w = w + h / 6 * (k1w + 2 * k2w + 2 * k3w + k4w);
        if (th < 0 && nth >= 0) { var f = -th / (nth - th); st.cross.push(st.t + h * f); if (st.cross.length > 4) st.cross.shift(); }
        st.th = nth; st.t += h;
      }
      st.acc += dt; if (st.acc > 1 / 60) { st.acc = 0; st.hist.push({ t: st.t, th: st.th }); if (st.hist.length > 700) st.hist.shift(); }
    },
    draw: function (ctx, w, h, st, P, acc) {
      var ph = h * 0.62, px = w / 2, py = 22, len = Math.max(36, ph * 0.86 * Math.sqrt(P.L / 5) + 24);
      len = Math.min(len, ph - 44);
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px - 26, py); ctx.lineTo(px + 26, py); ctx.stroke();
      ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + len + 14); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(212,162,76,.25)"; ctx.beginPath(); ctx.arc(px, py, len, Math.PI / 2 - P.theta0 * D2R, Math.PI / 2 + P.theta0 * D2R); ctx.stroke();
      var bx = px + len * Math.sin(st.th), by = py + len * Math.cos(st.th);
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = acc; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, 13, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, 3.5, 0, TAU); ctx.fill();
      series(ctx, 8, ph + 4, w - 16, h - ph - 12, st.hist, "th", acc, Math.max(0.3, P.theta0 * D2R), 8, "θ(t)");
    },
    reads: function (st, P) {
      var T0 = TAU * Math.sqrt(P.L / P.g), Tm = st.cross.length >= 2 ? st.cross[st.cross.length - 1] - st.cross[st.cross.length - 2] : null;
      var E = 0.5 * P.L * P.L * st.w * st.w + P.g * P.L * (1 - Math.cos(st.th));
      return [["T₀", W.fmt(T0, 4) + " s"], ["T measured", Tm ? W.fmt(Tm, 4) + " s" : "—"], ["θ", W.fmt(st.th / D2R, 4) + "°"], ["ω", W.fmt(st.w, 4) + " rad/s"], ["v", W.fmt(Math.abs(st.w) * P.L, 4) + " m/s"], ["Energy", Math.round(100 * E / st.E0) + " %"]];
    }
  };

  // ---- spring-mass ------------------------------------------------
  SIMS.spring = {
    title: { en: "Mass on a spring", fa: "جرم و فنر" },
    params: [
      { k: "m", al: ["m", "mass"], label: "m", min: 0.1, max: 10, step: 0.1, def: 1, unit: " kg" },
      { k: "k", al: ["k", "spring"], label: "k", min: 1, max: 200, step: 1, def: 20, unit: " N/m" },
      { k: "c", al: ["c", "damping", "b"], label: "damping c", min: 0, max: 10, step: 0.05, def: 0, unit: " N·s/m" },
      { k: "x0", al: ["x0", "amplitude", "a"], label: "x₀", min: 0.1, max: 2, step: 0.05, def: 1, unit: " m" }
    ],
    formula: "\\begin{aligned}m\\ddot x&=-kx-c\\dot x\\\\ \\omega_0&=\\sqrt{\\dfrac{k}{m}},\\ \\ T=2\\pi\\sqrt{\\dfrac{m}{k}}\\\\ \\zeta&=\\dfrac{c}{2\\sqrt{km}}\\end{aligned}",
    reset: function (P, st) { st.x = P.x0; st.v = 0; st.t = 0; st.hist = []; st.acc = 0; st.E0 = 0.5 * P.k * P.x0 * P.x0; },
    step: function (dt, st, P) {
      var n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
      function a(x, v) { return (-P.k * x - P.c * v) / P.m; }
      for (var i = 0; i < n; i++) {
        var x = st.x, v = st.v, k1x = v, k1v = a(x, v), k2x = v + h / 2 * k1v, k2v = a(x + h / 2 * k1x, v + h / 2 * k1v), k3x = v + h / 2 * k2v, k3v = a(x + h / 2 * k2x, v + h / 2 * k2v), k4x = v + h * k3v, k4v = a(x + h * k3x, v + h * k3v);
        st.x = x + h / 6 * (k1x + 2 * k2x + 2 * k3x + k4x); st.v = v + h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v); st.t += h;
      }
      st.acc += dt; if (st.acc > 1 / 60) { st.acc = 0; st.hist.push({ t: st.t, x: st.x }); if (st.hist.length > 700) st.hist.shift(); }
    },
    draw: function (ctx, w, h, st, P, acc) {
      var ph = h * 0.55, cy = ph / 2 + 4, wall = 14, span = (w - 60) / 2, scale = span / Math.max(P.x0, 0.5) * 0.9, eq = wall + (w - wall) * 0.5, mx = eq + st.x * scale * 0.55, bw = 34 + 6 * Math.sqrt(P.m);
      ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(0, cy - 34, wall, 68); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(wall, cy - 34); ctx.lineTo(wall, cy + 34); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(eq, cy - 44); ctx.lineTo(eq, cy + 44); ctx.stroke(); ctx.setLineDash([]);
      var x0 = wall, x1 = mx - bw / 2, turns = 11; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(x0, cy);
      var lead = Math.min(14, Math.max(4, (x1 - x0) * 0.12)); ctx.lineTo(x0 + lead, cy);
      for (var i = 0; i < turns * 2; i++) { var xx = x0 + lead + (x1 - x0 - 2 * lead) * (i + 0.5) / (turns * 2); ctx.lineTo(xx, cy + (i % 2 ? 15 : -15)); }
      ctx.lineTo(x1 - lead, cy); ctx.lineTo(x1, cy); ctx.stroke();
      ctx.fillStyle = acc; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(mx - bw / 2, cy - bw / 2, bw, bw); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#1a1005"; ctx.font = "600 11px 'Space Mono',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(W.fmt(P.m, 2) + " kg", mx, cy);
      series(ctx, 8, ph + 4, w - 16, h - ph - 12, st.hist, "x", acc, Math.max(0.3, P.x0), 8, "x(t)");
    },
    reads: function (st, P) {
      var w0 = Math.sqrt(P.k / P.m), z = P.c / (2 * Math.sqrt(P.k * P.m)), E = 0.5 * P.m * st.v * st.v + 0.5 * P.k * st.x * st.x;
      return [["ω₀", W.fmt(w0, 4) + " rad/s"], ["T", W.fmt(TAU / w0, 4) + " s"], ["f", W.fmt(w0 / TAU, 4) + " Hz"], ["ζ", W.fmt(z, 3)], ["regime", z === 0 ? "undamped" : z < 1 ? "underdamped" : z === 1 ? "critical" : "overdamped"], ["x", W.fmt(st.x, 4) + " m"], ["v", W.fmt(st.v, 4) + " m/s"], ["Energy", Math.round(100 * E / st.E0) + " %"]];
    }
  };

  // ---- waves ------------------------------------------------------
  SIMS.wave = {
    title: { en: "Waves & superposition", fa: "موج و برهم‌نهی" },
    params: [
      { k: "A1", al: ["a1", "a", "amplitude", "amplitude1"], label: "A₁", min: 0.1, max: 2, step: 0.05, def: 1, unit: " m" },
      { k: "lam1", al: ["lam1", "lambda1", "wavelength1", "wavelength", "lambda"], label: "λ₁", min: 0.5, max: 5, step: 0.05, def: 2, unit: " m" },
      { k: "f1", al: ["f1", "f", "frequency", "frequency1"], label: "f₁", min: 0.1, max: 3, step: 0.05, def: 1, unit: " Hz" },
      { k: "A2", al: ["a2", "amplitude2"], label: "A₂", min: 0, max: 2, step: 0.05, def: 0, unit: " m" },
      { k: "lam2", al: ["lam2", "lambda2", "wavelength2"], label: "λ₂", min: 0.5, max: 5, step: 0.05, def: 2, unit: " m" },
      { k: "f2", al: ["f2", "frequency2"], label: "f₂", min: 0.1, max: 3, step: 0.05, def: 1, unit: " Hz" }
    ],
    toggle: { k: "rev", label: "second" },
    formula: "\\begin{aligned}y(x,t)&=A\\sin(kx-\\omega t)\\\\ k&=\\dfrac{2\\pi}{\\lambda},\\ \\ \\omega=2\\pi f,\\ \\ v=\\lambda f\\end{aligned}",
    reset: function (P, st) { st.t = 0; },
    step: function (dt, st) { st.t += dt; },
    draw: function (ctx, w, h, st, P, acc) {
      var L = 10, mx = 10, mid = h / 2, amp = Math.max(0.5, P.A1 + P.A2) , sy = (h / 2 - 20) / amp, sx = (w - 2 * mx) / L, k1 = TAU / P.lam1, k2 = TAU / P.lam2, w1 = TAU * P.f1, w2 = TAU * P.f2;
      ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, mid + .5); ctx.lineTo(w, mid + .5); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.font = "10px 'Space Mono',monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (var m = 0; m <= L; m += 2) { ctx.fillText(m + " m", mx + m * sx, h - 14); }
      function line(fn, color, wd, alpha) { ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = wd; ctx.beginPath(); for (var i = 0; i <= 240; i++) { var x = L * i / 240, y = fn(x); if (i) ctx.lineTo(mx + x * sx, mid - y * sy); else ctx.moveTo(mx + x * sx, mid - y * sy); } ctx.stroke(); ctx.globalAlpha = 1; }
      var y1 = function (x) { return P.A1 * Math.sin(k1 * x - w1 * st.t); }, y2 = function (x) { return P.A2 * Math.sin(k2 * x + (P.rev ? 1 : -1) * w2 * st.t); };
      if (P.A2 > 0.001) { line(y1, acc, 1.4, .55); line(y2, "#5AC8FA", 1.4, .55); line(function (x) { return y1(x) + y2(x); }, "#fff", 2.6, 1); }
      else line(y1, "#fff", 2.6, 1);
    },
    reads: function (st, P) {
      var out = [["v = λf", W.fmt(P.lam1 * P.f1, 4) + " m/s"], ["k₁", W.fmt(TAU / P.lam1, 4) + " rad/m"], ["ω₁", W.fmt(TAU * P.f1, 4) + " rad/s"], ["T₁", W.fmt(1 / P.f1, 4) + " s"]];
      if (P.A2 > 0.001) { out.push(["A max", W.fmt(P.A1 + P.A2, 3) + " m"]); if (!P.rev && Math.abs(P.f1 - P.f2) > 1e-6) out.push(["beat f", W.fmt(Math.abs(P.f1 - P.f2), 3) + " Hz"]); if (P.rev && Math.abs(P.A1 - P.A2) < 0.01 && Math.abs(P.lam1 - P.lam2) < 0.01 && Math.abs(P.f1 - P.f2) < 0.01) out.push(["pattern", "standing wave"]); }
      return out;
    }
  };

  // ---- inclined plane ---------------------------------------------
  SIMS.incline = {
    title: { en: "Block on an incline", fa: "جسم روی سطح شیب‌دار" },
    params: [
      { k: "theta", al: ["theta", "angle", "alpha"], label: "θ", min: 0, max: 80, step: 1, def: 30, unit: "°" },
      { k: "mu", al: ["mu", "friction", "u"], label: "μ", min: 0, max: 1.2, step: 0.01, def: 0.3, unit: "" },
      { k: "m", al: ["m", "mass"], label: "m", min: 0.1, max: 20, step: 0.1, def: 2, unit: " kg" },
      { k: "g", al: ["g", "gravity"], label: "g", min: 1, max: 25, step: 0.01, def: 9.81, unit: " m/s²" },
      { k: "L", al: ["l", "length"], label: "L", min: 1, max: 10, step: 0.1, def: 4, unit: " m" }
    ],
    formula: "\\begin{aligned}N&=mg\\cos\\theta\\\\ a&=g(\\sin\\theta-\\mu\\cos\\theta)\\\\ \\tan\\theta_c&=\\mu\\end{aligned}",
    reset: function (P, st) {
      var th = P.theta * D2R; st.N = P.m * P.g * Math.cos(th); st.Fd = P.m * P.g * Math.sin(th); st.fmax = P.mu * st.N;
      st.slides = st.Fd > st.fmax + 1e-9; st.a = st.slides ? P.g * (Math.sin(th) - P.mu * Math.cos(th)) : 0; st.f = st.slides ? st.fmax : st.Fd; st.s = 0; st.t = 0; st.v = 0; st.done = false; st.wait = 0;
    },
    step: function (dt, st, P) {
      if (!st.slides) return;
      if (st.done) { st.wait += dt; if (st.wait > 1.2) { st.s = 0; st.t = 0; st.v = 0; st.done = false; st.wait = 0; } return; }
      st.t += dt; st.s = 0.5 * st.a * st.t * st.t; st.v = st.a * st.t; if (st.s >= P.L) { st.s = P.L; st.done = true; }
    },
    draw: function (ctx, w, h, st, P, acc) {
      var th = P.theta * D2R, m = 26, c = Math.cos(th), s = Math.sin(th), Lpx = Math.min((w - 2 * m) / Math.max(c, 0.15), (h - 2 * m) / Math.max(s, 0.15), 380);
      var Ax = m, Ay = h - m, Bx = m + Lpx * c, By = Ay, Cx = m, Cy = Ay - Lpx * s;
      ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(Ax, Ay); ctx.lineTo(Bx, By); ctx.lineTo(Cx, Cy); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(Bx, By, 34, Math.PI, Math.PI + th, false); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "11px 'Space Mono',monospace"; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText("θ = " + W.fmt(P.theta, 3) + "°", Bx - 42, By - 4);
      var sd = (st.s / P.L) * Lpx, bs = 26, px = Cx + (sd + bs / 2 + 4) * c, py = Cy + (sd + bs / 2 + 4) * s, nx = s, ny = -c, cxb = px + nx * (bs / 2), cyb = py + ny * (bs / 2);
      ctx.save(); ctx.translate(cxb, cyb); ctx.rotate(th); ctx.fillStyle = acc; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.fillRect(-bs / 2, -bs / 2, bs, bs); ctx.strokeRect(-bs / 2, -bs / 2, bs, bs); ctx.restore();
      var sc = 62 / Math.max(P.m * P.g, 1e-6);
      arrow(ctx, cxb, cyb, cxb, cyb + P.m * P.g * sc, "#FF6B81", 2.2);
      arrow(ctx, cxb, cyb, cxb + nx * st.N * sc, cyb + ny * st.N * sc, "#5AC8FA", 2.2);
      arrow(ctx, cxb, cyb, cxb - c * st.f * sc, cyb - s * st.f * sc, "#FF9F43", 2.2);
      ctx.font = "600 11px 'Space Mono',monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#FF6B81"; ctx.fillText("mg", cxb + 6, cyb + P.m * P.g * sc + 2);
      ctx.fillStyle = "#5AC8FA"; ctx.fillText("N", cxb + nx * st.N * sc + 6, cyb + ny * st.N * sc - 4);
      ctx.fillStyle = "#FF9F43"; ctx.fillText("f", cxb - c * st.f * sc - 14, cyb - s * st.f * sc - 6);
    },
    reads: function (st, P) {
      var th = P.theta * D2R, net = st.slides ? st.Fd - st.fmax : 0;
      return [["a", W.fmt(st.a, 4) + " m/s²"], ["N = mg cosθ", W.fmt(st.N, 4) + " N"], ["mg sinθ", W.fmt(st.Fd, 4) + " N"], [st.slides ? "f (kinetic)" : "f (static)", W.fmt(st.f, 4) + " N"], ["F net", W.fmt(net, 4) + " N"], ["θ critical", W.fmt(Math.atan(P.mu) / D2R, 3) + "°"], ["state", st.slides ? "slides" : "at rest"]];
    }
  };
  W.SIMS = SIMS;

  // ---- widget shell shared by all simulations -----------------------
  var ALIAS_SIM = { projectile: "projectile", projectilemotion: "projectile", trajectory: "projectile", pendulum: "pendulum", spring: "spring", massspring: "spring", springmass: "spring", oscillator: "spring", wave: "wave", waves: "wave", superposition: "wave", incline: "incline", inclinedplane: "incline", ramp: "incline", slope: "incline" };
  var active = [], tickerOn = false, lastNow = 0;
  function ticker(now) {
    var dt0 = Math.min(0.05, (now - lastNow) / 1000 || 0.016); lastNow = now;
    for (var i = active.length - 1; i >= 0; i--) {
      var s = active[i];
      if (!s.root.isConnected) { active.splice(i, 1); continue; }
      if (s.running && s.visible && !document.hidden) { s.def.step(dt0 * s.speed, s.st, s.P); s.draw(); }
    }
    if (active.length) requestAnimationFrame(ticker); else tickerOn = false;
  }
  function startTicker() { if (!tickerOn) { tickerOn = true; lastNow = performance.now(); requestAnimationFrame(ticker); } }

  W.builders.sim = function (root, lines, map) {
    var lang = root._lang, T = function (k) { return W.t(lang, k); };
    var key = String(map.type || map.sim || map.name || "projectile").toLowerCase().replace(/[^a-z]/g, ""), kind = ALIAS_SIM[key];
    var def = kind && SIMS[kind];
    if (!def) throw new Error("sim: unknown type '" + (map.type || key) + "' — use projectile, pendulum, spring, wave or incline");
    var P = {}, cfg = {};
    lines.forEach(function (l) { if (!(l.key in cfg)) cfg[l.key] = l.val; });
    def.params.forEach(function (p) {
      var v = p.def;
      for (var i = 0; i < p.al.length; i++) { if (cfg[p.al[i]] != null) { var raw = String(cfg[p.al[i]]), lead = /^\s*([+\-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?)/.exec(raw), n = lead ? parseFloat(lead[1]) : W.math.evaluate(raw); if (isFinite(n)) { v = n; break; } } }
      P[p.k] = v; p.lo = Math.min(p.min, v); p.hi = Math.max(p.max, v);
    });
    if (def.toggle) P.rev = /^(reverse|opposite|standing|true|yes|on|1)/i.test(String(cfg.second || cfg.direction || cfg.reverse || ""));
    var title = map.title || def.title[lang] || def.title.en, speed = 1;
    var html = '<div class="phr-w-head"><span class="phr-w-badge">' + esc(T("sim")) + '</span><span class="phr-w-title">' + esc(title) + '</span><button class="phr-w-btn" data-a="full">⤢</button></div><div class="phr-cvwrap"><canvas></canvas></div><div class="phr-bar"><button class="phr-w-btn gold" data-a="play">❚❚ ' + esc(T("pause")) + '</button><button class="phr-w-btn" data-a="reset">⟲ ' + esc(T("reset")) + '</button><button class="phr-w-btn" data-a="speed">1×</button>' + (def.toggle ? '<button class="phr-w-btn' + (P.rev ? " on" : "") + '" data-a="rev">' + esc(T("second")) + "</button>" : "") + '</div><div class="phr-controls">';
    def.params.forEach(function (p) {
      html += '<label class="phr-sl"><span class="phr-sl-l">' + esc(p.label) + '</span><input type="range" data-k="' + p.k + '" min="' + p.lo + '" max="' + p.hi + '" step="' + p.step + '" value="' + P[p.k] + '"><span class="phr-sl-v"></span></label>';
    });
    html += '</div><div class="phr-reads"></div><div class="phr-formula"></div>' + (map.note ? '<div class="phr-note">' + window.PHR_inline(map.note) + "</div>" : "");
    root.innerHTML = html;
    var cv = root.querySelector("canvas"), reads = root.querySelector(".phr-reads"), fbox = root.querySelector(".phr-formula");
    fbox.innerHTML = window.PHR_texHTML(def.formula, true);
    var st = {}, S = null, sim = { root: root, def: def, P: P, st: st, running: false, visible: true, speed: 1, draw: null };
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches, lastReads = 0;
    function updateSliders() {
      root.querySelectorAll(".phr-sl input").forEach(function (inp) {
        var p = def.params.filter(function (q) { return q.k === inp.getAttribute("data-k"); })[0], v = parseFloat(inp.value);
        inp.style.setProperty("--fill", ((v - p.lo) / (p.hi - p.lo) * 100) + "%");
        inp.parentElement.querySelector(".phr-sl-v").textContent = W.fmt(v, 4) + p.unit;
      });
    }
    function paintReads(force) {
      var now = performance.now(); if (!force && now - lastReads < 90) return; lastReads = now;
      var r = def.reads(st, P), html2 = ""; r.forEach(function (x) { html2 += '<div class="phr-read"><small>' + esc(x[0]) + "</small><span>" + esc(x[1]) + "</span></div>"; });
      if (reads._last !== html2) { reads.innerHTML = html2; reads._last = html2; }
    }
    function size() { S = W.fitCanvas(cv, 0.62, 200, 340); sim.draw(); }
    sim.draw = function () { if (!S) return; S.ctx.clearRect(0, 0, S.w, S.h); S.ctx.fillStyle = "#0b0806"; S.ctx.fillRect(0, 0, S.w, S.h); def.draw(S.ctx, S.w, S.h, st, P, accent()); paintReads(false); };
    function restart(play) { def.reset(P, st); sim.running = play; setPlay(); sim.draw(); paintReads(true); if (play) { active.indexOf(sim) < 0 && active.push(sim); startTicker(); } }
    function setPlay() { var b = root.querySelector('[data-a="play"]'); b.innerHTML = sim.running ? "❚❚ " + esc(T("pause")) : "▶ " + esc(T("play")); b.classList.toggle("gold", true); }
    root.querySelectorAll(".phr-sl input").forEach(function (inp) {
      inp.addEventListener("input", function () { P[inp.getAttribute("data-k")] = parseFloat(inp.value); updateSliders(); var was = sim.running; def.reset(P, st); sim.draw(); paintReads(true); if (!was) { sim.running = true; setPlay(); active.indexOf(sim) < 0 && active.push(sim); startTicker(); } });
    });
    root.querySelector('[data-a="play"]').addEventListener("click", function () { if (st.done) def.reset(P, st); sim.running = !sim.running; setPlay(); if (sim.running) { active.indexOf(sim) < 0 && active.push(sim); startTicker(); } });
    root.querySelector('[data-a="reset"]').addEventListener("click", function () { restart(true); });
    root.querySelector('[data-a="speed"]').addEventListener("click", function (e) { var order = [1, 0.5, 2, 0.25]; sim.speed = order[(order.indexOf(sim.speed) + 1) % order.length]; e.currentTarget.textContent = (sim.speed === 0.25 ? "¼" : sim.speed === 0.5 ? "½" : sim.speed) + "×"; });
    var rb = root.querySelector('[data-a="rev"]'); if (rb) rb.addEventListener("click", function () { P.rev = !P.rev; rb.classList.toggle("on", P.rev); sim.draw(); paintReads(true); });
    W.attachExpand(root, root.querySelector('[data-a="full"]'), size);
    W.observeResize(root, size);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { sim.visible = en[0].isIntersecting; if (sim.visible) sim.draw(); }, { threshold: 0.05 }).observe(root);
    updateSliders(); def.reset(P, st); size(); paintReads(true);
    active.push(sim); sim.running = !reduced; setPlay(); if (sim.running) startTicker();
  };

  // ================================================================ SOLUTION / QUIZ / FLASHCARDS
  function head(root, badge, title, extra) {
    return '<div class="phr-w-head"><span class="phr-w-badge">' + esc(badge) + '</span><span class="phr-w-title">' + esc(title || "") + "</span>" + (extra || "") + "</div>";
  }
  function mathish(txt) { return !/\$|\\\(|\\\[/.test(txt) ? true : false; } // no delimiters => the whole string is LaTeX

  // ---- worked solution -----------------------------------------------
  W.builders.solution = function (root, lines, map) {
    var lang = root._lang, T = function (k) { return W.t(lang, k); };
    var steps = [], tags = [], ans = null, check = null, note = null;
    lines.forEach(function (l) {
      var k = l.key, v = l.val;
      if (k === "title" || k === "lang") return;
      if (k === "given" || k === "known" || k === "data") tags.push(["given", v]);
      else if (k === "find" || k === "unknown" || k === "goal" || k === "ask") tags.push(["find", v]);
      else if (k === "answer" || k === "ans" || k === "result" || k === "final") ans = v;
      else if (k === "check" || k === "verify") check = v;
      else if (k === "note") note = v;
      else if (k === "step" || k === "s" || k === "-" || /^step\d*$/.test(k)) { var parts = v.split(/\s+\|\s+|\s*\|\s*(?=[\\$])/), p0 = parts.shift(); if (parts.length) steps.push({ l: p0, m: parts.join(" | ") }); else steps.push({ l: v, m: "" }); }
    });
    if (!steps.length && !ans) throw new Error("solution: add lines like  step: label | LaTeX");
    var html = head(root, T("solution"), map.title, '<button class="phr-w-btn" data-a="mode">' + esc(T("reveal")) + "</button>");
    if (tags.length) { html += '<div class="phr-sol-tags">'; tags.forEach(function (t) { html += '<div class="phr-sol-tag"><b class="k">' + esc(T(t[0])) + "</b>" + window.PHR_inline(t[1]) + "</div>"; }); html += "</div>"; }
    html += '<div class="phr-steps">';
    steps.forEach(function (s) {
      html += '<div class="phr-step"><div class="phr-step-l">' + window.PHR_inline(s.l) + "</div>" + (s.m ? '<div class="phr-step-m">' + (mathish(s.m) ? window.PHR_texHTML(s.m, true) : window.PHR_inline(s.m)) + "</div>" : "") + "</div>";
    });
    html += "</div>";
    if (ans) html += '<div class="phr-ans"><small>' + esc(T("answer")) + "</small>" + (mathish(ans) ? window.PHR_texHTML(ans, true) : window.PHR_inline(ans)) + "</div>";
    if (check) html += '<div class="phr-note"><b style="color:var(--p,#D4A24C)">' + esc(T("check")) + ":</b> " + window.PHR_inline(check) + "</div>";
    if (note) html += '<div class="phr-note">' + window.PHR_inline(note) + "</div>";
    html += '<div class="phr-bar phr-nextbar" style="display:none"><button class="phr-w-btn gold" data-a="next"></button><button class="phr-w-btn" data-a="all">' + esc(T("showAll")) + "</button></div>";
    root.innerHTML = html;
    var items = [].slice.call(root.querySelectorAll(".phr-step")), ansEl = root.querySelector(".phr-ans"), bar = root.querySelector(".phr-nextbar"), nb = root.querySelector('[data-a="next"]'), mode = root.querySelector('[data-a="mode"]'), shown = items.length, stepMode = false;
    function apply() {
      items.forEach(function (it, i) { it.style.display = i < shown ? "" : "none"; });
      if (ansEl) ansEl.style.display = shown >= items.length ? "" : "none";
      var last = shown >= items.length; bar.style.display = stepMode && !last ? "" : "none";
      nb.textContent = T("next") + " (" + Math.min(shown + 1, items.length) + " " + T("of") + " " + items.length + ")";
      mode.classList.toggle("on", stepMode);
    }
    mode.addEventListener("click", function () { stepMode = !stepMode; shown = stepMode ? 1 : items.length; apply(); });
    nb.addEventListener("click", function () { shown = Math.min(items.length, shown + 1); apply(); try { window.PHR_haptic && window.PHR_haptic("light"); } catch (e) {} });
    root.querySelector('[data-a="all"]').addEventListener("click", function () { stepMode = false; shown = items.length; apply(); });
  };

  // ---- quiz ------------------------------------------------------------
  W.builders.quiz = function (root, lines, map) {
    var lang = root._lang, T = function (k) { return W.t(lang, k); };
    var qs = [], cur = null;
    lines.forEach(function (l) {
      var k = l.key, v = l.val;
      if (k === "title" || k === "lang") return;
      if (k === "q" || k === "question" || /^q\d+$/.test(k)) { cur = { q: v, opts: [], exp: "" }; qs.push(cur); }
      else if (cur && /^(a|o|opt|option|choice)\d*\*?$/.test(k) || (cur && /^[a-e]\*?$/.test(k))) { var ok = /\*$/.test(k) || /^\s*\*\s/.test(v) || /\s\(correct\)\s*$/i.test(v) || /\s✓\s*$/.test(v); cur.opts.push({ t: v.replace(/^\s*\*\s/, "").replace(/\s*\(correct\)\s*$/i, "").replace(/\s*✓\s*$/, ""), ok: ok }); }
      else if (cur && (k === "explain" || k === "why" || k === "explanation" || k === "e")) cur.exp = v;
      else if (cur && (k === "answer" || k === "correct") && /^[A-Ea-e]$/.test(v.trim())) { var ix = v.trim().toUpperCase().charCodeAt(0) - 65; if (cur.opts[ix]) cur.opts[ix].ok = true; }
    });
    qs = qs.filter(function (q) { return q.opts.length >= 2; });
    if (!qs.length) throw new Error("quiz: add  q: …  then  a: …  and  a*: …  (the * marks the correct option)");
    qs.forEach(function (q) { if (!q.opts.some(function (o) { return o.ok; })) q.opts[0].ok = true; });
    var idx = 0, score = 0, letters = "ABCDE";
    root.innerHTML = head(root, T("quiz"), map.title, '<span class="phr-chip" data-r="count"></span>') + '<div class="phr-q-prog"><i></i></div><div class="phr-quiz-body"></div>';
    var body = root.querySelector(".phr-quiz-body"), bar = root.querySelector(".phr-q-prog i"), count = root.querySelector('[data-r="count"]');
    function show() {
      count.textContent = Math.min(idx + 1, qs.length) + " / " + qs.length; bar.style.width = (idx / qs.length * 100) + "%";
      if (idx >= qs.length) {
        var pct = Math.round(score / qs.length * 100);
        body.innerHTML = '<div class="phr-score"><big>' + score + " / " + qs.length + '</big><div style="color:rgba(255,255,255,.6);font-size:13px">' + esc(T("score")) + " · " + pct + '%</div></div><div class="phr-bar" style="justify-content:center"><button class="phr-w-btn gold" data-a="retry">' + esc(T("retry")) + "</button></div>";
        body.querySelector('[data-a="retry"]').addEventListener("click", function () { idx = 0; score = 0; show(); }); return;
      }
      var q = qs[idx], h = '<div class="phr-q"><div class="phr-q-t">' + window.PHR_inline(q.q) + "</div>";
      q.opts.forEach(function (o, i) { h += '<button class="phr-opt" data-i="' + i + '"><b>' + letters[i] + "</b><span>" + window.PHR_inline(o.t) + "</span></button>"; });
      body.innerHTML = h + '<div class="phr-fb"></div></div>';
      var done = false;
      body.querySelectorAll(".phr-opt").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (done) return; done = true; var i = +btn.getAttribute("data-i"), good = q.opts[i].ok; if (good) score++;
          body.querySelectorAll(".phr-opt").forEach(function (b, j) { b.disabled = true; if (q.opts[j].ok) b.classList.add("ok"); else if (j === i) b.classList.add("bad"); });
          var fb = body.querySelector(".phr-fb"), last = idx === qs.length - 1;
          fb.innerHTML = '<div class="phr-exp"><b style="color:' + (good ? "#3fd07a" : "#ff6b6b") + '">' + esc(good ? T("correct") : T("wrong")) + "</b>" + (q.exp ? "<br>" + window.PHR_inline(q.exp) : "") + '</div><div class="phr-bar" style="padding:0 0 10px"><button class="phr-w-btn gold" data-a="n">' + esc(last ? T("finish") : T("nextQ")) + " →</button></div>";
          fb.querySelector('[data-a="n"]').addEventListener("click", function () { idx++; show(); });
          try { window.PHR_haptic && window.PHR_haptic(good ? "success" : "light"); } catch (e) {}
        });
      });
    }
    show();
  };

  // ---- flashcards ----------------------------------------------------------
  W.builders.flash = function (root, lines, map) {
    var lang = root._lang, T = function (k) { return W.t(lang, k); }, cards = [];
    lines.forEach(function (l) {
      if (l.key === "title" || l.key === "lang") return;
      if (l.key === "card" || l.key === "c" || l.key === "-" || /^card\d+$/.test(l.key)) { var p = l.val.split(/\s+\|\s+|\s*\|\s*/); if (p.length >= 2) cards.push([p[0], p.slice(1).join(" | ")]); }
    });
    if (!cards.length) throw new Error("flashcards: add lines like  card: term | definition");
    var i = 0;
    root.innerHTML = head(root, T("flash"), map.title, '<span class="phr-chip" data-r="count"></span>') + '<div class="phr-card"><div class="phr-card-in"><div class="phr-face front"></div><div class="phr-face back"></div></div></div><div class="phr-bar" style="justify-content:center"><button class="phr-w-btn" data-a="p">← ' + esc(T("prev")) + '</button><button class="phr-w-btn gold" data-a="n">' + esc(T("nextQ")) + ' →</button></div><div class="phr-note" style="text-align:center">' + esc(T("flip")) + "</div>";
    var card = root.querySelector(".phr-card"), fr = root.querySelector(".front"), bk = root.querySelector(".back"), count = root.querySelector('[data-r="count"]');
    function show() { card.classList.remove("flip"); fr.innerHTML = window.PHR_inline(cards[i][0]); bk.innerHTML = window.PHR_inline(cards[i][1]); count.textContent = (i + 1) + " / " + cards.length; }
    card.addEventListener("click", function () { card.classList.toggle("flip"); });
    root.querySelector('[data-a="n"]').addEventListener("click", function () { i = (i + 1) % cards.length; show(); });
    root.querySelector('[data-a="p"]').addEventListener("click", function () { i = (i - 1 + cards.length) % cards.length; show(); });
    show();
  };
})();
