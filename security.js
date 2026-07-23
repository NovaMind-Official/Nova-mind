/**
 * ============================================================
 * PHRAORTES SECURITY LAYER — security.js
 * ============================================================
 * Covers two things:
 *   1. XSS sanitization of AI-generated text (the serious one)
 *   2. Content-Security-Policy hardening (defense in depth)
 *
 * WHY THIS IS A SEPARATE FILE
 * ----------------------------
 * index.html stays readable, and this file can be reasoned
 * about (and audited) on its own without hunting through 6000+
 * lines of UI code.
 *
 * WHY WE DON'T HAND-ROLL A SANITIZER
 * -----------------------------------
 * Regex-based HTML sanitizers are notoriously easy to bypass
 * (nested tags, encoding tricks, mutation XSS, etc.). We use
 * DOMPurify — a small, widely audited, battle-tested library
 * used by Google, Microsoft, and thousands of production apps.
 * Writing your own here would be a false sense of security.
 *
 * THE KEY DESIGN DECISION
 * -------------------------
 * We sanitize the RAW text that comes back from the AI model,
 * BEFORE it's ever run through marked.parse(). We do NOT
 * sanitize the final rendered HTML.
 *
 * Why: Phraortes' own code renderer injects trusted UI markup
 * (the Run / Copy / Full buttons on code blocks, etc.) that
 * uses onclick attributes. If we sanitized the *final* HTML,
 * a sanitizer would strip those onclick attributes too — since
 * it can't tell "safe button Phraortes built" from "malicious
 * onclick a hacker tricked the model into writing." Sanitizing
 * the model's raw text FIRST means the model can never inject
 * a raw <script>, <img onerror=...>, or any other HTML tag in
 * the first place — markdown doesn't need raw HTML tags for
 * normal formatting (bold, links, lists, code blocks all use
 * plain markdown syntax) — so nothing legitimate is lost.
 * ============================================================
 *
 * INTEGRATION — do this in index.html:
 *
 * STEP 1 — In <head>, BEFORE marked.min.js, add:
 *
 *   <script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js"></script>
 *   <script src="security.js"></script>
 *
 * STEP 2 — In <head>, as the very first thing after
 * <meta charset="UTF-8">, add this Content-Security-Policy tag.
 * It restricts the page to only load scripts/styles/fonts from
 * the specific CDNs Phraortes actually uses, and blocks
 * everything else by default:
 *
 *   <meta http-equiv="Content-Security-Policy" content="
 *     default-src 'self';
 *     script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'unsafe-inline';
 *     style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com 'unsafe-inline';
 *     font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com;
 *     img-src * data: blob:;
 *     media-src *;
 *     connect-src *;
 *     frame-src 'self' blob:;
 *     object-src 'none';
 *     base-uri 'self';
 *   ">
 *
 *   Note: 'unsafe-inline' is needed for script-src/style-src because
 *   Phraortes uses inline onclick handlers and inline <style> blocks
 *   throughout. This is a real tradeoff — a stricter CSP would require
 *   refactoring every onclick="..." into addEventListener() calls
 *   instead. That's a bigger, separate project; this CSP still blocks
 *   the most common attack vector (loading a malicious external script
 *   from a random domain), which is the main thing CSP is protecting
 *   against here.
 *
 * STEP 3 — In the <script> section of index.html, find this line
 * inside send():
 *
 *   let full = await fetchAI(apiMsgs, useVision, isCodeQuery);
 *
 * and change it to:
 *
 *   let full = await fetchAI(apiMsgs, useVision, isCodeQuery);
 *   full = sanitizeAIText(full);
 *
 * That's the ONLY functional change needed in index.html. Since
 * `full` is what gets stored in chat.msgs[].aRaw AND passed to
 * marked.parse() everywhere (streamMarkdown, finishTurn, reloads),
 * sanitizing it once at the source protects every render path.
 *
 * STEP 4 (recommended) — do the same for the auto-correction
 * loop's `fixed` value, and for any text pulled from uploaded
 * PDF/DOCX files (extractPdfText / extractDocxText results),
 * since those are also untrusted text that ends up on the page:
 *
 *   const fixed = await fetchAI(fixMsgs, false, true);
 *   if (fixed) { full = sanitizeAIText(fixed); corrected = true; }
 * ============================================================
 */

(function () {
  if (typeof DOMPurify === "undefined") {
    console.error(
      "[Phraortes Security] DOMPurify not loaded. Add the DOMPurify <script> tag " +
      "BEFORE this file in index.html. Until then, AI text is NOT sanitized — " +
      "do not ship to production like this."
    );
    // Fail LOUD, not silently. We still return the text so the app doesn't
    // crash while you're setting this up, but the console error above should
    // not be ignored.
    window.sanitizeAIText = function (text) { return text; };
    window.sanitizeHTML = function (html) { return html; };
    return;
  }

  /**
   * Sanitizes RAW TEXT from the AI model before it is fed into
   * marked.parse(). Strips every HTML tag entirely (markdown does
   * not need raw HTML), while keeping the text content intact so
   * normal markdown formatting still works.
   */
  window.sanitizeAIText = function (rawText) {
    if (!rawText) return rawText;
    try {
      return DOMPurify.sanitize(rawText, {
        ALLOWED_TAGS: [],      // strip every HTML tag
        ALLOWED_ATTR: [],      // strip every attribute
        KEEP_CONTENT: true,    // keep the text inside stripped tags
      });
    } catch (e) {
      console.error("[Phraortes Security] sanitizeAIText failed:", e);
      return "";
    }
  };

  /**
   * Optional second layer: sanitizes a fully-rendered HTML string
   * (e.g. if you ever render untrusted HTML directly, not via
   * marked.parse). NOT used on Phraortes' own code-block buttons —
   * only call this on content you know is fully untrusted, since it
   * strips onclick/script/etc. and would break the app's own
   * trusted UI markup if applied to it.
   */
  window.sanitizeHTML = function (dirtyHTML) {
    if (!dirtyHTML) return dirtyHTML;
    try {
      return DOMPurify.sanitize(dirtyHTML, {
        FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "link", "meta", "base"],
        FORBID_ATTR: [
          "onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur",
          "onchange", "onsubmit", "onkeydown", "onkeyup", "onkeypress", "formaction",
        ],
        ALLOW_DATA_ATTR: false,
      });
    } catch (e) {
      console.error("[Phraortes Security] sanitizeHTML failed:", e);
      return "<div style='color:#ff453a;font-size:13px'>⚠ Content blocked by security filter.</div>";
    }
  };

  console.log("[Phraortes Security] Active — sanitizeAIText() and sanitizeHTML() are ready.");
})();
