// Fetches ticker metadata (name, exchange, currency, market cap, avg volume, ISIN)
// via the `quote-info` edge function.

export interface QuoteInfo {
  ticker: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  marketCap: number | null;
  avgVolume: number | null;
  quoteType: string | null;
  sector: string | null;
  industry: string | null;
  isin: string | null;
}

export async function fetchQuoteInfo(ticker: string): Promise<QuoteInfo | null> {
  const supaUrl = import.meta.env.VITE_SUPABASE_URL;
  const supaKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${supaUrl}/functions/v1/quote-info?ticker=${encodeURIComponent(ticker)}`;
  try {
    const res = await fetch(url, {
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) return null;
    return data as QuoteInfo;
  } catch {
    return null;
  }
}
