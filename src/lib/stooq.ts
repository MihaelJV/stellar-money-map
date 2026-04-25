// Fetches historical price data via the Lovable Cloud edge function
// (which proxies Yahoo Finance to bypass browser CORS).

export interface PricePoint {
  date: Date;
  close: number;
}

const fmt = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/**
 * Normalize a user-typed ticker to Yahoo Finance format.
 * - Plain symbols (AAPL, SPY) stay as-is.
 * - International suffixes after a dot (VOD.L) stay as-is.
 * - Crypto pairs typed as "BTC" become "BTC-USD".
 */
export function normalizeTicker(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!t) return "";
  return t;
}

export async function fetchHistory(
  ticker: string,
  start: Date,
  end: Date,
): Promise<PricePoint[]> {
  const sym = normalizeTicker(ticker);
  const supaUrl = import.meta.env.VITE_SUPABASE_URL;
  const supaKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${supaUrl}/functions/v1/stooq-proxy?ticker=${encodeURIComponent(sym)}&d1=${fmt(start)}&d2=${fmt(end)}`;

  const res = await fetch(url, {
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.points) {
    throw new Error(data?.error || `Failed to fetch ${ticker}`);
  }

  const points: PricePoint[] = data.points.map((p: { date: string; close: number }) => ({
    date: new Date(p.date),
    close: p.close,
  }));

  if (points.length < 2) throw new Error(`Insufficient data for "${ticker}"`);
  return points;
}
