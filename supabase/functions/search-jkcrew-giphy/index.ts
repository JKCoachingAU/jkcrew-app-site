const allowedOrigins = new Set([
  "https://jkcoachingau.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

const jsonHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://jkcoachingau.github.io",
  "Content-Type": "application/json",
  "Vary": "Origin",
});

const respond = (origin: string | null, body: Record<string, unknown>, status = 200) => (
  new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) })
);

const imageUrl = (gif: any, keys: string[]) => {
  const images = gif?.images || {};
  for (const key of keys) {
    const url = images[key]?.url;
    if (typeof url === "string" && url.startsWith("https://")) return url;
  }
  return "";
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: jsonHeaders(origin) });
  }
  if (req.method !== "POST" || !origin || !allowedOrigins.has(origin)) {
    return respond(origin, { error: "Giphy search is only available inside JKCREW." }, 403);
  }

  const apiKey = Deno.env.get("GIPHY_API_KEY")?.trim();
  if (!apiKey) {
    return respond(origin, { error: "Giphy search is not configured yet. Add the GIPHY_API_KEY secret in Supabase." }, 503);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim().slice(0, 80);
    const offset = Math.max(0, Math.min(Number(body.offset || 0) || 0, 4800));
    const params = new URLSearchParams({
      api_key: apiKey,
      limit: "24",
      offset: String(offset),
      rating: "pg",
      lang: "en",
      bundle: "messaging_non_clips",
    });
    if (query) params.set("q", query);
    const endpoint = query ? "search" : "trending";
    const giphyResponse = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`);
    const payload = await giphyResponse.json().catch(() => ({}));

    if (!giphyResponse.ok) {
      const message = payload?.meta?.msg || "Giphy search failed. Please try again.";
      return respond(origin, { error: message }, giphyResponse.status);
    }

    const gifs = (payload.data || []).map((gif: any) => ({
      id: gif.id,
      label: gif.title || gif.slug || "Giphy GIF",
      url: imageUrl(gif, ["fixed_height", "downsized_medium", "original"]),
      preview: imageUrl(gif, ["fixed_width_small", "fixed_height_small", "fixed_width", "downsized"]),
    })).filter((gif: { url: string; preview: string }) => gif.url && gif.preview);

    const pagination = payload.pagination || {};
    const nextOffset = Number(pagination.offset || 0) + Number(pagination.count || gifs.length || 0);
    const hasMore = nextOffset < Number(pagination.total_count || 0);

    return respond(origin, { gifs, hasMore, nextOffset });
  } catch (error) {
    console.error("Giphy search failed", error);
    return respond(origin, { error: "Giphy search failed. Please try again." }, 500);
  }
});
