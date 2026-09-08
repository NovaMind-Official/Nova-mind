const ALLOWED_ORIGIN = "https://novamind-official.github.io";

// Real BEP20 USDT contract address on BNB Smart Chain (public, not a secret).
const USDT_BEP20_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";

// Your receiving wallet — copied from WALLETS.bep20 in phraortes.html so both stay in sync.
const RECEIVER_ADDRESS = "0xdd96c438bdf70ec037b6a51a34348eb85051a6eb";

// USDT amounts that unlock each plan — monthly price AND annual lump-sum price, both accepted
// (mirrors the data-monthly / price-annual figures in phraortes.html's pricing UI).
// TODO: keep this in sync any time you change prices in the frontend.
const PLAN_PRICES = {
  starter:  [{ amount: 14.99,  days: 31 },  { amount: 125.88, days: 366 }],
  pro:      [{ amount: 49.99,  days: 31 },  { amount: 419.88, days: 366 }],
  ultimate: [{ amount: 119.99, days: 31 },  { amount: 1007.88, days: 366 }],
};

const FREE_MSG_LIMIT = 5;            // matches PLAN_CFG.free.msgLimit in phraortes.html
const FREE_RESET_SECONDS = 5 * 3600; // matches the 5-hour reset countdown in the frontend
const SEARCH_CACHE_TTL = 300;        // 5 min — repeat searches for the same query hit KV, not DuckDuckGo again

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders(origin) });
    }
    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403, headers: corsHeaders(origin) });
    }

    // ── Rate limiting: one shared ceiling across every route, before anything else runs.
    // Requires a Rate Limiting binding named RATE_LIMITER (Workers & Pages → your worker →
    // Settings → Bindings → Add → Rate Limiting — no wrangler/CLI needed, it's in the dashboard).
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return jsonResponse({ error: "Too many requests — please slow down." }, 429, origin);
      }
    }

    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChat(request, env, origin);
    if (url.pathname === "/api/search") return handleSearch(request, env, origin);
    if (url.pathname === "/api/fetch-url") return handleFetchUrl(request, env, origin);
    if (url.pathname === "/api/weather") return handleWeather(request, env, origin);
    if (url.pathname === "/api/crypto-price") return handleCryptoPrice(request, env, origin);
    if (url.pathname === "/api/verify-payment") return handleVerifyPayment(request, env, origin);

    return new Response("Not Found", { status: 404, headers: corsHeaders(origin) });
  },
};

// ═══ Shared fetch helpers: every outbound call gets a hard timeout (nothing should ever hang
// the whole request forever) and network-flake calls get one automatic retry. ═══
async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function fetchWithRetry(url, options = {}, ms = 8000, retries = 1) {
  try {
    return await fetchWithTimeout(url, options, ms);
  } catch (err) {
    if (retries <= 0) throw err;
    return fetchWithRetry(url, options, ms, retries - 1);
  }
}

// ═══ /api/chat ═══
async function handleChat(request, env, origin) {
  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.messages)) {
      return jsonResponse({ error: "Invalid request body" }, 400, origin);
    }

    // Who is this? A valid signed license → their paid plan. No token, or an invalid/expired
    // one → "free", no matter what the client-side UI claims (that UI state is not trusted here).
    const token = bearerToken(request);
    const license = await verifyLicenseToken(token, env);
    const plan = license ? license.plan : "free";

    if (plan === "free") {
      const quota = await checkAndConsumeFreeQuota(request, env);
      if (!quota.ok) {
        return jsonResponse({ error: `Free plan limit reached (${FREE_MSG_LIMIT} messages). Upgrade for unlimited access.` }, 429, origin);
      }
      // Tool calling (web search, code execution) roughly doubles the round-trip cost per
      // message — reserve it for paying plans regardless of what the client requested.
      delete body.tools;
      delete body.tool_choice;
    }

    let response;
    try {
      // 55s: generous for a long reasoning response, but never infinite.
      response = await fetchWithTimeout("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.AI_API_KEY}`,
          "Content-Type": "application/json",
        },
        // NovaMind's frontend sends OpenRouter-style model IDs (e.g. "openai/gpt-oss-120b:free"),
        // which are not valid xAI model names. Normalize to a real Grok model here so the
        // frontend's existing model-selection logic keeps working without changes.
        // NOTE: `...body` also forwards `tools` / `tool_choice` straight through untouched —
        // that's what lets the frontend's tool-calling loop work with zero changes here.
        body: JSON.stringify({ ...body, model: "grok-4.6" }),
      }, 55000);
    } catch (err) {
      return jsonResponse({ error: "Phraortes is taking too long to respond — please try again." }, 504, origin);
    }

    const headers = new Headers(response.headers);
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    return jsonResponse({ error: "Worker request failed" }, 500, origin);
  }
}

