const ALLOWED_ORIGIN = "https://novamind-official.github.io";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: corsHeaders(origin),
      });
    }

    const url = new URL(request.url);

    if (url.pathname !== "/api/chat") {
      return new Response("Not Found", {
        status: 404,
        headers: corsHeaders(origin),
      });
    }

    if (origin && origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden", {
        status: 403,
        headers: corsHeaders(origin),
      });
    }

    try {
      const body = await request.json();

      if (!body || !Array.isArray(body.messages)) {
        return new Response(
          JSON.stringify({ error: "Invalid request body" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders(origin),
            },
          }
        );
      }

      const response = await fetch(
        "https://api.x.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.AI_API_KEY}`,
            "Content-Type": "application/json",
          },
          // NovaMind's frontend sends OpenRouter-style model IDs (e.g. "openai/gpt-oss-120b:free"),
          // which are not valid xAI model names. Normalize to a real Grok model here so the
          // frontend's existing model-selection logic keeps working without changes.
          body: JSON.stringify({ ...body, model: "grok-4.6" }),
        }
      );

      const headers = new Headers(response.headers);

      Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

    } catch (error) {
      return new Response(
        JSON.stringify({
          error: "Worker request failed",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(origin),
          },
        }
      );
    }
  },
};

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin":
      origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
