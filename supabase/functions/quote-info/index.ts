// Fetches Yahoo Finance metadata for a single symbol.
// Yahoo now requires a cookie + crumb for quoteSummary/quote endpoints.

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

let cachedCrumb: { cookie: string; crumb: string; ts: number } | null = null;

async function getCrumb(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedCrumb && Date.now() - cachedCrumb.ts < 30 * 60 * 1000) {
    return { cookie: cachedCrumb.cookie, crumb: cachedCrumb.crumb };
  }
  try {
    // Step 1: hit fc.yahoo.com to receive the consent/A3 cookies.
    const cookieRes = await fetch("https://fc.yahoo.com/", {
      headers: { "User-Agent": UA },
      redirect: "manual",
    });
    const setCookies = cookieRes.headers.getSetCookie?.() ??
      [cookieRes.headers.get("set-cookie") || ""];
    const cookie = setCookies
      .map((c) => c.split(";")[0])
      .filter(Boolean)
      .join("; ");
    if (!cookie) return null;

    // Step 2: fetch a crumb tied to that cookie.
    const crumbRes = await fetch(
      "https://query2.finance.yahoo.com/v1/test/getcrumb",
      { headers: { "User-Agent": UA, Cookie: cookie } },
    );
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.length > 64) return null;

    cachedCrumb = { cookie, crumb, ts: Date.now() };
    return { cookie, crumb };
  } catch {
    return null;
  }
}

async function tryIsin(symbol: string): Promise<string | null> {
  // Strip Yahoo exchange suffix (e.g. VOD.L -> VOD) for the lookup.
  const base = symbol.split(".")[0].split("-")[0];

  // Primary: Markets Insider suggest endpoint returns ISIN inside the
  // pipe-separated Keywords field, e.g. "AAPL|US0378331005|AAPL||AAPL".
  try {
    const r = await fetch(
      `https://markets.businessinsider.com/ajax/SearchController_Suggest?max_results=1&query=${encodeURIComponent(base)}`,
      { headers: { "User-Agent": UA } },
    );
    if (r.ok) {
      const text = await r.text();
      const m = text.match(/\|([A-Z]{2}[A-Z0-9]{9}\d)\|/);
      if (m?.[1]) return m[1];
    }
  } catch { /* fall through */ }

  // Fallback: OpenFIGI mapping (free tier rarely returns ISIN, but kept
  // as a safety net for instruments missing from Markets Insider).
  try {
    const r = await fetch("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ idType: "TICKER", idValue: base }]),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.[0]?.data?.[0]?.isin ?? null;
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

    const auth = await getCrumb();

    const headers: Record<string, string> = {
      "User-Agent": UA,
      Accept: "application/json",
    };
    if (auth?.cookie) headers.Cookie = auth.cookie;

    const crumbParam = auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const modules = "price,summaryDetail,assetProfile,quoteType";

    const endpoints = [
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}${crumbParam}`,
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}${crumbParam}`,
    ];

    let r: any = null;
    let lastStatus = 0;
    for (const ep of endpoints) {
      const res = await fetch(ep, { headers });
      lastStatus = res.status;
      if (!res.ok) {
        await res.body?.cancel();
        continue;
      }
      const data = await res.json();
      r = data?.quoteSummary?.result?.[0];
      if (r) break;
    }

    if (!r) {
      // Fallback to lightweight v7 quote endpoint.
      const qRes = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}${crumbParam}`,
        { headers },
      );
      if (qRes.ok) {
        const qd = await qRes.json();
        const q = qd?.quoteResponse?.result?.[0];
        if (q) {
          const isin = await tryIsin(ticker);
          return json({
            ticker,
            name: q.longName || q.shortName || null,
            exchange: q.fullExchangeName || q.exchange || null,
            currency: q.currency || null,
            marketCap: q.marketCap ?? null,
            avgVolume:
              q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? null,
            quoteType: q.quoteType || null,
            sector: null,
            industry: null,
            isin,
          });
        }
      } else {
        await qRes.body?.cancel();
      }
      return json({ error: `Yahoo returned ${lastStatus || qRes.status}` }, 502);
    }

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
