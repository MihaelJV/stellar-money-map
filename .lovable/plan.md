# Ship-Ready Patch: Audit Items 1–5 + README

One focused commit that addresses the five highest-leverage audit findings and the two README mismatches. No new features, no UI restructure — only correctness, robustness, and documentation accuracy.

## 1. Fix `setWeight` off-by-one (src/pages/Index.tsx)
The current handler slices `prev.slice(0, idx - 1)` when editing the last row, dropping a row and breaking the 100% invariant. Replace with correct `slice(0, idx)` / `slice(idx + 1)` bounds so any row (including the last) updates cleanly and the auto-rebalance of the remaining rows preserves Σw = 1.

## 2. Realistic scenario projection (src/pages/Index.tsx + finance.ts)
Replace the current "multiply CAGR by ±factor and compound" approach. New model:

```
μ_scenario = μ_arith_portfolio + k_μ · σ_portfolio
σ_scenario = max(σ_portfolio · k_σ, floor)
```

with per-scenario `(k_μ, k_σ)` shocks (Boom +1.0σ/0.9, Bullish +0.5σ/1.0, Sideways 0/1.0, Bearish −0.75σ/1.3, Recession −1.5σ/1.6). Project value as `V₀ · (1 + μ_scenario)^t`. This keeps bearish scenarios bounded and tied to actual portfolio volatility instead of producing unrealistic compounded losses.

## 3. Decouple risk-free rate from price endDate (src/pages/Index.tsx / stooq.ts)
Today Rf is fetched at the historical `endDate` (could be stale on weekends or after market close). Change the Treasury fetch to use **today's date** (or the most recent available close), independent of the price-history window. Horizon still picks which Treasury tenor to use; only the as-of date changes.

## 4. Optimizer failure surfaces a toast (src/lib/finance.ts + Index.tsx)
- `constrainWeights` no longer silently returns equal weights when the long-only projection has no positive mass. It returns `null`.
- `tangencyWeights` already returns `null` on singular Σ; propagate that.
- In `Index.tsx`, the Optimise click handler checks for `null` and fires a `sonner` toast: *"Optimiser could not find a positive long-only solution under the current cap. Try widening the per-asset cap or removing highly correlated assets."* Weights are left unchanged.

## 5. Surface Sharpe + small-sample warning (src/pages/Index.tsx)
- Add a **Sharpe ratio** tile to the portfolio metrics block (value already computed, just unhidden) with the existing hover-card pattern.
- When the aligned monthly-return window has **< 24 observations**, render a small muted warning under the metrics: *"Estimates based on <N> monthly observations — covariance and β may be unstable."*

## README fixes (README.md)
- Remove `react-hook-form` and `Zod` from the Tech Stack table (not used in the codebase).
- Change the Features bullet *"Scenario analysis bar chart"* to *"Scenario analysis line chart"* to match the actual Recharts implementation.
- No other content changes.

## Verification
- Re-read `Index.tsx` weight-editing block and confirm slice bounds across first, middle, last rows.
- Manually trigger optimiser with a single-asset list + 35% cap (infeasible) and confirm toast fires.
- Confirm Sharpe tile renders alongside existing μ / σ / β tiles.
- Build runs clean (harness handles the typecheck).

## Out of scope
- Efficient-frontier plot, Monte Carlo, Black-Litterman (still in Future Improvements).
- Any visual redesign of metric tiles beyond adding the Sharpe one.
- Edge-function changes.