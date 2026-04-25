// Proxies Stooq daily history CSV. Public endpoint, no auth required.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") || "").trim().toLowerCase();
    const d1 = url.searchParams.get("d1") || "";
    const d2 = url.searchParams.get("d2") || "";

    if (!ticker || !/^[a-z0-9.\-]+$/.test(ticker)) {
      return new Response(JSON.stringify({ error: "Invalid ticker" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!/^\d{8}$/.test(d1) || !/^\d{8}$/.test(d2)) {
      return new Response(JSON.stringify({ error: "Invalid date range" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stooqUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&d1=${d1}&d2=${d2}&i=d`;
    const res = await fetch(stooqUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioLab/1.0)" },
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Stooq returned ${res.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const text = await res.text();
    if (!text || text.toLowerCase().includes("no data") || !text.includes("\n")) {
      return new Response(
        JSON.stringify({ error: `No data for "${ticker}"` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/csv" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
