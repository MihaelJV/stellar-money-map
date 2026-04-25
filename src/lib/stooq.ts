// Stooq CSV API — CORS enabled, no key needed
// Format: https://stooq.com/q/d/l/?s=aapl.us&d1=20140101&d2=20240101&i=d

export interface PricePoint {
  date: Date;
  close: number;
}

const fmt = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

export function normalizeTicker(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!t) return "";
  // If user typed something with a dot already (aapl.us, btc-usd is fine without dot)
  if (t.includes(".")) return t;
  // Crypto pairs use dash, leave alone if recognizable
  if (/^[a-z]+-[a-z]+$/.test(t)) return t;
  return `${t}.us`;
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
  if (!res.ok) {
    let msg = `Failed to fetch ${ticker}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const text = await res.text();
  if (text.toLowerCase().includes("no data") || !text.includes("\n")) {
    throw new Error(`No data for ticker "${ticker}"`);
  }
  const lines = text.trim().split("\n");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const closeIdx = header.indexOf("close");
  if (dateIdx < 0 || closeIdx < 0) throw new Error(`Bad data for "${ticker}"`);
  const points: PricePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const close = parseFloat(cols[closeIdx]);
    if (!isFinite(close)) continue;
    points.push({ date: new Date(cols[dateIdx]), close });
  }
  if (points.length < 2) throw new Error(`Insufficient data for "${ticker}"`);
  return points;
}