// ═══ /api/search — real live web search, executed server-side (browsers can't CORS-fetch
// search engines, and this keeps any future paid search API key off the client).
// Cached in KV for SEARCH_CACHE_TTL so a repeated query in the same conversation is instant
// instead of re-scraping DuckDuckGo every time. ═══
async function handleSearch(request, env, origin) {
  try {
    const body = await request.json();
    const query = (body?.query || "").toString().trim().slice(0, 300);
    if (!query) return jsonResponse({ error: "Missing query" }, 400, origin);

    const cacheKey = "search:" + query.toLowerCase();
    if (env.PHRAORTES_KV) {
      const cached = await env.PHRAORTES_KV.get(cacheKey, "json");
      if (cached) return jsonResponse({ query, results: cached, cached: true }, 200, origin);
    }

    const results = await fetchSearchResults(query);
    if (env.PHRAORTES_KV && results.length) {
      await env.PHRAORTES_KV.put(cacheKey, JSON.stringify(results), { expirationTtl: SEARCH_CACHE_TTL });
    }
    return jsonResponse({ query, results }, 200, origin);
  } catch (error) {
    return jsonResponse({ error: "Search request failed" }, 500, origin);
  }
}

async function fetchSearchResults(query) {
  // Free, no-key DuckDuckGo Lite scrape — fine for now, swap for a real search API
  // (Brave Search / Tavily / SerpAPI) before relying on this for paying customers.
  const resp = await fetchWithRetry("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query), {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  }, 7000, 1);
  const html = await resp.text();
  const results = [];
  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<td class="result-snippet">([\s\S]*?)<\/td>/g;
  const snippets = [];
  let sMatch;
  while ((sMatch = snippetRe.exec(html)) && snippets.length < 8) snippets.push(stripTags(sMatch[1]));
  let lMatch, i = 0;
  while ((lMatch = linkRe.exec(html)) && results.length < 5) {
    const title = stripTags(lMatch[2]);
    if (!title) continue;
    results.push({ title, url: decodeDuckDuckGoUrl(lMatch[1]), snippet: snippets[i] || "" });
    i++;
  }
  return results;
}
function decodeDuckDuckGoUrl(href) {
  try {
    if (href.startsWith("/l/") || href.includes("uddg=")) {
      const u = new URL(href, "https://lite.duckduckgo.com");
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
  } catch (e) {}
  return href;
}
function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
}

// ═══ /api/fetch-url — reads a specific page's full text server-side, for the read_url tool. ═══
async function handleFetchUrl(request, env, origin) {
  try {
    const { url } = await request.json();
    if (!url || !/^https?:\/\//i.test(url)) {
      return jsonResponse({ error: "Invalid URL" }, 400, origin);
    }
    let resp;
    try {
      resp = await fetchWithRetry(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      }, 8000, 1);
    } catch (err) {
      return jsonResponse({ error: "That page took too long to respond" }, 504, origin);
    }
    const html = await resp.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]).trim() : url;
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 9000);
    return jsonResponse({ url, title, text }, 200, origin);
  } catch (error) {
    return jsonResponse({ error: "Could not fetch that page" }, 500, origin);
  }
}

