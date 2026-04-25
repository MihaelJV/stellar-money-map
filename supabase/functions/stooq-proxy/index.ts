// Proxies Yahoo Finance chart API (no key required, works server-side).
// VERSION: yahoo-v2
// Returns normalized JSON: { points: [{date: ISO, close: number}, ...] }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase();
    const d1 = url.searchParams.get("d1") || ""; // YYYYMMDD
    const d2 = url.searchParams.get("d2") || "";

    if (!ticker || !/^[A-Z0-9.\-=^]+$/.test(ticker)) {
      return json({ error: "Invalid ticker" }, 400);
    }
    if (!/^\d{8}$/.test(d1) || !/^\d{8}$/.test(d2)) {
      return json({ error: "Invalid date range" }, 400);
    }

    const toUnix = (s: string) => {
      const y = +s.slice(0, 4), m = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
      return Math.floor(Date.UTC(y, m, d) / 1000);
    };
    const period1 = toUnix(d1);
    const period2 = toUnix(d2);

    const yahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;

    const res = await fetch(yahoo, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json",
      },
    });

    if (!res.ok) {
      return json({ error: `Yahoo returned ${res.status} for "${ticker}"` }, 502);
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const errMsg = data?.chart?.error?.description;
    if (errMsg) return json({ error: errMsg }, 404);
    if (!result) return json({ error: `No data for "${ticker}"` }, 404);

    const timestamps: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose
      || result.indicators?.quote?.[0]?.close
      || [];

    const points: { date: string; close: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && isFinite(c)) {
        points.push({
          date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
          close: c,
        });
      }
    }

    if (points.length < 2) return json({ error: `Insufficient data for "${ticker}"` }, 404);

    return json({ ticker, points });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});
