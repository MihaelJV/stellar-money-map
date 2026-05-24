import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, X, TrendingUp, Activity, Sparkles, Info } from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { fetchHistory, type PricePoint } from "@/lib/stooq";
import { fetchQuoteInfo, type QuoteInfo } from "@/lib/quoteInfo";
import {
  cagr, monthlyReturns, correlationMatrix, annualizedStdDev, tangencyWeights, beta,
  arithmeticExpected, constrainWeights,
  SCENARIO_MULTIPLIERS, SCENARIO_LABELS, type Scenario,
} from "@/lib/finance";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface Asset {
  ticker: string;
  weight: number;       // 0-100
  return: number;       // CAGR
  monthly: Map<string, number>;
  info?: QuoteInfo | null;
}


const CHART_COLORS = [
  "hsl(var(--chart-1))","hsl(var(--chart-2))","hsl(var(--chart-3))","hsl(var(--chart-4))",
  "hsl(var(--chart-5))","hsl(var(--chart-6))","hsl(var(--chart-7))","hsl(var(--chart-8))",
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const yearsAgoISO = (n: number) => {
  const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0,10);
};

const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;
const money = (x: number) => x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const compactNum = (x: number | null | undefined) => {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `${(x / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(x / 1e3).toFixed(2)}K`;
  return x.toLocaleString();
};

