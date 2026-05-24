# Portfolio Lab

An interactive, browser-based laboratory for **modern portfolio theory**, **mean–variance optimisation**, and **scenario analysis** on real historical price data. Type in a handful of tickers, pick an investment horizon, and the app pulls historical prices, estimates risk and return, builds a covariance matrix, computes a tangency (maximum-Sharpe) portfolio under realistic constraints, and lets you stress-test the resulting allocation against macro scenarios.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-38B2AC?logo=tailwindcss&logoColor=white)

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Methodology](#methodology)
4. [Tech Stack](#tech-stack)
5. [Installation](#installation)
6. [Project Structure](#project-structure)
7. [Usage Guide](#usage-guide)
8. [Screenshots](#screenshots)
9. [Future Improvements](#future-improvements)
10. [Contributing](#contributing)
11. [License](#license)

---

## Overview

**Portfolio Lab** is an educational quantitative-finance tool that walks the user end-to-end through the building blocks of a multi-asset portfolio:

- **Data ingestion** – historical daily closes are fetched on demand from Yahoo Finance via a thin Supabase edge function (`stooq-proxy`) that handles browser CORS.
- **Return and risk estimation** – per-asset CAGR, annualised volatility, monthly returns, correlation matrix, covariance matrix, and CAPM-style beta versus the S&P 500.
- **Portfolio construction** – user-defined weights with a one-click **tangency (max-Sharpe) optimiser** that uses volatility-adjusted, shrinkage-blended expected returns and enforces realistic allocation constraints (long-only, per-asset cap).
- **Scenario analysis** – the resulting portfolio is projected forward under five qualitative macro regimes (Boom, Bullish, Sideways, Bearish, Recession) so the user can see how the same allocation behaves across different environments.

The target audience is finance students, self-directed investors, and developers exploring quant tooling. It is **not** an investment-advice product; results are intended to build intuition for how the inputs to modern portfolio theory drive its outputs.

---

## Features

### Data & estimation
- Per-asset historical price fetch (configurable lookback) via a Supabase Edge Function proxy.
- **CAGR** and **annualised standard deviation** computed from monthly returns.
- **Correlation matrix** across all entered assets, aligned on common months.
- **Covariance matrix** derived as `ρᵢⱼ · σᵢ · σⱼ`.
- **Beta vs market (S&P 500)** for each asset and a weighted **portfolio beta**.
- **Risk-free rate** auto-matched to the chosen investment horizon (Treasury proxy).

### Portfolio construction
- User-editable weights with live validation that they sum to 100%.
- **Tangency portfolio (maximum Sharpe ratio)** solver: closed-form `w ∝ Σ⁻¹(μ − R_f·1)` with full Gauss-Jordan matrix inversion.
- **Allocation constraints** enforced via iterative water-filling:
  - Long-only (weights bounded to `[0%, 100%]`).
  - Configurable **per-asset cap** (default 35%).
- **Shrinkage prior** that blends each asset’s historical arithmetic expected return with the market’s CAGR to stabilise estimates (configurable mix, default 70 / 30).
- **Weighted portfolio expected return**, **portfolio volatility**, and **Sharpe ratio** displayed live.

### Visualisation
- Allocation **pie chart** of current portfolio weights.
- **Correlation table**, **standard-deviation table**, **covariance table**, **beta table**.
- **Scenario analysis** line chart projecting portfolio outcomes under five macro regimes.
- Responsive, theme-aware UI built with shadcn/ui components.

### UX
- Adjustable **investment horizon** (years) that drives both the data lookback and the risk-free benchmark choice.
- Hover cards with formulas and plain-English explanations on every non-trivial metric (Sharpe, Beta, portfolio σ, optimiser).
- **Ticker metadata tooltip** — an (i) icon next to each ticker reveals the full company name, ISIN, exchange, currency, market cap, and 3-month average daily volume, fetched on demand from a `quote-info` edge function (Yahoo Finance `quoteSummary` with cookie+crumb auth, ISIN resolved via Markets Insider with an OpenFIGI fallback).
- Toast notifications for fetch errors and optimisation outcomes.

> Functionality not currently in the repo (Monte Carlo simulation, full efficient-frontier curve plot, Black-Litterman, backtesting) is listed under [Future Improvements](#future-improvements).

---

## Methodology

### Expected returns

For optimisation, raw historical CAGR is a biased estimate of *arithmetic* mean return because it implicitly compounds. The app uses the standard volatility correction:

```
μ_arith ≈ CAGR + σ² / 2
```

`μ_arith` is then **shrunk toward the market prior** (S&P 500 CAGR) to reduce estimation error, which mean–variance optimisation is famously sensitive to:

```
μ_blend = λ · μ_arith + (1 − λ) · μ_market         (default λ = 0.7)
```

CAGR (geometric return) is still surfaced in the UI for compounding/scenario projections — the two are kept visually distinct.

### Covariance matrix

Built from aligned monthly returns:

```
Σᵢⱼ = ρᵢⱼ · σᵢ · σⱼ
```

where `σᵢ` is annualised standard deviation (`sample_std · √12`) and `ρᵢⱼ` is the Pearson correlation of overlapping monthly return series.

### Portfolio risk and Sharpe ratio

```
σ_p = √(wᵀ Σ w)
Sharpe = (E[R_p] − R_f) / σ_p
```

### Tangency portfolio

The maximum-Sharpe portfolio in closed form:

```
w ∝ Σ⁻¹ (μ − R_f · 1)        then normalised so Σwᵢ = 1
```

Raw weights are then projected onto the constraint set (`wᵢ ≥ 0`, `wᵢ ≤ cap`, `Σwᵢ = 1`) by an iterative water-filling step.

### Beta

```
βᵢ = Cov(Rᵢ, R_mkt) / Var(R_mkt)         portfolio β = Σ wᵢ · βᵢ
```

### A note on robustness

Mean–variance optimisation is notoriously sensitive to its inputs — tiny changes in expected returns can produce wildly different "optimal" allocations. The volatility adjustment, shrinkage toward a market prior, long-only constraint, and per-asset cap are all included specifically to **temper that sensitivity** and produce allocations a human investor would recognise as reasonable.

Even so, the output should be treated as **exploratory scenarios, not predictions**. Institutional portfolio construction typically layers in factor models, Black-Litterman views, robust/resampled covariance estimators, and transaction-cost-aware solvers — none of which are claimed here.

### Known approximations

The following simplifications are intentional. They keep the math transparent for an educational tool but would be replaced in a production-grade implementation:

- **Volatility correction uses simple-return σ.** The identity `μ_arith ≈ CAGR + σ²/2` is exact when σ is the standard deviation of log-returns. Portfolio Lab uses annualised simple-return σ, which is the standard practical approximation.
- **Single-asset displayed risk scales linearly with weight.** For a portfolio containing one asset with weight w, displayed σ_p = (w/100)·σ. The displayed μ and Sharpe are therefore correct only when w = 100%; partial weights implicitly assume the remainder is uninvested rather than held as cash earning R_f.
- **Scenarios are deterministic stress bands, not stochastic paths.** Each scenario applies a fixed multiple of σ_p as a shift to μ_p (`μ_scenario = μ_p + k·σ_p`). The Boom / Bullish / Average / Bearish / Recession labels describe directional stress magnitudes, not simulated macro regimes.
- **Doubling time uses the Rule of 70.** This is the continuous-compounding approximation (`t ≈ 70 / r%`). The Rule of 72 (discrete compounding) would give marginally different results in the 6–10% range.



---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite 5 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3, shadcn/ui (Radix primitives) |
| Charts | Recharts |

| Async / data | @tanstack/react-query |
| Routing | react-router-dom (HashRouter) |
| Notifications | sonner, custom toast |
| Backend | Lovable Cloud (Supabase) — Edge Function `stooq-proxy` for Yahoo Finance pass-through |
| Math | Hand-rolled in `src/lib/finance.ts` (Gauss-Jordan inversion, water-filling, return/risk stats) |
| Testing | Vitest + Testing Library + jsdom |
| Deployment | Lovable / static hosting + Supabase Edge Functions |

---

## Installation

### Prerequisites

- Node.js ≥ 18 and `npm` (or `bun` / `pnpm`)
- A Supabase project (already provisioned automatically when running on Lovable Cloud)

### Setup

```bash
git clone <your-fork-url> portfolio-lab
cd portfolio-lab
npm install
```

### Environment variables

The Supabase client reads three variables from `.env` (auto-provisioned on Lovable Cloud, set manually if self-hosting):

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
VITE_SUPABASE_PROJECT_ID=<project-ref>
```

### Scripts

```bash
npm run dev          # start Vite dev server
npm run build        # production build
npm run preview      # preview production build locally
npm run lint         # ESLint
npm run test         # run Vitest once
npm run test:watch   # watch mode
```

The `stooq-proxy` Edge Function lives in `supabase/functions/stooq-proxy/` and is deployed automatically by Lovable Cloud; if self-hosting, deploy it with the Supabase CLI.

---

## Project Structure

```
.
├── src/
│   ├── pages/
│   │   ├── Index.tsx          # Main portfolio dashboard (assets, metrics, charts, optimiser)
│   │   └── NotFound.tsx
│   ├── lib/
│   │   ├── finance.ts         # CAGR, σ, correlation, covariance, beta, tangency solver, constraints
│   │   ├── stooq.ts           # Edge-function client + ticker normalisation
│   │   ├── quoteInfo.ts       # Client for the quote-info edge function (ticker metadata)
│   │   └── utils.ts
│   ├── components/ui/         # shadcn/ui primitives
│   ├── integrations/supabase/ # Auto-generated client + types (do not edit)
│   ├── hooks/
│   ├── test/                  # Vitest setup + example tests
│   ├── App.tsx                # Routes + global providers
│   ├── main.tsx
│   └── index.css              # Design tokens (HSL)
├── supabase/
│   ├── functions/
│   │   ├── stooq-proxy/       # Yahoo Finance price-history CORS proxy (Deno)
│   │   └── quote-info/        # Yahoo quoteSummary + ISIN lookup (Markets Insider / OpenFIGI)
│   └── config.toml
├── tailwind.config.ts
├── vite.config.ts
└── package.json
```

---

## Usage Guide

1. **Add assets.** Type tickers in the input row (e.g. `AAPL`, `SPY`, `VOD.L`, `BTC-USD`). International symbols use Yahoo Finance suffix conventions. Each asset gets a row with editable weight.
2. **Pick a horizon.** The horizon (years) controls how far back data is fetched **and** which Treasury proxy is used as the risk-free rate.
3. **Inspect the metrics.** Each asset row shows CAGR, arithmetic μ, blended μ, and annualised σ. Below the table:
   - **Correlation matrix** — pairwise ρ on monthly returns.
   - **Standard-deviation table** — annualised σ per asset.
   - **Covariance matrix** — `ρᵢⱼ · σᵢ · σⱼ`.
   - **Beta table** — each asset and the weighted portfolio β vs S&P 500.
4. **Optimise (optional).** Click **Optimise** to apply tangency-portfolio weights. Open **Advanced settings** to adjust the per-asset cap (default 35%) and the shrinkage weight (default 70% historical / 30% market). Allocations are always long-only and bounded to `[0%, 100%]`.
5. **Read the portfolio block.** The pie chart shows weights; below it you’ll find weighted expected return, portfolio σ, Sharpe ratio, and beta — each with a hover-card explanation.
6. **Run scenarios.** The scenario chart projects portfolio outcomes under Boom / Bullish / Sideways / Bearish / Recession multipliers applied to expected returns.

Every metric with a circled **(i)** has a hover-card describing the formula and its practical interpretation.

---

## Screenshots

No screenshots are currently checked into the repository. Recommended addition: place PNGs in `docs/screenshots/` and reference them here, e.g.:

```markdown
![Dashboard](docs/screenshots/dashboard.png)
![Optimiser](docs/screenshots/optimiser.png)
![Scenarios](docs/screenshots/scenarios.png)
```

---

## Future Improvements

Roadmap items that would meaningfully extend the project:

- **Efficient-frontier curve** — sweep target returns and plot the (σ, μ) frontier alongside the tangency point.
- **Monte Carlo simulation** — bootstrap or parametric forward paths for the optimised portfolio.
- **Black-Litterman** — combine the market-implied equilibrium with user views.
- **Bayesian / James-Stein return estimation** as alternative shrinkage targets.
- **Resampled efficient frontier** (Michaud) to reduce estimation error.
- **Robust covariance** (Ledoit-Wolf shrinkage, EWMA, factor-model Σ).
- **Backtesting engine** with rebalancing schedules and turnover/transaction costs.
- **Factor exposure analysis** (Fama-French, momentum, quality).
- **Live market data** beyond end-of-day closes.
- **Saved portfolios** and per-user persistence.

---

## Contributing

Contributions are welcome. The codebase is small and TypeScript-first; the math lives almost entirely in `src/lib/finance.ts` and is easy to extend.

1. Fork and create a feature branch: `git checkout -b feature/my-change`.
2. Install dependencies and run the dev server: `npm install && npm run dev`.
3. Add or update tests in `src/test/` and run them with `npm test`.
4. Keep PRs focused — one feature or fix per PR.
5. Match the existing code style (ESLint + TypeScript strict).
6. For changes to portfolio math, please include a short note in the PR description justifying the formula and citing a source where relevant.

Bug reports and feature requests should go through GitHub Issues with a minimal reproduction.

---

## License

Released under the [MIT License](LICENSE).

> **Disclaimer.** Portfolio Lab is an educational tool. Nothing in this repository constitutes investment advice, a solicitation, or a recommendation to buy or sell any security. Historical performance is not indicative of future results.
