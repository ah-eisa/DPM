# DPM Desk

A lightweight, local-first discretionary portfolio management workbench for monitoring multiple client portfolios without replacing the broker/execution terminal.

## Current scope

- Multi-client anonymised mandates
- FIFO realised/unrealised P&L
- Cash ledger, dividends, coupons, fees and taxes
- Corporate actions including splits and stock dividends
- GTN-style CSV import and bulk allocation
- Current FX-aware valuation with explicit live / stale / cost states
- Target allocation, drift and mandate-range checks
- Historical TWR with beginning-of-day external-flow convention
- Benchmark comparison, excess return and printable reports
- Responsive light/dark UI
- Versioned validation and recovery-safe storage
- Encrypted resilience backups with 30-snapshot retention
- Market-data provider abstraction with optional secondary provider adapter
- CI checks for lint, tests, TypeScript, production build and dependency audit

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Release checks:

```bash
npm run lint
npm test
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

## Architecture

```text
Browser
  DPM Desk UI
  localStorage primary book
  encrypted IndexedDB snapshots (30 retained)
  optional encrypted folder backup (.dpmx)
  FIFO / P&L / allocation / TWR engines
        |
        | symbols only
        v
Next.js market-data routes
        |
        v
Cascading MarketDataProvider
  Yahoo Finance primary
  optional HTTP secondary adapter
```

Client records, portfolio transactions and mandate targets remain in browser storage. Market-data routes receive symbols only. Do not store client names, account numbers, KYC records or other identifying data unless your organisation has explicitly approved that workflow.

## Backup and recovery

Every successful book save creates an encrypted IndexedDB snapshot. The newest 30 snapshots are retained. Open `/backup` to:

- create a snapshot immediately;
- restore or delete retained snapshots;
- download an encrypted `.dpmx` backup;
- export/import the recovery-key file;
- connect a Chromium File System Access folder for automatic encrypted file backups.

For device-loss protection, choose a folder that is independently synced or backed up (for example an approved OneDrive/Google Drive/Dropbox-synced folder) and keep the recovery-key file in a separate approved location. The recovery key is required to decrypt `.dpmx` files created by a lost browser profile. Folder auto-backup is browser-permission dependent and is therefore a secondary resilience layer, not an authoritative recordkeeping system.

The primary book still has a previous-save recovery slot, but that slot and IndexedDB are on the same browser profile and must not be treated as off-device backup.

## Market data providers

Market-data routes call a `MarketDataProvider` abstraction. Yahoo Finance is the default primary source. A compatible secondary HTTP adapter can be configured server-side with:

```text
DPM_SECONDARY_MARKET_DATA_URL=https://your-approved-adapter.example
DPM_SECONDARY_MARKET_DATA_TOKEN=optional-secret-token
```

The adapter contract is:

- `GET /quote?symbol=AAPL` → a JSON quote containing at least `price`, `currency`, and `asOf`;
- `GET /history?symbol=AAPL&start=YYYY-MM-DD&end=YYYY-MM-DD&interval=1d|1wk` → `{ symbol, currency, points: [{ date, close, adjustedClose? }] }` or the equivalent series object itself.

The cascade tries the secondary provider after a primary failure and also prefers a live secondary quote over an explicitly stale primary cached quote. Portfolio history uses raw closes because recorded corporate actions alter holdings; benchmark history uses adjusted close when available. Provider licensing and redistribution rights remain the deployer's responsibility.

## Accounting and validation rules

All writes, imports and loads use the same schema and ledger validation. A sale cannot exceed holdings in execution order and purchases cannot overdraw cash. `sequence` is globally unique across trades, cash movements and corporate actions. A symbol has one asset class and quote currency per client. Targets must total 100%, and holdings without configured targets appear as zero-target breaches.

Current schema version is **3**. Invalid saved data is never silently replaced by demo data. Recovery paths preserve the original raw book where possible.

The quantity floor is shared across validation, FIFO lots and performance calculations through one `POSITION_EPSILON` constant, preventing accepted dust positions from disappearing later.

## Currency compatibility

Modern engines use `Intl.supportedValuesOf("currency")`. Older engines fall back to an explicit supported list containing:

`AED, USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD, SGD, HKD, CNY, SAR, QAR, KWD, BHD, OMR, INR, ZAR, EGP, JOD, TRY, NOK, SEK, DKK, PLN, CZK, HUF, THB, IDR, MYR, PHP, KRW, BRL, MXN, ILS`.

On an older browser, a valid ISO currency outside that fallback list can therefore be rejected until the browser is upgraded or the fallback list is extended.

## Performance methodology

Historical performance uses time-weighted return with a **beginning-of-day external-flow convention**. Deposits and withdrawals are separated from investment return; income and fees remain performance items. If valuation is incomplete on a flow date, the flow remains pending until the next complete valuation rather than disappearing. A period is rejected if its final external flow cannot be subsequently valued.

Portfolio holdings use raw historical closes together with recorded corporate actions. Benchmarks use adjusted closes when available. Historical FX can be direct or inverse. Missing data is surfaced rather than converted into a fabricated return.

## Security and operational boundaries

DPM Desk does not transmit orders to GTN or any broker. It is not an authoritative books-and-records platform, custody system or regulatory reporting system without appropriate approval, reconciliation and controls. Use anonymised data and approved devices.

Encrypted backups protect backup contents from casual access but do not replace endpoint security, access control or enterprise key management. The device recovery key must be protected separately.

## Repository controls

CI runs on pushes to `main` and pull requests, with minimal read permissions, concurrency cancellation and a job timeout. Checks include lint, tests, TypeScript, production build and `npm audit`. `.github/CODEOWNERS` identifies the repository owner. GitHub branch/ruleset enforcement is still an account/repository administration setting and should require the `Verify` check before merge when enabled.

## Licensing

This project is proprietary, with all rights reserved; see [LICENSE](LICENSE). Publication of the repository does not grant an open-source license.
