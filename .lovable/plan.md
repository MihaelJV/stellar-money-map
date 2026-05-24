## Cleanup patch (≈15 lines)

Three small, surgical changes. No UI or behaviour beyond what's listed.

### 1. `src/lib/finance.ts` — infeasible-cap returns null
Replace the early-return in `constrainWeights`:
```ts
if (cap * n < 1 - 1e-9) return Array(n).fill(1 / n);
```
with:
```ts
if (cap * n < 1 - 1e-9) return null;
```
Contract is now consistent: any infeasibility → `null`, surfaced by the existing Optimise toast.

### 2. `src/lib/finance.ts` — drop dead code
- Remove the `kSigma` field from `SCENARIO_SHOCKS` entries and from the type signature (it's never read; no consumers).
- Remove the `SCENARIO_MULTIPLIERS` export entirely (deprecated, unused).

Quick `rg "SCENARIO_MULTIPLIERS|kSigma"` confirms no other call sites before deleting.

### 3. `src/pages/Index.tsx` — default baseline scenario
Change the initial scenario state from `"bullish"` to `"sideways"` so the default projection uses `kMu = 0` (no upward shock baked in).

### Out of scope
- Single-asset Sharpe denominator (Σw < 1) issue — preserve current behaviour.
- `addTicker` weight reset — preserve current behaviour.
- Any README, edge-function, or visual changes.

### Verification
- `rg "SCENARIO_MULTIPLIERS|kSigma"` returns no hits after edit.
- Manual: set per-asset cap below `1/n` → Optimise shows the existing failure toast (no silent equal-weight fallback).
- Manual: fresh load → scenario selector defaults to **Sideways**.
