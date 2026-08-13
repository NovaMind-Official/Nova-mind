/**
 * ============================================================
 * PHRAORTES IMAGE ENGINE — image-gen.js
 * ============================================================
 * Replaces the hardcoded Pollinations call inside animImgLoader()
 * with a small provider-agnostic engine. You already have a real,
 * working free path (Pollinations/Flux) — this file does NOT
 * remove that. It adds a PAID provider slot on top, and falls
 * back to Pollinations automatically if no key is set yet, or if
 * the paid call fails. So the app keeps working today, and the
 * moment you paste a key in below, quality goes up with zero
 * other changes needed.
 *
 * WHY A SEPARATE FILE
 * ----------------------------
 * Same reasoning as security.js / payment-verify.js: keeps
 * index.html from growing, and lets this be audited/swapped on
 * its own.
 *
 * IMPORTANT SECURITY NOTE (read before shipping)
 * -------------------------------------------------
 * This is a static site with no backend (same situation you
 * already flagged in payment-verify.js). That means any API key
 * placed in IMAGE_PROVIDERS[...].apiKey below is visible to
 * anyone who opens devtools — same tradeoff as the Groq key
 * already living in your bundle today. It's fine for getting
 * started, but for a paid provider with a real budget attached,
 * the safer long-term move is a tiny backend/serverless proxy
 * that holds the key and forwards the request — happy to build
 * that with you next if/when you want it. Until then, set a
 * reasonable request-per-day cap in your provider's dashboard so
 * a leaked key can't run up a large bill.
 *
 * ============================================================
 * INTEGRATION — do this in index.html
 * ============================================================
 *
 * STEP 1 — In <head>, right after payment-verify.js, add:
 *
 *   <script src="image-gen.js"></script>
 *
 * STEP 2 — Inside animImgLoader() in the main <script> block,
 * find this line (around the "Use pollinations" comment):
 *
 *   const imgUrl=`https://image.pollinations.ai/prompt/${safeEnc(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;
 *
 * and replace the whole block from that line down through the
 * `tryLoad` function definition (but keep the `placeholder` /
 * `finishTurn` lines above it untouched) with:
 *
 *   const cid="imgc-"+Date.now();
 *   ... (placeholder + finishTurn stay exactly as they are) ...
 *   window.generateImageAI(prompt, { size: "1024x1024" }).then(result => {
 *     const cont=document.getElementById(cid);if(!cont)return;
 *     const img=new Image();img.crossOrigin="anonymous";
 *     img.onload=()=>{img.style.cssText="width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.6s ease";cont.innerHTML="";cont.appendChild(img);cont.style.cursor="pointer";cont.onclick=()=>openLightbox(result.url);setTimeout(()=>{img.style.opacity="1"},50);haptic("success");trackFile("image",prompt.substring(0,30)+".png","",result.url)};
 *     img.onerror=()=>{cont.innerHTML=`<div style="color:#ff453a;font-size:11px;padding:20px;text-align:center">Render failed. Try again.</div>`};
 *     img.src=result.url+(result.url.includes("?")?"&":"?")+"t="+Date.now();
 *   }).catch(()=>{
 *     const cont=document.getElementById(cid);
 *     if(cont)cont.innerHTML=`<div style="color:#ff453a;font-size:11px;padding:20px;text-align:center">Render failed. Try: /imagine [your prompt]</div>`;
 *   });
 *
 * That's it — generateImageAI() internally tries your paid
 * provider first (if configured) and falls back to Pollinations
 * automatically, so nothing else in index.html needs to change.
 *
 * STEP 3 — When you get your key, paste it into IMAGE_PROVIDERS
 * below and set ACTIVE_PROVIDER to that provider's name. Leave
 * ACTIVE_PROVIDER as "pollinations" until then.
 * ============================================================
 */

