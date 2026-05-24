## Scope

Ship fixes #1, #3, #5 from the math audit. Leave #2, #4, #6, #7 as documented approximations (no code change, but call them out in the README so reviewers know they're intentional).

## Changes

### 1. Fix #1 — Consistent arithmetic prior in shrinkage blend
**File:** `src/pages/Index.tsx` (~line 240, where `muBlend` is computed)

Currently the asset side uses `arithmeticExpected(cagr, σ)` (= CAGR + σ²/2) but the market side uses raw market CAGR. Make the market side arithmetic too:

```ts
const muMarketArith = arithmeticExpected(marketCagr, marketStdDev);
const muBlend = lambda * muArith + (1 - lambda) * muMarketArith;
```

Both sides now live on the same arithmetic-return scale. No other call sites affected.

### 2. Fix #3 — Proportional renormalisation of optimiser survivors
**File:** `src/pages/Index.tsx` (~lines 275–296 in `applyOptimise`)

Replace the "any zero ⇒ flatten survivors to equal weights" branch with:

- Identify survivors (`w > 1e-6`).
- Keep their relative magnitudes from the tangency solution.
- Renormalise survivors so they sum to 100; zeros stay 0.

```ts
const survivors = tangency.map((w, i) => (w > 1e-6 ? w : 0));
const s = survivors.reduce((a, b) => a + b, 0);
const normalised = s > 0 ? survivors.map(w => (w / s) * 100) : tangency.map(() => 100 / tangency.length);
```

This preserves the Σ⁻¹(μ − rf) signal instead of discarding it. Still satisfies "no zero asset, sums to 100" only when there are no zeros — if the optimiser legitimately wants 0 in an asset, that 0 is respected. (The previous user request to "redistribute zeros equally" is superseded by this stricter, more faithful behaviour; if you want the old equal-split kept, say so and I'll keep both branches.)

### 3. Fix #5 — Final renormalisation in `constrainWeights`
**File:** `src/lib/finance.ts` (end of `constrainWeights`, before `return x`)

Add a single hardening line so floating-point drift or early loop breaks can never leave Σw < 1:

```ts
const total = x.reduce((a, b) => a + b, 0);
if (total > 0) x = x.map(v => v / total);
return x;
```

### 4. README amendment
**File:** `README.md` — extend the **Methodology → A note on robustness** section with a short "Known approximations" subsection documenting #2, #4, #6, #7:

- **#2** σ in `μ ≈ CAGR + σ²/2` uses annualised simple-return σ rather than log-return σ — standard practical approximation.
- **#4** Single-asset displayed σ scales linearly with weight, so for weights ≠ 100% the displayed μ and Sharpe assume full deployment of the entered weight.
- **#6** Scenario shocks are deterministic linear shifts in σ_p, not stochastic paths — labels (Boom/Average/Recession) describe stress bands, not simulated regimes.
- **#7** Doubling time uses Rule-of-70 (continuous compounding); Rule-of-72 (discrete) would differ slightly.

## Out of scope

No UI/visual changes. No changes to hooks, charts, or edge functions. Optimiser solver itself untouched — only its post-processing.

## Confirmation requested

Ship subset = **{#1, #3, #5} + README note covering #2, #4, #6, #7**. Reply "go" to implement, or tell me which item to drop/adjust (e.g. keep the equal-split fallback from the previous turn instead of proportional renormalisation in #3).