const TickerInfoBadge = ({ ticker, info }: { ticker: string; info?: QuoteInfo | null }) => (
  <HoverCard openDelay={150}>
    <HoverCardTrigger asChild>
      <button
        type="button"
        aria-label={`About ${ticker}`}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </HoverCardTrigger>
    <HoverCardContent className="w-72 text-xs leading-relaxed">
      {!info ? (
        <p className="text-muted-foreground">No metadata available for {ticker}.</p>
      ) : (
        <>
          {info.name && <p className="mb-2 font-semibold">{info.name}</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">ISIN</dt>
            <dd className="font-mono">{info.isin ?? "—"}</dd>
            <dt className="text-muted-foreground">Exchange</dt>
            <dd>{info.exchange ?? "—"}</dd>
            <dt className="text-muted-foreground">Currency</dt>
            <dd>{info.currency ?? "—"}</dd>
            <dt className="text-muted-foreground">Market cap</dt>
            <dd>{compactNum(info.marketCap)}{info.currency ? ` ${info.currency}` : ""}</dd>
            <dt className="text-muted-foreground">Avg daily vol</dt>
            <dd>{compactNum(info.avgVolume)}</dd>
          </dl>
        </>
      )}
    </HoverCardContent>
  </HoverCard>
);


const Index = () => {
  const [startDate, setStartDate] = useState(yearsAgoISO(10));
  const [endDate, setEndDate] = useState(todayISO());
  const [tickerInput, setTickerInput] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  const [scenarioYears, setScenarioYears] = useState(5);
  const [initialValue, setInitialValue] = useState(10000);
  const [colorfulScenarios, setColorfulScenarios] = useState<Scenario[]>([]);

  // Advanced optimizer settings
  const [maxAlloc, setMaxAlloc] = useState(35);          // % cap per asset
  const allowShort = false;                               // long-only: weights constrained to [0%, cap]
  const [shrinkage, setShrinkage] = useState(0.7);       // weight on historical estimate (0–1)
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // keep colorful scenarios sized
  useEffect(() => {
    setColorfulScenarios((prev) => {
      const next = [...prev];
      while (next.length < scenarioYears) next.push("bullish");
      next.length = scenarioYears;
      return next;
    });
  }, [scenarioYears]);

  const totalWeight = useMemo(
    () => assets.reduce((s, a) => s + a.weight, 0),
    [assets],
  );

  // Portfolio CAGR (geometric, used for compounding scenarios)
  const portfolioCagr = useMemo(
    () => assets.reduce((s, a) => s + a.return * (a.weight / 100), 0),
    [assets],
  );

  const stdDevs = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of assets) map[a.ticker] = annualizedStdDev(a.monthly);
    return map;
  }, [assets]);

  const correlations = useMemo(() => {
    if (assets.length < 2) return null;
    const series: Record<string, Map<string, number>> = {};
    for (const a of assets) series[a.ticker] = a.monthly;
    return correlationMatrix(series);
  }, [assets]);

  const covariances = useMemo(() => {
    if (!correlations) return null;
    const out: Record<string, Record<string, number>> = {};
    for (const a of assets) {
      out[a.ticker] = {};
      for (const b of assets) {
        out[a.ticker][b.ticker] = stdDevs[a.ticker] * stdDevs[b.ticker] * correlations[a.ticker][b.ticker];
      }
    }
    return out;
  }, [assets, correlations, stdDevs]);

  // Weighted portfolio standard deviation: sqrt(wᵀ Σ w). Falls back to
  // weighted single-asset std dev when only one ticker is loaded.
  const portfolioStdDev = useMemo(() => {
    if (assets.length === 0) return 0;
    if (assets.length === 1) {
      return (assets[0].weight / 100) * (stdDevs[assets[0].ticker] ?? 0);
    }
    if (!covariances) return 0;
    const w = assets.map((a) => a.weight / 100);
    let v = 0;
    for (let i = 0; i < assets.length; i++) {
      for (let j = 0; j < assets.length; j++) {
        v += w[i] * w[j] * covariances[assets[i].ticker][assets[j].ticker];
      }
    }
    return Math.sqrt(Math.max(0, v));
  }, [assets, covariances, stdDevs]);

  // Risk-free proxy ticker by horizon
  const rfTicker = useMemo(() => {
    if (scenarioYears < 1) return "^IRX";   // 13-week T-bill yield
    if (scenarioYears <= 7) return "^FVX";  // 5-year Treasury yield
    if (scenarioYears <= 10) return "^TNX"; // 10-year Treasury yield
    return "^TYX";                          // 30-year Treasury yield
  }, [scenarioYears]);

  const rfLabel = useMemo(() => {
    if (scenarioYears < 1) return "3-month T-Bill (^IRX)";
    if (scenarioYears <= 7) return "5-year Treasury Note (^FVX)";
    if (scenarioYears <= 10) return "10-year Treasury Note (^TNX)";
    return "30-year Treasury Bond (^TYX)";
  }, [scenarioYears]);

  const [riskFreeRate, setRiskFreeRate] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const points = await fetchHistory(rfTicker, new Date(startDate), new Date(endDate));
        if (!cancelled && points.length > 0) {
          // Yahoo treasury yield indices quote yield in percent
          setRiskFreeRate(points[points.length - 1].close / 100);
        }
      } catch {
        if (!cancelled) setRiskFreeRate(null);
      }
    })();
    return () => { cancelled = true; };
  }, [rfTicker, startDate, endDate]);

  // Market monthly returns + CAGR (S&P 500) — used for beta and the shrinkage prior
  const [marketMonthly, setMarketMonthly] = useState<Map<string, number> | null>(null);
  const [marketCagr, setMarketCagr] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const points = await fetchHistory("^GSPC", new Date(startDate), new Date(endDate));
        if (!cancelled) {
          setMarketMonthly(monthlyReturns(points));
          setMarketCagr(cagr(points));
        }
      } catch {
        if (!cancelled) { setMarketMonthly(null); setMarketCagr(0); }
      }
    })();
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  // Arithmetic expected return per asset ≈ CAGR + σ²/2
  const arithReturns = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of assets) map[a.ticker] = arithmeticExpected(a.return, stdDevs[a.ticker] ?? 0);
    return map;
  }, [assets, stdDevs]);

  // Shrinkage toward market prior: blend arithmetic estimate with market baseline
  const blendedReturns = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of assets) {
      map[a.ticker] = shrinkage * (arithReturns[a.ticker] ?? 0) + (1 - shrinkage) * marketCagr;
    }
    return map;
  }, [assets, arithReturns, shrinkage, marketCagr]);

  // Portfolio expected return (blended arithmetic, used for optimizer & display)
  const portfolioReturn = useMemo(
    () => assets.reduce((s, a) => s + (blendedReturns[a.ticker] ?? 0) * (a.weight / 100), 0),
    [assets, blendedReturns],
  );

  // Tangency (max-Sharpe) weights — uses blended μ, then applies cap & no-short constraints
  const tangency = useMemo(() => {
    if (!covariances || riskFreeRate === null || assets.length < 2) return null;
    const mu = assets.map((a) => blendedReturns[a.ticker] ?? 0);
    const cov = assets.map((a) => assets.map((b) => covariances[a.ticker][b.ticker]));
    const w = tangencyWeights(mu, cov, riskFreeRate);
    if (!w) return null;
    const constrained = constrainWeights(w, maxAlloc / 100, allowShort);
    if (!constrained) return null;
    return constrained.map((x) => x * 100);
  }, [assets, covariances, riskFreeRate, blendedReturns, maxAlloc, allowShort]);

  const betas = useMemo(() => {
    const map: Record<string, number> = {};
    if (!marketMonthly) return map;
    for (const a of assets) map[a.ticker] = beta(a.monthly, marketMonthly);
    return map;
  }, [assets, marketMonthly]);

  const portfolioBeta = useMemo(
    () => assets.reduce((s, a) => s + (betas[a.ticker] ?? 0) * (a.weight / 100), 0),
    [assets, betas],
  );

  const applyOptimise = () => {
    if (!tangency) {
      toast.error("Cannot compute optimal weights (need ≥ 2 assets and a risk-free rate).");
      return;
    }
    setAssets((prev) => prev.map((a, i) => ({ ...a, weight: tangency[i] ?? a.weight })));
    toast.success("Applied tangency-portfolio weights");
  };

  const yearsToDouble = portfolioCagr > 0 ? 70 / (portfolioCagr * 100) : Infinity;

  const addTicker = useCallback(async () => {
    const raw = tickerInput.trim().toUpperCase();
    if (!raw) return;
    if (assets.some((a) => a.ticker === raw)) {
      toast.error(`${raw} already added`);
      return;
    }
    setLoading(true);
    try {
      const [points, info] = await Promise.all([
        fetchHistory(raw, new Date(startDate), new Date(endDate)),
        fetchQuoteInfo(raw),
      ]);
      const r = cagr(points);
      const monthly = monthlyReturns(points);
      setAssets((prev) => {
        const next = [...prev, { ticker: raw, weight: 0, return: r, monthly, info }];
        const equal = 100 / next.length;
        return next.map((a) => ({ ...a, weight: equal }));
      });
      setTickerInput("");
      toast.success(`Added ${raw} — CAGR ${pct(r)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [tickerInput, assets, startDate, endDate, totalWeight]);

  const removeAsset = (t: string) => setAssets((prev) => prev.filter((a) => a.ticker !== t));

  const setWeight = (t: string, w: number) => {
    setAssets((prev) => {
      const idx = prev.findIndex((a) => a.ticker === t);
      if (idx === -1) return prev;
      if (w < 0 || w > 100) {
        toast.error("Weight must be between 0 and 100");
        return prev;
      }
      // Special case: editing the last asset adjusts the one immediately above
      if (idx === prev.length - 1 && prev.length > 1) {
        const othersAboveSum = prev.slice(0, idx - 1).reduce((s, a) => s + a.weight, 0);
        const adjusted = 100 - othersAboveSum - w;
        if (adjusted < -0.0001) {
          toast.error("Weights above + this entry exceed 100%");
          return prev;
        }
        return prev.map((a, i) => {
          if (i === idx) return { ...a, weight: w };
          if (i === idx - 1) return { ...a, weight: Math.max(0, adjusted) };
          return a;
        });
      }
      const aboveSum = prev.slice(0, idx).reduce((s, a) => s + a.weight, 0);
      const remaining = 100 - aboveSum - w;
      if (remaining < -0.0001) {
        toast.error("Weights above + this entry exceed 100%");
        return prev;
      }
      const belowCount = prev.length - idx - 1;
      const each = belowCount > 0 ? Math.max(0, remaining) / belowCount : 0;
      return prev.map((a, i) => {
        if (i === idx) return { ...a, weight: w };
        if (i < idx) return a;
        return { ...a, weight: each };
      });
    });
  };

  const refetchAll = useCallback(async () => {
    if (assets.length === 0) return;
    setLoading(true);
    try {
      const updated = await Promise.all(assets.map(async (a) => {
        const p = await fetchHistory(a.ticker, new Date(startDate), new Date(endDate));
        return { ...a, return: cagr(p), monthly: monthlyReturns(p) };
      }));
      setAssets(updated);
      toast.success("Returns recalculated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [assets, startDate, endDate]);

  // Build scenario tables — compound using portfolio CAGR (geometric)
  const buildScenarioRows = (scenarios: Scenario[]) => {
    const rows = [];
    let value = initialValue;
    let cumulative = 1;
    for (let y = 0; y < scenarios.length; y++) {
      const s = scenarios[y];
      const annual = portfolioCagr * SCENARIO_MULTIPLIERS[s];
      cumulative *= 1 + annual;
      value *= 1 + annual;
      rows.push({ year: y + 1, scenario: s, annual, cumulative: cumulative - 1, value });
    }
    return rows;
  };

  const baselineScenarios = useMemo<Scenario[]>(
    () => Array(scenarioYears).fill("bullish"),
    [scenarioYears],
  );
  const baselineRows = useMemo(() => buildScenarioRows(baselineScenarios), [baselineScenarios, portfolioCagr, initialValue]);
  const colorfulRows = useMemo(() => buildScenarioRows(colorfulScenarios), [colorfulScenarios, portfolioCagr, initialValue]);

  const compareData = useMemo(() => {
    const data: { year: number | string; baseline: number; colorful: number }[] = [
      { year: 0, baseline: initialValue, colorful: initialValue },
    ];
    for (let i = 0; i < scenarioYears; i++) {
      data.push({
        year: i + 1,
        baseline: baselineRows[i]?.value ?? initialValue,
        colorful: colorfulRows[i]?.value ?? initialValue,
      });
    }
    return data;
  }, [baselineRows, colorfulRows, scenarioYears, initialValue]);

  const pieData = assets.map((a) => ({ name: a.ticker, value: a.weight }));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-gradient-card">
        <div className="container py-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Portfolio Scenario Lab</h1>
              <p className="text-sm text-muted-foreground">Stress-test allocations across market regimes</p>
            </div>
          </div>
        </div>
      </div>

      <main className="container space-y-6 py-8">
        {/* Date range */}
        <Card className="bg-gradient-card p-6 shadow-card">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="start">Start date</Label>
              <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">End date</Label>
              <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <Button variant="secondary" onClick={refetchAll} disabled={loading || assets.length === 0}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Recalculate"}
            </Button>
          </div>
        </Card>

        {/* Add ticker */}
        <Card className="bg-gradient-card p-6 shadow-card">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="ticker">Add ticker</Label>
              <Input
                id="ticker"
                placeholder="AAPL, MSFT, SPY, BTC-USD…"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTicker()}
                disabled={loading}
              />
            </div>
            <Button onClick={addTicker} disabled={loading || !tickerInput.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1 h-4 w-4" />Add</>}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Tickers default to US equities. Use suffixes like <code className="text-foreground">.UK</code>, <code className="text-foreground">.DE</code>, or pairs like <code className="text-foreground">BTC-USD</code>.
          </p>
        </Card>

        {/* Portfolio composition */}
        {assets.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="bg-gradient-card p-6 shadow-card">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Activity className="h-4 w-4 text-primary" />
                Allocation
              </h2>
              <div className="space-y-3">
                {assets.map((a, i) => (
                  <div key={a.ticker} className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <div className="flex w-24 items-center gap-1">
                      <span className="font-mono text-sm font-semibold">{a.ticker}</span>
                      <TickerInfoBadge ticker={a.ticker} info={a.info} />
                    </div>


                    <WeightInput
                      value={a.weight}
                      onCommit={(v) => setWeight(a.ticker, v)}
                    />

                    <span className="text-sm text-muted-foreground">%</span>
                    <span className="ml-2 w-28 text-right text-xs text-muted-foreground" title="Tangency (max-Sharpe) suggestion">
                      Opt:{" "}
                      <span className="font-medium text-primary">
                        {tangency ? `${tangency[i].toFixed(1)}%` : "—"}
                      </span>
                    </span>
                    <span className={`ml-auto text-sm font-medium ${a.return >= 0 ? "text-bull" : "text-bear"}`} title="CAGR (geometric)">
                      {pct(a.return)}
                    </span>
                    <Button size="icon" variant="ghost" onClick={() => removeAsset(a.ticker)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm text-muted-foreground">Total weight</span>
                  <span className={`font-semibold ${totalWeight === 100 ? "text-bull" : totalWeight > 100 ? "text-bear" : "text-neutral"}`}>
                    {totalWeight.toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    Expected return (weighted, arithmetic)
                    <HoverCard openDelay={150}>
                      <HoverCardTrigger asChild>
                        <button
                          type="button"
                          aria-label="How is expected return computed?"
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </HoverCardTrigger>
                      <HoverCardContent className="w-80 text-xs leading-relaxed">
                        <p className="mb-2">
                          <span className="font-semibold">Geometric (CAGR)</span> is what compounds your money;{" "}
                          <span className="font-semibold">arithmetic expected return</span>{" "}
                          is the per-period average used in mean-variance optimisation.
                        </p>
                        <p className="mb-2 text-muted-foreground">
                          We approximate it as <span className="font-mono">μ ≈ CAGR + σ²/2</span> (volatility-adjusted),
                          then shrink toward the market baseline (S&amp;P 500 CAGR ={" "}
                          <span className="font-mono">{pct(marketCagr)}</span>):
                        </p>
                        <p className="font-mono text-muted-foreground">
                          μ_blend = {shrinkage.toFixed(2)}·μ + {(1 - shrinkage).toFixed(2)}·μ_market
                        </p>
                      </HoverCardContent>
                    </HoverCard>
                  </span>
                  <span className={`font-semibold ${portfolioReturn >= 0 ? "text-bull" : "text-bear"}`}>
                    {pct(portfolioReturn)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Portfolio CAGR (geometric)</span>
                  <span className={`font-semibold ${portfolioCagr >= 0 ? "text-bull" : "text-bear"}`}>
                    {pct(portfolioCagr)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Risk-free return <span className="text-xs">({rfLabel})</span>
                  </span>
                  <span className="font-semibold text-primary">
                    {riskFreeRate === null ? "—" : pct(riskFreeRate)}
                  </span>
                </div>

                {/* Advanced optimiser settings */}
                <div className="border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {advancedOpen ? "▾" : "▸"} Advanced optimiser settings
                  </button>
                  {advancedOpen && (
                    <div className="mt-3 space-y-3 rounded-md border border-border bg-background/40 p-3 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor="maxAlloc" className="text-muted-foreground">Max allocation per asset</label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="maxAlloc"
                            type="number"
                            min={1}
                            max={100}
                            className="h-8 w-20"
                            value={maxAlloc}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v > 0 && v <= 100) setMaxAlloc(v);
                            }}
                          />
                          <span className="text-muted-foreground">%</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor="shrinkage" className="text-muted-foreground">
                          Historical weight (vs market prior)
                        </label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="shrinkage"
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            className="h-8 w-20"
                            value={shrinkage}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v >= 0 && v <= 1) setShrinkage(v);
                            }}
                          />
                          <span className="text-muted-foreground">{(shrinkage * 100).toFixed(0)}% / {((1 - shrinkage) * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                      <p className="text-muted-foreground">
                        Defaults: 35% cap per asset, long-only (0–100% per asset), 70% historical / 30% market prior.
                      </p>

                    </div>
                  )}
                </div>

                <HoverCard openDelay={150}>
                  <HoverCardTrigger asChild>
                    <Button
                      variant="secondary"
                      className="mt-2 w-full"
                      onClick={applyOptimise}
                    >
                      Optimise
                    </Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80 text-xs leading-relaxed">
                    <p className="mb-1 font-semibold">Tangency Portfolio (Maximum Sharpe Ratio)</p>
                    <p className="mb-2 text-muted-foreground">
                      Finds the point on the Efficient Frontier where return per
                      unit of risk is highest.
                    </p>
                    <p className="mb-1">
                      Goal: maximize <span className="font-mono">(E[Rₚ] − R_f) / σₚ</span>
                    </p>
                    <p className="mb-2 text-muted-foreground">
                      Closed form: w ∝ Σ⁻¹ (μ − R_f·1). Uses volatility-adjusted,
                      shrinkage-blended expected returns; then constrained to a{" "}
                      {maxAlloc}% cap per asset, long-only (0–100%),
                      and renormalised so weights sum to 100%.
                    </p>
                    <p className="rounded bg-muted/40 p-2 italic text-muted-foreground">
                      Disclaimer: mean-variance optimisation is highly sensitive
                      to expected return assumptions. Results are exploratory
                      scenarios, not predictions.
                    </p>
                  </HoverCardContent>
                </HoverCard>
              </div>
            </Card>

            <Card className="bg-gradient-card p-6 shadow-card">
              <h2 className="mb-4 text-lg font-semibold">Portfolio structure</h2>
              <div className="h-72">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="hsl(var(--background))" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                      formatter={(v: number) => `${v}%`}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  Portfolio std. deviation (risk)
                  <HoverCard openDelay={150}>
                    <HoverCardTrigger asChild>
                      <button
                        type="button"
                        aria-label="What does portfolio standard deviation mean?"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-80 text-xs leading-relaxed">
                      <p className="mb-2">
                        Portfolio standard deviation measures the typical
                        year-to-year swing of the whole portfolio's return
                        around its average. Higher = more volatile = riskier.
                      </p>
                      <p className="mb-2 text-muted-foreground">
                        Computed as <span className="font-mono">σₚ = √(wᵀ Σ w)</span>,
                        where <span className="font-mono">Σ</span> is the
                        annualized covariance matrix and{" "}
                        <span className="font-mono">w</span> the weight vector.
                      </p>
                      <p className="text-muted-foreground">
                        Minimising σₚ via diversification (combining assets
                        whose returns are not perfectly correlated) lowers
                        overall risk without necessarily lowering expected
                        return — the core idea behind modern portfolio theory.
                      </p>
                    </HoverCardContent>
                  </HoverCard>
                </span>
                <span className="font-semibold text-primary">
                  {pct(portfolioStdDev)}
                </span>
              </div>
            </Card>

            <Card className="bg-gradient-card p-6 shadow-card lg:col-span-2">
              <h2 className="mb-4 text-lg font-semibold">Asset returns</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>CAGR (geometric)</TableHead>
                    <TableHead>Arithmetic μ ≈ CAGR + σ²/2</TableHead>
                    <TableHead>Blended μ (used by optimiser)</TableHead>
                    <TableHead>Period</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((a) => (
                    <TableRow key={a.ticker}>
                      <TableCell className="font-mono font-semibold">{a.ticker}</TableCell>
                      <TableCell>{a.weight}%</TableCell>
                      <TableCell className={a.return >= 0 ? "text-bull" : "text-bear"}>{pct(a.return)}</TableCell>
                      <TableCell className={(arithReturns[a.ticker] ?? 0) >= 0 ? "text-bull" : "text-bear"}>
                        {pct(arithReturns[a.ticker] ?? 0)}
                      </TableCell>
                      <TableCell className={(blendedReturns[a.ticker] ?? 0) >= 0 ? "text-bull" : "text-bear"}>
                        {pct(blendedReturns[a.ticker] ?? 0)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{startDate} → {endDate}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            {correlations && (
              <Card className="bg-gradient-card p-6 shadow-card lg:col-span-2">
                <h2 className="mb-4 text-lg font-semibold">Monthly return correlations</h2>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead></TableHead>
                        {assets.map((a) => <TableHead key={a.ticker} className="font-mono">{a.ticker}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assets.map((a) => (
                        <TableRow key={a.ticker}>
                          <TableCell className="font-mono font-semibold">{a.ticker}</TableCell>
                          {assets.map((b) => {
                            const v = correlations[a.ticker][b.ticker];
                            const intensity = Math.abs(v);
                            const color = v >= 0 ? "152 76% 50%" : "0 75% 60%";
                            return (
                              <TableCell key={b.ticker} style={{ background: `hsl(${color} / ${intensity * 0.25})` }}>
                                {v.toFixed(2)}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}

            {assets.length > 0 && (
              <Card className="bg-gradient-card p-6 shadow-card lg:col-span-2">
                <h2 className="mb-4 text-lg font-semibold">Annualized standard deviation</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Std. dev. (annualized)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((a) => (
                      <TableRow key={a.ticker}>
                        <TableCell className="font-mono font-semibold">{a.ticker}</TableCell>
                        <TableCell>{pct(stdDevs[a.ticker] ?? 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}

            {covariances && (
              <Card className="bg-gradient-card p-6 shadow-card lg:col-span-2">
                <h2 className="mb-4 text-lg font-semibold">Covariance matrix (annualized)</h2>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead></TableHead>
                        {assets.map((a) => <TableHead key={a.ticker} className="font-mono">{a.ticker}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assets.map((a) => (
                        <TableRow key={a.ticker}>
                          <TableCell className="font-mono font-semibold">{a.ticker}</TableCell>
                          {assets.map((b) => {
                            const v = covariances[a.ticker][b.ticker];
                            const color = v >= 0 ? "152 76% 50%" : "0 75% 60%";
                            const intensity = Math.min(1, Math.abs(v) * 4);
                            return (
                              <TableCell key={b.ticker} style={{ background: `hsl(${color} / ${intensity * 0.25})` }}>
                                {v.toFixed(4)}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}

            {assets.length > 0 && (
              <Card className="bg-gradient-card p-6 shadow-card lg:col-span-2">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  Beta vs market (S&amp;P 500)
                  <HoverCard openDelay={150}>
                    <HoverCardTrigger asChild>
                      <button
                        type="button"
                        aria-label="What is beta?"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-80 text-xs leading-relaxed">
                      <p className="mb-2">
                        Beta (β) measures an asset's market risk — how much its
                        returns move relative to the broad market (S&amp;P 500).
                      </p>
                      <p className="mb-2 text-muted-foreground">
                        β = Cov(R<sub>asset</sub>, R<sub>market</sub>) / Var(R<sub>market</sub>),
                        computed from aligned monthly returns.
                      </p>
                      <p className="text-muted-foreground">
                        β = 1: moves with the market. β &gt; 1: more volatile
                        than market. β &lt; 1: less volatile. β &lt; 0: tends
                        to move opposite to the market. Portfolio β is the
                        weighted average of asset betas.
                      </p>
                    </HoverCardContent>
                  </HoverCard>
                </h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Beta (β)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((a) => (
                      <TableRow key={a.ticker}>
                        <TableCell className="font-mono font-semibold">{a.ticker}</TableCell>
                        <TableCell>{marketMonthly ? (betas[a.ticker] ?? 0).toFixed(3) : "—"}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-semibold">Portfolio (weighted)</TableCell>
                      <TableCell className="font-semibold text-primary">
                        {marketMonthly ? portfolioBeta.toFixed(3) : "—"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Card>
            )}
          </div>
        )}

        {/* Scenario analysis */}
        {assets.length > 0 && (
          <Card className="bg-gradient-card p-6 shadow-card">
            <div className="mb-6 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Scenario analysis</h2>
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="years">Horizon (years)</Label>
                <NumberInput
                  id="years"
                  value={scenarioYears}
                  min={1}
                  max={50}
                  integer
                  onCommit={(v) => setScenarioYears(v)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="iv">Initial value (USD)</Label>
                <NumberInput
                  id="iv"
                  value={initialValue}
                  min={0}
                  onCommit={(v) => setInitialValue(v)}
                />
              </div>
              <div className="space-y-2">
                <Label>Time to double money</Label>
                <div className="flex h-10 items-center rounded-md border border-border bg-input px-3 text-sm">
                  {isFinite(yearsToDouble) ? (
                    <span><span className="font-semibold text-primary">{yearsToDouble.toFixed(1)}</span> years <span className="ml-1 text-xs text-muted-foreground">(rule of 70)</span></span>
                  ) : (
                    <span className="text-muted-foreground">N/A (non-positive return)</span>
                  )}
                </div>
              </div>
            </div>

            {/* Baseline + Colorful tables */}
            <div className="grid gap-6 xl:grid-cols-2">
              <ScenarioTable
                title="Baseline (bullish)"
                rows={baselineRows}
                editable={false}
              />
              <ScenarioTable
                title="Custom scenario path"
                rows={colorfulRows}
                editable
                scenarios={colorfulScenarios}
                onChange={(idx, s) =>
                  setColorfulScenarios((prev) => prev.map((x, i) => (i === idx ? s : x)))
                }
              />
            </div>

            {/* Comparison line chart */}
            <div className="mt-6 h-80">
              <ResponsiveContainer>
                <LineChart data={compareData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="year" stroke="hsl(var(--muted-foreground))" label={{ value: "Year", position: "insideBottom", offset: -5, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    formatter={(v: number) => money(v)}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="baseline" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} name="Baseline" />
                  <Line type="monotone" dataKey="colorful" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} name="Custom path" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {assets.length === 0 && (
          <Card className="bg-gradient-card p-12 text-center shadow-card">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Plus className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Start by adding tickers</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Build a portfolio, see weighted returns, then run scenario simulations.
            </p>
          </Card>
        )}
      </main>
    </div>
  );
};

interface ScenarioRow { year: number; scenario: Scenario; annual: number; cumulative: number; value: number }

function NumberInput({
  id, value, min, max, integer, onCommit,
}: {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  integer?: boolean;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState<string>(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(String(value));
  }, [value]);
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      value={local}
      onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
      onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        focused.current = false;
        let n = integer ? parseInt(local) : parseFloat(local);
        if (isNaN(n)) { toast.error("Please enter a valid number"); setLocal(String(value)); return; }
        if (n < 0 || (min !== undefined && n < min)) {
          toast.error(`Value must be ≥ ${min ?? 0}`);
          setLocal(String(value));
          return;
        }
        if (max !== undefined && n > max) {
          toast.error(`Value must be ≤ ${max}`);
          setLocal(String(value));
          return;
        }
        onCommit(n);
        setLocal(String(value));
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
    />
  );
}

function WeightInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState<string>(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(String(value));
  }, [value]);
  return (
    <Input
      type="number"
      min={0}
      max={100}
      value={local}
      className="w-24"
      onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
      onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        focused.current = false;
        const n = parseFloat(local);
        if (isNaN(n)) { setLocal(String(value)); return; }
        onCommit(n);
        setLocal(String(value));
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
    />
  );
}

function ScenarioTable({
  title, rows, editable, scenarios, onChange,
}: {
  title: string;
  rows: ScenarioRow[];
  editable: boolean;
  scenarios?: Scenario[];
  onChange?: (idx: number, s: Scenario) => void;
}) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>Scenario</TableHead>
              <TableHead>Annual return</TableHead>
              <TableHead>Cumulative return</TableHead>
              <TableHead>Portfolio value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono">{r.year}</TableCell>
                <TableCell>
                  {editable && scenarios && onChange ? (
                    <Select value={scenarios[i]} onValueChange={(v) => onChange(i, v as Scenario)}>
                      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(SCENARIO_LABELS) as Scenario[]).map((s) => (
                          <SelectItem key={s} value={s}>{SCENARIO_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-muted-foreground">{SCENARIO_LABELS[r.scenario]}</span>
                  )}
                </TableCell>
                <TableCell className={r.annual >= 0 ? "text-bull" : "text-bear"}>
                  {(r.annual * 100).toFixed(2)}%
                </TableCell>
                <TableCell className={r.cumulative >= 0 ? "text-bull" : "text-bear"}>
                  {(r.cumulative * 100).toFixed(2)}%
                </TableCell>
                <TableCell className="font-medium">
                  {r.value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default Index;
