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
- Protected market-data APIs with HttpOnly sessions and per-IP rate limits
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
        | symbols only + protected same-origin session
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

Every successful book save creates an encrypted IndexedDB snapshot. The newest 30 snapshots are retained. Open `/backup` to create a snapshot, restore/delete retained snapshots, download an encrypted `.dpmx` backup, export/import the recovery-key file, or connect a Chromium File System Access folder for automatic encrypted file backups.

For device-loss protection, choose a folder that is independently synced or backed up and keep the recovery-key file in a separate approved location. The recovery-key file itself is plain base64 key material; anyone holding both that file and a `.dpmx` backup can decrypt it. Treat the key file as a secret. Passphrase wrapping is a future hardening option for shared deployments.

One backup operation now creates one encrypted envelope and reuses that same envelope for the IndexedDB snapshot and optional folder copy, avoiding duplicate encryption work. Folder auto-backup is browser-permission dependent and remains a secondary resilience layer, not an authoritative recordkeeping system.

## Market API access

Production deployments must set:

```text
DPM_API_ACCESS_TOKEN=use-a-long-random-secret
```

When `NODE_ENV=production`, `/api/quotes` and `/api/history` fail closed with 503 if this secret is not configured. Visit `/access`, enter the token once, and the server issues a session-only `HttpOnly`, `SameSite=Strict` cookie derived from the secret with HMAC-SHA256. The raw token is not stored in browser JavaScript storage.

The quote endpoint is limited to 120 authenticated requests/minute per observed client IP and the history endpoint to 30/minute. Failed authentication attempts are also rate-limited. These limits are in-process; horizontally scaled/serverless deployments should add a shared limiter at the platform, gateway or datastore layer for strict global enforcement.

Local development remains usable without a market token when not running in production mode.

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

The `User-Agent: DPMDesk/1.0` header is set only by the server-side provider requests. It is not a browser-side protection mechanism and should not be treated as authentication or anti-abuse control.

## Accounting and validation rules

All writes, imports and loads use the same schema and ledger validation. A sale cannot exceed holdings in execution order and purchases cannot overdraw cash. `sequence` is globally unique across trades, cash movements and corporate actions. A symbol has one asset class and quote currency per client. Targets must total 100%, and holdings without configured targets appear as zero-target breaches.

Current schema version is **3**. Invalid saved data is never silently replaced by demo data. Recovery paths preserve the original raw book where possible.

The quantity floor is shared across validation, FIFO lots and performance calculations through one `POSITION_EPSILON` constant, preventing accepted dust positions from disappearing later.

## Currency compatibility

Modern engines use `Intl.supportedValuesOf("currency")`. Older engines fall back to an explicit supported list containing:

`AED, USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD, SGD, HKD, CNY, SAR, QAR, KWD, BHD, OMR, INR, ZAR, EGP, JOD, TRY, NOK, SEK, DKK, PLN, CZK, HUF, THB, IDR, MYR, PHP, KRW, BRL, MXN, ILS`.

On an older browser, a valid ISO currency outside that fallback list can therefore be rejected until the browser is upgraded or the fallback list is extended.

## Performance methodology

Historical performance uses time-weighted return with a **beginning-of-day external-flow convention**. Deposits and withdrawals are separated from investment return; income and fees remain performance items. If any required portfolio valuation is incomplete, calculation stops with an explicit error. Cash flows are never silently deferred across an unvalued period.

Portfolio holdings use raw historical closes together with recorded corporate actions. Benchmarks use adjusted closes when available. Historical FX can be direct or inverse. Missing data is surfaced rather than converted into a fabricated return.

## Security and operational boundaries

DPM Desk does not transmit orders to GTN or any broker. It is not an authoritative books-and-records platform, custody system or regulatory reporting system without appropriate approval, reconciliation and controls. Use anonymised data and approved devices.

Encrypted backups protect backup contents from casual access but do not replace endpoint security, access control or enterprise key management. The device recovery key must be protected separately.

## Repository controls

CI runs on pushes to `main` and pull requests, with minimal read permissions, concurrency cancellation and a job timeout. Checks include lint, tests, TypeScript, production build and `npm audit`. `.github/CODEOWNERS` identifies the repository owner. GitHub branch/ruleset enforcement is still an account/repository administration setting and should require the `Verify` check before merge when enabled.

## Licensing

This project is proprietary, with all rights reserved; see [LICENSE](LICENSE). Publication of the repository does not grant an open-source license.

## Phase 0 integrity update

All book writes and resets now run under the cross-tab Web Lock `dpm-desk-book-write-v1` and compare an integer `revision` inside the lock. Revision-less books load as revision zero; the first accepted write adds revision one. A stale tab is rejected with a reload instruction and cannot overwrite the current book. Restore paths use the current local revision, not a revision imported from another device. Reload all older open app tabs when upgrading. Safe writes require Web Locks (current browsers on localhost or HTTPS); unsupported environments fail closed instead of falling back to an unsafe check/write sequence. The primary book remains in localStorage in phase 0. The later v4 migration will establish the account/security/change-event schema and transactional IndexedDB book storage.

Recovery-key imports add a retained key rather than replacing the device key. New encrypted envelopes include a key identifier. Old envelopes without an identifier can be opened using either the device key or retained imported keys. Export recovery key exports the active device key; retain imported key files separately for backups that originally used those keys. This is a local keyring, not enterprise key management.

Yahoo historical `close` is split-adjusted. The adapter now reconstructs contemporaneous per-share prices using provider split events before the ledger's recorded corporate actions are applied. To normalize historical windows ending before today, the adapter requests later split events through the present and then trims returned prices to the requested end date. Historical valuations use daily bars, including long periods, so week-labelled observations cannot leak end-of-week prices into earlier ledger events. The secondary provider contract requires contemporaneous, unadjusted per-share `close`; `adjustedClose` is optional for benchmark total-return comparison.

Zero portfolio values are processed, including full loss and final withdrawal, rather than skipping to the last positive value. Missing portfolio valuations fail explicitly. Benchmark/excess return remain unavailable unless every benchmark component has a pre-period price and FX anchor. The beginning-of-day flow convention remains an approximation of flow timing, not intraday valuation.

Dashboard, Operations, Performance, Backup and Market Access are reachable from the shared header navigation. No floating overlay is added.