// ═══ /api/weather — free, no API key (Open-Meteo). Geocodes a place name, then gets current
// conditions. Used by the get_weather tool. ═══
async function handleWeather(request, env, origin) {
  try {
    const { city } = await request.json();
    const place = (city || "").toString().trim().slice(0, 100);
    if (!place) return jsonResponse({ error: "Missing city" }, 400, origin);

    const geoRes = await fetchWithRetry(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en`,
      {}, 6000, 1
    );
    const geo = await geoRes.json();
    const loc = geo?.results?.[0];
    if (!loc) return jsonResponse({ error: `Could not find a place called "${place}"` }, 404, origin);

    const wRes = await fetchWithRetry(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`,
      {}, 6000, 1
    );
    const w = await wRes.json();
    if (!w?.current) return jsonResponse({ error: "Weather data unavailable" }, 502, origin);

    return jsonResponse({
      place: [loc.name, loc.admin1, loc.country].filter(Boolean).join(", "),
      temperatureC: w.current.temperature_2m,
      humidityPct: w.current.relative_humidity_2m,
      windKmh: w.current.wind_speed_10m,
      weatherCode: w.current.weather_code,
      condition: describeWeatherCode(w.current.weather_code),
    }, 200, origin);
  } catch (error) {
    return jsonResponse({ error: "Weather lookup failed" }, 500, origin);
  }
}
function describeWeatherCode(code) {
  const map = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm with hail",
  };
  return map[code] || "Unknown";
}

