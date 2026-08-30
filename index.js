// Reference implementation — compare this against your already-deployed Worker.
// If your Worker's request/response shape differs, tell me and I'll adjust
// the frontend's fetchAI() call to match instead of changing your Worker.

const ALLOWED_ORIGIN = "https://novamind-official.github.io";

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.json(); // { model, messages }

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.AI_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": ALLOWED_ORIGIN,
        "X-Title": "Phraortes",
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.text(); // pass OpenRouter's JSON straight through

    return new Response(data, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      },
    });
  },
};
