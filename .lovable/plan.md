## Scope

Add a risk-free reference line to the scenario comparison line chart, and expose where the Rf number comes from (ticker, name, latest yield, observation date) so reviewers can audit it.

## Changes — all in `src/pages/Index.tsx`

### 1. Capture the Rf observation date

In the `useEffect` that fetches Rf (~line 188), store the timestamp of the last close alongside the rate:

```ts
const [riskFreeRate, setRiskFreeRate] = useState<number | null>(null);
const [rfAsOf, setRfAsOf] = useState<Date | null>(null);
// in the effect:
setRiskFreeRate(points[points.length - 1].close / 100);
setRfAsOf(points[points.length - 1].date);
```

### 2. Compound Rf into the chart series

Add a `riskFree` field to `compareData` (~line 419) so it appears as a third line. Use the same compounding convention the baseline uses — `initialValue · (1 + Rf)^t`:

```ts
data.push({
  year: i + 1,
  baseline: ...,
  colorful: ...,
  riskFree: riskFreeRate !== null ? initialValue * Math.pow(1 + riskFreeRate, i + 1) : null,
});
```

Year-0 point also gets `riskFree: initialValue`.

### 3. Draw the line

In the `LineChart` block (~line 1023), add a third `<Line>` rendered as a dashed muted reference, beneath the two existing series in the legend:

```tsx
<Line
  type="monotone"
  dataKey="riskFree"
  stroke="hsl(var(--muted-foreground))"
  strokeWidth={1.5}
  strokeDasharray="4 4"
  dot={false}
  name={`Risk-free (${rfTicker})`}
/>
```

`dot={false}` keeps the reference visually quieter than the two scenario paths.

### 4. Provenance caption under the chart

Directly below the `ResponsiveContainer` (still inside the scenarios `Card`), add a small one-line caption — same pattern as other muted sub-labels in the app:

```tsx
<p className="mt-2 text-xs text-muted-foreground">
  Risk-free reference: <span className="font-medium text-foreground">{rfLabel}</span>
  {" · "}latest yield {riskFreeRate !== null ? pct(riskFreeRate) : "—"}
  {rfAsOf && ` · as of ${rfAsOf.toISOString().slice(0, 10)}`}
  {" · "}source Yahoo Finance via stooq-proxy
</p>
```

`rfLabel` already encodes both the human name and the ticker (e.g. "10-year Treasury Note (^TNX)"). `pct()` and `money()` helpers already exist in the file.

### 5. Tooltip / legend consistency

Recharts' default `Tooltip` will pick up the new series automatically; no formatter change needed since the existing `formatter={(v) => money(v)}` handles all numeric series.

## Explicitly out of scope

- No change to Rf source, ticker selection logic, or scenario math.
- No change to the optimiser, Sharpe calc, or any other consumer of `riskFreeRate`.
- No README edit (the README already lists the Treasury proxy methodology).

## Confirmation

Reply "go" to ship this, or tell me to drop the caption / change line style / put the caption inside a hover-card instead.
