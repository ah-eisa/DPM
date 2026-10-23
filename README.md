# DPM Desk

A lightweight, local-first discretionary portfolio management workbench for monitoring multiple client portfolios without replacing the broker/execution terminal.

## What v1 includes

- Multi-client book with anonymised client codes
- Portfolio market value, cash, cost basis and P&L
- FIFO cost-basis engine with realised/unrealised P&L
- Latest available market prices through a server-side Yahoo Finance quote proxy
- Automatic quote refresh every 15 minutes plus manual refresh
- Stocks, ETFs, crypto and configurable asset classes
- Transaction blotter with optional GTN execution reference
- Target allocation vs actual allocation
- Drift and mandate-range breach detection
- Indicative rebalance worksheet
- Local browser persistence
- JSON backup and restore
- Validated, versioned books with recovery of the previous saved state
- Editable client mandates, base currency, opening cash and allocation limits
- Explicit execution sequence, no short positions or negative cash
- Current FX valuation and separate totals for each base currency
- Responsive dark/light institutional-style UI with a persisted theme toggle

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
npm test
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
3. Capture executions after they are completed in GTN. Enter the quote currency, execution FX rate to the client's base currency, and fees in base currency. For executions on the same day, enter their actual unique execution sequence; an omitted sequence appends after existing executions. Legacy backups preserve their original array order when assigning sequence numbers.
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
- Historical FX rates and portfolio valuation history
- Encrypted local persistence or SQLite desktop packaging
- Optional ATLAS analytics integration

## Important

DPM Desk is a portfolio operations and monitoring tool. It does not transmit orders to GTN or any broker in v1 and should not be treated as the authoritative books-and-records or execution system without the appropriate internal approval, controls and reconciliation process.

## Accounting and validation rules

All writes, imports and loads use the same schema and ledger validation. A sale cannot exceed holdings at that point in execution order, and purchases cannot overdraw cash. Deleting a purchase or reducing opening cash is rejected if it invalidates later executions. A symbol has one asset class and one quote currency per client; inconsistent classifications are rejected rather than silently changing the holding. Opening cash is editable, but base currency is fixed once transactions exist. Target allocations must total 100%, and limits must satisfy minimum ≤ target ≤ maximum. Holdings without a configured target appear with a zero target and zero allowed maximum.

Schema version 2 is stored inside each backup. The original browser key is retained to migrate existing books in place. Invalid saved data is never silently replaced with demo data: the recovery screen offers download of the original raw book, validated restore and recovery of the previous save. Reset and Restore retain the previous saved book locally. Download a JSON backup before replacing data. A previous-save slot is not a durable backup and may be replaced by the next successful save. Closing storage access, storage quota failures and invalid imports leave the in-memory book unchanged. Backups and localStorage are **unencrypted**; use synthetic/anonymised data and an approved device. There is no multi-user access control, audit trail or broker reconciliation.

Market valuation uses current quote-currency/base-currency FX quotes; execution FX remains part of historical cost. Never add portfolios in different base currencies: top-level value/P&L totals are filtered to the selected client's base currency. Unavailable prices, currency mismatches or missing FX explicitly use an **indicative cost valuation**; unrealised and total P&L are shown as unavailable. Stale market quotes are identified by timestamp and label. Rebalance status requests price review while valuations are incomplete. These are indicative calculations, not executable orders. Bonds/sukuk with accrued interest or face-value price conventions require a dedicated model before use; this engine assumes quantity × unit price.

The Yahoo chart endpoint is unofficial. Requests use a 5-second provider timeout, batches of five, coalesced in-flight requests, a 60-second cache and an explicitly stale fallback for up to 24 hours since fetch. Quote time is the provider's market timestamp, not the time fetched. Daily change uses a one-day chart baseline. GBP pence and South African cents are normalized to major currency units. The route validates symbols and rejects requests over 50 unique symbols. A per-process global guard allows 120 requests/minute; multiple server processes require shared cache/rate controls. No second provider or market-data redistribution entitlement is implied. Weekend/closed-market quotes older than 24 hours are conservatively labelled stale. English with light/dark themes is supported. The header toggle saves the selected theme locally; first visit follows the operating-system preference. Arabic is not implemented.

## Verification

`npm ci`, `npm test`, `npm run typecheck`, `npm run build`, and `npm audit` are the release checks. Tests cover FIFO, fees, partial/full sales, overselling, backdated ordering, invalidating deletes, FX, missing/stale prices, unconfigured asset classes, schema migration, invalid restores, storage preservation, provider parsing, caching and stale fallbacks. CI runs the same core checks. Commit `package-lock.json` for reproducible installations.

## Repository metadata and licensing

Repository description: “Local-first multi-client portfolio monitoring with FIFO accounting, FX valuation and mandate drift checks.” Topics: `portfolio-management`, `nextjs`, `typescript`, `fifo`, `local-first`. This project is proprietary, with all rights reserved; see [LICENSE](LICENSE). Publication of this repository does not grant an open-source license. References to third-party projects do not license this implementation.
