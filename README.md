# DPM Desk

A lightweight, local-first discretionary portfolio management workbench for monitoring multiple client portfolios without replacing the broker/execution terminal.

## What v1 includes

- Multi-client book with anonymised client codes
- Portfolio market value, cash, cost basis and P&L
- FIFO cost-basis engine with realised/unrealised P&L
- Live market prices through a server-side Yahoo Finance quote proxy
- Automatic quote refresh every 15 minutes plus manual refresh
- Stocks, ETFs, crypto and configurable asset classes
- Transaction blotter with optional GTN execution reference
- Target allocation vs actual allocation
- Drift and mandate-range breach detection
- Indicative rebalance worksheet
- Local browser persistence
- JSON backup and restore
- Responsive dark institutional-style UI

## Data model

Client records, portfolio transactions and mandate targets are persisted locally in browser storage. The market-data route receives security symbols only and returns quote data. No client names, account numbers, KYC documents or portfolio records are intentionally transmitted to the price source.

Use anonymised client codes and follow the employer's data-handling and information-security policies before using any real portfolio information.

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

For a production check:

```bash
npm run typecheck
npm run build
npm start
```

## Current architecture

```text
Browser
  DPM Desk UI
  Local portfolio state
  FIFO / P&L / allocation engine
        |
        | symbols only
        v
Next.js /api/quotes
        |
        v
Yahoo Finance
```

## Workflow

1. Create an anonymised client mandate.
2. Set initial cash and target allocation.
3. Capture executions after they are completed in GTN.
4. The FIFO engine updates holdings, cash and P&L.
5. Live quotes update current market values.
6. Review target vs actual allocation and mandate breaches.
7. Use the rebalance worksheet as an indicative decision-support view.
8. Back up the local book to JSON regularly.

## Design sources reviewed

The architecture was informed by several public portfolio-management projects. `mtzanidakis/portfolio-tracker` and `Gonzalez8/fintrack` are MIT-licensed and were reviewed for product patterns such as multi-account tracking, quote refresh, FIFO accounting and self-hosted operation. `cgeosoft/portfolio` was reviewed for UX ideas only because no repository license was declared at the time of review. This repository's implementation was written specifically for DPM Desk rather than copied wholesale from those projects.

## Planned next steps

- Bulk/master trade allocation across clients
- CSV import for GTN executions/positions
- Model portfolios and allocation templates
- Historical portfolio snapshots and TWR performance
- Benchmark history and relative performance
- Dividends, coupons and cash movements
- Multi-currency valuation and FX history
- Editable mandate min/max limits
- Encrypted local persistence or SQLite desktop packaging
- Optional ATLAS analytics integration

## Important

DPM Desk is a portfolio operations and monitoring tool. It does not transmit orders to GTN or any broker in v1 and should not be treated as the authoritative books-and-records or execution system without the appropriate internal approval, controls and reconciliation process.
