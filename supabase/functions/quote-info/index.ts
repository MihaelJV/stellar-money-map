// Fetches Yahoo Finance quoteSummary metadata for a single symbol.
// Returns: { ticker, name, exchange, currency, marketCap, avgVolume, isin }

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

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function tryIsin(symbol: string): Promise<string | null> {
  // OpenFIGI free, unauthenticated endpoint (rate-limited but fine for occasional lookups).
  try {
    const r = await fetch("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ idType: "TICKER", idValue: symbol }]),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const figi = data?.[0]?.data?.[0];
    // OpenFIGI does not always return ISIN directly; fall back to compositeFIGI
    return figi?.isin ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") || "").trim().toUpperCase();
    if (!ticker || !/^[A-Z0-9.\-=^]+$/.test(ticker)) {
      return json({ error: "Invalid ticker" }, 400);
    }

    const yahoo = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      ticker,
    )}?modules=price,summaryDetail,assetProfile,quoteType`;

    const res = await fetch(yahoo, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });

    if (!res.ok) return json({ error: `Yahoo returned ${res.status}` }, 502);

    const data = await res.json();
    const r = data?.quoteSummary?.result?.[0];
    if (!r) return json({ error: `No metadata for "${ticker}"` }, 404);

    const price = r.price || {};
    const sd = r.summaryDetail || {};
    const ap = r.assetProfile || {};
    const qt = r.quoteType || {};

    const isin = await tryIsin(ticker);

    return json({
      ticker,
      name: price.longName || price.shortName || qt.longName || qt.shortName || null,
      exchange: price.exchangeName || qt.exchange || null,
      currency: price.currency || sd.currency || null,
      marketCap: price.marketCap?.raw ?? sd.marketCap?.raw ?? null,
      avgVolume:
        sd.averageDailyVolume3Month?.raw ??
        sd.averageDailyVolume10Day?.raw ??
        sd.averageVolume?.raw ??
        null,
      quoteType: qt.quoteType || price.quoteType || null,
      sector: ap.sector || null,
      industry: ap.industry || null,
      isin,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return json({ error: msg }, 500);
  }
});