// ═══ /api/crypto-price — free, no API key (CoinGecko public endpoint). Used by the
// get_crypto_price tool — genuinely useful given the product's own USDT/BEP20 payment flow. ═══
const COIN_ID_MAP = {
  btc: "bitcoin", bitcoin: "bitcoin",
  eth: "ethereum", ethereum: "ethereum",
  usdt: "tether", tether: "tether",
  bnb: "binancecoin", binance: "binancecoin",
  sol: "solana", solana: "solana",
  doge: "dogecoin", dogecoin: "dogecoin",
  ton: "the-open-network", xrp: "ripple", ripple: "ripple",
  usdc: "usd-coin",
};
async function handleCryptoPrice(request, env, origin) {
  try {
    const { coin } = await request.json();
    const key = (coin || "").toString().trim().toLowerCase();
    const coinId = COIN_ID_MAP[key] || key;
    if (!coinId) return jsonResponse({ error: "Missing coin" }, 400, origin);

    const res = await fetchWithRetry(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd&include_24hr_change=true`,
      {}, 6000, 1
    );
    const data = await res.json();
    const entry = data?.[coinId];
    if (!entry) return jsonResponse({ error: `Unknown coin "${coin}"` }, 404, origin);

    return jsonResponse({
      coin: coinId,
      usd: entry.usd,
      change24hPct: entry.usd_24h_change,
    }, 200, origin);
  } catch (error) {
    return jsonResponse({ error: "Price lookup failed" }, 500, origin);
  }
}

// ═══ /api/verify-payment ═══
//
// Replaces the old design (payment-verify.js checking the blockchain FROM THE BROWSER).
// That can never be made secure: the check runs entirely inside code the user controls, so
// anyone can open devtools and type `window.verifyBep20Payment = async () => ({ok:true})`
// before clicking Verify, and get a plan for free — no matter how well that file is written.
// This route does the same check, but on the server, where the user can't tamper with it,
// and returns a cryptographically signed token as proof of a verified payment.
async function handleVerifyPayment(request, env, origin) {
  try {
    const { txHash, plan } = await request.json();
    if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return jsonResponse({ ok: false, reason: "Invalid transaction hash." }, 400, origin);
    }
    const priceOptions = PLAN_PRICES[plan];
    if (!priceOptions) {
      return jsonResponse({ ok: false, reason: "Unknown plan." }, 400, origin);
    }
    if (!env.BSCSCAN_API_KEY) {
      return jsonResponse({ ok: false, reason: "Phraortes can't verify payments right now — please try again shortly or contact support." }, 500, origin);
    }
    if (!env.LICENSE_SECRET) {
      return jsonResponse({ ok: false, reason: "Phraortes can't activate plans right now — please try again shortly or contact support." }, 500, origin);
    }

    // Replay protection: a given tx hash can only ever activate one plan, once.
    if (env.PHRAORTES_KV) {
      const already = await env.PHRAORTES_KV.get("used:" + txHash);
      if (already) {
        return jsonResponse({ ok: false, reason: "This transaction has already been used to activate a plan." }, 409, origin);
      }
    }

    const apiUrl = `https://api.bscscan.com/api?module=account&action=tokentx&address=${RECEIVER_ADDRESS}&contractaddress=${USDT_BEP20_CONTRACT}&sort=desc&apikey=${env.BSCSCAN_API_KEY}`;
    let bsRes;
    try {
      bsRes = await fetchWithRetry(apiUrl, {}, 8000, 1);
    } catch (err) {
      return jsonResponse({ ok: false, reason: "Couldn't reach the blockchain explorer — please try again in a moment." }, 504, origin);
    }
    const bsData = await bsRes.json();
    const tx = (bsData.result || []).find(t => t.hash?.toLowerCase() === txHash.toLowerCase());

    if (!tx) {
      return jsonResponse({ ok: false, reason: "Transaction not found yet — it may still be confirming. Try again in a minute." }, 404, origin);
    }
    if (tx.to?.toLowerCase() !== RECEIVER_ADDRESS.toLowerCase()) {
      return jsonResponse({ ok: false, reason: "Transaction was not sent to the correct address." }, 400, origin);
    }

    const decimals = parseInt(tx.tokenDecimal || "18", 10);
    const amount = Number(tx.value) / Math.pow(10, decimals);
    const match = priceOptions.find(p => amount + 0.02 >= p.amount); // small epsilon for rounding
    if (!match) {
      return jsonResponse({ ok: false, reason: `Payment amount (${amount} USDT) doesn't match a valid price for this plan.` }, 400, origin);
    }

    if (env.PHRAORTES_KV) {
      await env.PHRAORTES_KV.put("used:" + txHash, plan, { expirationTtl: 60 * 60 * 24 * 400 });
    }

    const token = await issueLicenseToken(plan, match.days, env);
    return jsonResponse({ ok: true, token, plan, validDays: match.days }, 200, origin);
  } catch (error) {
    return jsonResponse({ ok: false, reason: "Verification failed due to a server error." }, 500, origin);
  }
}

// ═══ Free-tier quota, enforced server-side (KV counter keyed by IP + reset window) ═══
async function checkAndConsumeFreeQuota(request, env) {
  if (!env.PHRAORTES_KV) return { ok: true }; // no KV bound yet — fails open; bind it to actually enforce this
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = "msgs:" + ip;
  const current = parseInt((await env.PHRAORTES_KV.get(key)) || "0", 10);
  if (current >= FREE_MSG_LIMIT) return { ok: false };
  await env.PHRAORTES_KV.put(key, String(current + 1), { expirationTtl: FREE_RESET_SECONDS });
  return { ok: true };
}

// ═══ Signed license tokens (no database needed — the signature IS the proof) ═══
async function issueLicenseToken(plan, validDays, env) {
  const now = Date.now();
  const payload = { plan, iat: now, exp: now + validDays * 24 * 60 * 60 * 1000 };
  const payloadB64 = btoa(JSON.stringify(payload));
  const sig = await hmacSign(payloadB64, env.LICENSE_SECRET);
  return payloadB64 + "." + sig;
}
async function verifyLicenseToken(token, env) {
  if (!token || !env.LICENSE_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = await hmacSign(payloadB64, env.LICENSE_SECRET);
  if (sig !== expectedSig) return null; // tampered or forged — reject
  try {
    const payload = JSON.parse(atob(payloadB64));
    if (!payload.exp || payload.exp < Date.now()) return null; // expired
    return payload;
  } catch (e) {
    return null;
  }
}
async function hmacSign(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sigBuf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}
function jsonResponse(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
