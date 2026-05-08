import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, X, TrendingUp, Activity, Sparkles } from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { fetchHistory, type PricePoint } from "@/lib/stooq";
import {
  cagr, monthlyReturns, correlationMatrix,
  SCENARIO_MULTIPLIERS, SCENARIO_LABELS, type Scenario,
} from "@/lib/finance";

interface Asset {
  ticker: string;
  weight: number;       // 0-100
  return: number;       // CAGR
  monthly: Map<string, number>;
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

const Index = () => {
  const [startDate, setStartDate] = useState(yearsAgoISO(10));
  const [endDate, setEndDate] = useState(todayISO());
  const [tickerInput, setTickerInput] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  const [scenarioYears, setScenarioYears] = useState(5);
  const [initialValue, setInitialValue] = useState(10000);
  const [colorfulScenarios, setColorfulScenarios] = useState<Scenario[]>([]);

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

  const portfolioReturn = useMemo(
    () => assets.reduce((s, a) => s + a.return * (a.weight / 100), 0),
    [assets],
  );

  const correlations = useMemo(() => {
    if (assets.length < 2) return null;
    const series: Record<string, Map<string, number>> = {};
    for (const a of assets) series[a.ticker] = a.monthly;
    return correlationMatrix(series);
  }, [assets]);

  const yearsToDouble = portfolioReturn > 0 ? 70 / (portfolioReturn * 100) : Infinity;

  const addTicker = useCallback(async () => {
    const raw = tickerInput.trim().toUpperCase();
    if (!raw) return;
    if (assets.some((a) => a.ticker === raw)) {
      toast.error(`${raw} already added`);
      return;
    }
    setLoading(true);
    try {
      const points: PricePoint[] = await fetchHistory(raw, new Date(startDate), new Date(endDate));
      const r = cagr(points);
      const monthly = monthlyReturns(points);
      setAssets((prev) => {
        const next = [...prev, { ticker: raw, weight: 0, return: r, monthly }];
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

  // Build scenario tables
  const buildScenarioRows = (scenarios: Scenario[]) => {
    const rows = [];
    let value = initialValue;
    let cumulative = 1;
    for (let y = 0; y < scenarios.length; y++) {
      const s = scenarios[y];
      const annual = portfolioReturn * SCENARIO_MULTIPLIERS[s];
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
  const baselineRows = useMemo(() => buildScenarioRows(baselineScenarios), [baselineScenarios, portfolioReturn, initialValue]);
  const colorfulRows = useMemo(() => buildScenarioRows(colorfulScenarios), [colorfulScenarios, portfolioReturn, initialValue]);

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
                    <span className="w-20 font-mono text-sm font-semibold">{a.ticker}</span>
                    <WeightInput
                      value={a.weight}
                      onCommit={(v) => setWeight(a.ticker, v)}
                    />

                    <span className="text-sm text-muted-foreground">%</span>
                    <span className={`ml-auto text-sm font-medium ${a.return >= 0 ? "text-bull" : "text-bear"}`}>
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
                  <span className="text-sm text-muted-foreground">Expected return (weighted)</span>
                  <span className={`font-semibold ${portfolioReturn >= 0 ? "text-bull" : "text-bear"}`}>
                    {pct(portfolioReturn)}
                  </span>
                </div>
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
            </Card>

            <Card className="bg-gradient-card p-6 shadow-card lg:col-span-2">
              <h2 className="mb-4 text-lg font-semibold">Asset returns</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Avg annual return (CAGR)</TableHead>
                    <TableHead>Period</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((a) => (
                    <TableRow key={a.ticker}>
                      <TableCell className="font-mono font-semibold">{a.ticker}</TableCell>
                      <TableCell>{a.weight}%</TableCell>
                      <TableCell className={a.return >= 0 ? "text-bull" : "text-bear"}>{pct(a.return)}</TableCell>
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
                <Input
                  id="years"
                  type="number"
                  min={1}
                  max={50}
                  value={scenarioYears}
                  onChange={(e) => setScenarioYears(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="iv">Initial value (USD)</Label>
                <Input
                  id="iv"
                  type="number"
                  min={1}
                  value={initialValue}
                  onChange={(e) => setInitialValue(Math.max(1, parseFloat(e.target.value) || 1))}
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