(function () {
  // ── SET THIS once you have a paid key ──────────────────────
  // Options: "pollinations" (free, default, no key needed),
  // "stability", "together", "fireworks", "openai"
  const ACTIVE_PROVIDER = "pollinations";

  // ── Provider registry ───────────────────────────────────────
  // Each provider exposes build(prompt, opts) -> { url, method,
  // headers, body } describing the HTTP request, and
  // parse(responseJson) -> imageUrlString (or data URL) for
  // providers that return JSON/base64 instead of a direct image
  // URL. Add new providers here without touching call sites.
  const IMAGE_PROVIDERS = {
    pollinations: {
      apiKey: null, // no key required
      directUrl: true, // returns an <img>-loadable URL directly, no fetch needed
      build(prompt, opts) {
        const seed = Math.floor(Math.random() * 99999);
        const size = (opts.size || "1024x1024").split("x");
        return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${size[0]}&height=${size[1]}&nologo=true&seed=${seed}&model=flux`;
      },
    },

    stability: {
      apiKey: "YOUR_STABILITY_API_KEY_HERE",
      directUrl: false,
      async run(prompt, opts, apiKey) {
        const size = (opts.size || "1024x1024").split("x");
        const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          body: (() => {
            const fd = new FormData();
            fd.append("prompt", prompt);
            fd.append("output_format", "png");
            fd.append("aspect_ratio", aspectFromSize(size));
            return fd;
          })(),
        });
        const data = await res.json();
        if (!data.image) throw new Error(data.errors?.[0] || "Stability API error");
        return `data:image/png;base64,${data.image}`;
      },
    },

    together: {
      apiKey: "YOUR_TOGETHER_API_KEY_HERE",
      directUrl: false,
      async run(prompt, opts, apiKey) {
        const size = (opts.size || "1024x1024").split("x");
        const res = await fetch("https://api.together.xyz/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "black-forest-labs/FLUX.1-schnell",
            prompt,
            width: parseInt(size[0], 10),
            height: parseInt(size[1], 10),
            steps: 4,
          }),
        });
        const data = await res.json();
        const url = data.data?.[0]?.url;
        if (!url) throw new Error(data.error?.message || "Together API error");
        return url;
      },
    },

    fireworks: {
      apiKey: "YOUR_FIREWORKS_API_KEY_HERE",
      directUrl: false,
      async run(prompt, opts, apiKey) {
        const res = await fetch(
          "https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models/flux-1-schnell-fp8/text_to_image",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "image/jpeg" },
            body: JSON.stringify({ prompt, aspect_ratio: aspectFromSize((opts.size || "1024x1024").split("x")) }),
          }
        );
        if (!res.ok) throw new Error("Fireworks API error " + res.status);
        const blob = await res.blob();
        return await blobToDataUrl(blob);
      },
    },

    openai: {
      apiKey: "YOUR_OPENAI_API_KEY_HERE",
      directUrl: false,
      async run(prompt, opts, apiKey) {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-image-1", prompt, size: opts.size || "1024x1024", n: 1 }),
        });
        const data = await res.json();
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) throw new Error(data.error?.message || "OpenAI Images API error");
        return `data:image/png;base64,${b64}`;
      },
    },
  };

  function aspectFromSize([w, h]) {
    const r = (parseInt(w, 10) / parseInt(h, 10)).toFixed(2);
    if (r === "1.00") return "1:1";
    if (r === "1.78") return "16:9";
    if (r === "0.56") return "9:16";
    return "1:1";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Public entry point. Tries ACTIVE_PROVIDER first (if it has a
   * real key set); falls back to Pollinations automatically on
   * any failure or missing key, so the app never breaks even
   * before you've configured a paid provider.
   *
   * opts: { size: "1024x1024" | "1792x1024" | "1024x1792" }
   * Returns: Promise<{ url: string, provider: string }>
   */
  window.generateImageAI = async function (prompt, opts = {}) {
    const primary = IMAGE_PROVIDERS[ACTIVE_PROVIDER];
    const hasRealKey = primary && (primary.directUrl || (primary.apiKey && !primary.apiKey.startsWith("YOUR_")));

    if (hasRealKey && ACTIVE_PROVIDER !== "pollinations") {
      try {
        const url = await primary.run(prompt, opts, primary.apiKey);
        return { url, provider: ACTIVE_PROVIDER };
      } catch (e) {
        console.error(`[Phraortes Image Engine] ${ACTIVE_PROVIDER} failed, falling back to Pollinations:`, e.message);
      }
    }

    // Fallback / default: Pollinations, always available, no key needed
    const url = IMAGE_PROVIDERS.pollinations.build(prompt, opts);
    return { url, provider: "pollinations" };
  };

  console.log(`[Phraortes Image Engine] Ready — active provider: ${ACTIVE_PROVIDER}`);
})();
