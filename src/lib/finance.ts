import type { PricePoint } from "./stooq";

export function cagr(points: PricePoint[]): number {
  if (points.length < 2) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  const years =
    (last.date.getTime() - first.date.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0 || first.close <= 0) return 0;
  return Math.pow(last.close / first.close, 1 / years) - 1;
}

/** Return monthly closing prices indexed by YYYY-MM (last close of each month). */
export function monthlyCloses(points: PricePoint[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of points) {
    const key = `${p.date.getUTCFullYear()}-${String(p.date.getUTCMonth() + 1).padStart(2, "0")}`;
    map.set(key, p.close); // overwrite -> keeps the latest in month
  }
  return map;
}

/** Monthly returns as Map<YYYY-MM, return>. */
export function monthlyReturns(points: PricePoint[]): Map<string, number> {
  const closes = monthlyCloses(points);
  const keys = Array.from(closes.keys()).sort();
  const ret = new Map<string, number>();
  for (let i = 1; i < keys.length; i++) {
    const prev = closes.get(keys[i - 1])!;
    const cur = closes.get(keys[i])!;
    if (prev > 0) ret.set(keys[i], cur / prev - 1);
  }
  return ret;
}

function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
}

/** Annualized standard deviation from monthly returns (sample std * sqrt(12)). */
export function annualizedStdDev(monthly: Map<string, number>): number {
  const arr = Array.from(monthly.values());
  const n = arr.length;
  if (n < 2) return 0;
  const m = mean(arr);
  let sum = 0;
  for (const x of arr) sum += (x - m) * (x - m);
  const variance = sum / (n - 1); // sample variance
  return Math.sqrt(variance) * Math.sqrt(12);
}

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

export function correlationMatrix(
  series: Record<string, Map<string, number>>,
): Record<string, Record<string, number>> {
  const tickers = Object.keys(series);
  // Find common months
  const allMonths = tickers.map((t) => Array.from(series[t].keys()));
  const common =
    allMonths.length === 0
      ? []
      : allMonths.reduce((acc, cur) => acc.filter((m) => cur.includes(m)));
  const aligned: Record<string, number[]> = {};
  for (const t of tickers) {
    aligned[t] = common.map((m) => series[t].get(m)!);
  }
  const out: Record<string, Record<string, number>> = {};
  for (const a of tickers) {
    out[a] = {};
    for (const b of tickers) {
      out[a][b] = correlation(aligned[a], aligned[b]);
    }
  }
  return out;
}

/** Invert a square matrix via Gauss-Jordan. Returns null if singular. */
export function invertMatrix(m: number[][]): number[][] | null {
  const n = m.length;
  if (n === 0) return null;
  const a = m.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    }
    if (Math.abs(a[pivot][i]) < 1e-12) return null;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const div = a[i][i];
    for (let j = 0; j < 2 * n; j++) a[i][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = a[r][i];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[i][j];
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * Tangency (max-Sharpe) portfolio weights.
 *   w ∝ Σ⁻¹ (μ − rf·1), normalized so Σwᵢ = 1.
 * Returns null when the covariance matrix is singular or weights sum to ~0.
 */
export function tangencyWeights(
  mu: number[],
  cov: number[][],
  rf: number,
): number[] | null {
  const n = mu.length;
  if (n === 0 || cov.length !== n) return null;
  const inv = invertMatrix(cov);
  if (!inv) return null;
  const excess = mu.map((x) => x - rf);
  const z = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) z[i] += inv[i][j] * excess[j];
  }
  const s = z.reduce((a, b) => a + b, 0);
  if (Math.abs(s) < 1e-12) return null;
  return z.map((x) => x / s);
}

export const SCENARIO_MULTIPLIERS = {
  boom: 1.2,
  bullish: 1,
  sideways: 0.5,
  bearish: -0.2,
  recession: -1,
} as const;

export type Scenario = keyof typeof SCENARIO_MULTIPLIERS;

export const SCENARIO_LABELS: Record<Scenario, string> = {
  boom: "Boom",
  bullish: "Bullish",
  sideways: "Sideways",
  bearish: "Bearish",
  recession: "Recession",
};
