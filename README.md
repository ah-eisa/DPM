# DPM Desk

A lightweight, local-first discretionary portfolio management workbench for monitoring multiple client portfolios without replacing the broker/execution terminal.

## Current scope

- Multi-client anonymised mandates
- Explicit accounts, Security Master and transactional schema-v4 migration
- Custodian CSV preview and historical quantity/cash reconciliation
- Expiring manual prices, lineage, households, saved account views and reports
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
  transactional IndexedDB v4 book + local change history
  preserved legacy localStorage original (migration only)
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

All writes, imports and loads use the same schema and ledger validation. A sale cannot exceed holdings in execution order and purchases cannot overdraw cash. `sequence` is globally unique across trades, cash movements and corporate actions. Ledger cash and holdings are validated per account. Instruments have stable security IDs and exchange/currency-qualified provider aliases; ticker text alone is insufficient when ambiguous. Targets must total 100%, and holdings without configured targets appear as zero-target breaches.

Current schema version is **4**. Invalid saved data is never silently replaced by demo data. Recovery paths preserve the original raw book where possible.

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

Book writes, revision checks and before/after change events now commit together in one IndexedDB readwrite transaction. This replaces the interim phase-0 Web Lock/localStorage implementation. The first load validates and migrates the old book, retaining its original raw JSON in the same transaction; localStorage is not overwritten. A stale writer fails with a reload instruction. Failed transactions do not partially update either book or history. Reload all older open tabs before upgrading: older application code still targets the legacy store. A browser-local history has an unverified actor label and is not immutable or a regulatory audit trail.

Recovery-key imports add a retained key rather than replacing the device key. New encrypted envelopes include a key identifier. Old envelopes without an identifier can be opened using either the device key or retained imported keys. Export recovery key exports the active device key; retain imported key files separately for backups that originally used those keys. This is a local keyring, not enterprise key management.

Yahoo historical `close` is split-adjusted. The adapter now reconstructs contemporaneous per-share prices using provider split events before the ledger's recorded corporate actions are applied. To normalize historical windows ending before today, the adapter requests later split events through the present and then trims returned prices to the requested end date. Historical valuations use daily bars, including long periods, so week-labelled observations cannot leak end-of-week prices into earlier ledger events. The secondary provider contract requires contemporaneous, unadjusted per-share `close`; `adjustedClose` is optional for benchmark total-return comparison.

Zero portfolio values are processed, including full loss and final withdrawal, rather than skipping to the last positive value. Missing portfolio valuations fail explicitly. Benchmark/excess return remain unavailable unless every benchmark component has a pre-period price and FX anchor. The beginning-of-day flow convention remains an approximation of flow timing, not intraday valuation.

Dashboard, Operations, Performance, Backup and Market Access are reachable from the shared header navigation. No floating overlay is added.


## Book Controls (`/controls`)

- **Master data:** each old client gets one deterministic migrated account, preserving opening cash, sequence and FIFO economics. Additional accounts start at zero and must be funded explicitly. Account base currency must match its client. Select the account/security when entering a trade, cash entry or corporate action. Legacy GTN import and master allocations target the primary account of each client; these interfaces do not infer custodian account routing.
- **Security Master:** internal IDs stay stable when a pricing alias is corrected. Migrated exchange mappings are explicitly unresolved. ISIN has a checksum gate; screening remains unknown unless a dated source exists. `priceMultiplier` is 1 for per-unit prices, or 0.01 for percentage-of-par per face-value unit. Accrued interest is separate; clean prices do not imply dirty bond value. Instruments sharing a provider alias cannot share an automatic quote; provide a security-specific observation or correct the alias.
- **Reconciliation:** the template starts with `security_id,symbol,currency,quantity`; optional columns are `price,reported_value,unit_multiplier,price_as_of,price_convention`. CSV has preview, SHA-256 provenance and duplicate-source protection. Observations keep effective/received dates, scope and trade-date basis. Quantity compares separately from price. Partial/unmapped sources never establish missing-at-custodian positions. Foreign cash is retained as not comparable to the book's base-currency cash. Price/value comparison requires matching currency, explicit units, same-date clean prices and a compatible manual internal price; dirty/accrued values remain not comparable. Reviews record a reason without editing the ledger. Revised source files can supersede earlier observations.
- **Prices:** active manual overrides outrank market quotes until expiry; latest effective time wins, then recorded time and ID. Source, reason, effective time, recorded time and rejected alternatives remain visible. Zero is a valid price. Historical TWR remains based on provider history; a current override does not rewrite history.
- **Groups/reports:** households and saved views contain unique account memberships, not legal ownership or fractional look-through. Reports keep currencies separate. As-of account reports use the historical ledger and valid manual prices; missing prices show indicative FIFO cost, never an invented market value. CSV is formula-safe. Print/Save PDF uses the browser. Fee support is an explicitly labelled Actual/365 single-value estimate; it creates no invoice, charge or ledger entry. Performance fees, high-water marks and production billing remain outside this release.
- **History/recovery:** every accepted change stores full before/after states atomically with the book. History is a rolling local window of at most 100 entries and 20 MiB; the byte budget can retain fewer than 100 large revisions. Oldest entries are pruned inside the same save transaction, before the new book/change writes. Export retained history regularly before it rolls off. For manual cleanup, Export history starts a fresh snapshot download. Prune exported older history remains disabled until the operator confirms that the file was saved, then retains the latest entry; concurrent writes invalidate that pruning request. The app does not assume that starting a browser download guarantees a saved file. Export local history or the original migration JSON. Full book exports/encrypted backups retain v4 controls; the portable book limit is 5 MB. History remains device-local and is not carried into portable book backups. Browser storage can be cleared or lost; keep external backups and recovery keys.

See [implementation phases](docs/implementation-phases.md) for scope and release evidence. This release does not introduce a multi-user backend, verified operator identity, settlement accounting, a universal custodian feed, ownership look-through, CRM/KYC or Arabic localisation.


### Legacy sequencing compatibility

Legacy v1–v3 books with valid counters in each event collection but collisions across collections are resequenced before the global uniqueness gate. Ordering is deterministic: date, old sequence, event priority (cash, trade, action), then stable ID using lexical comparison. Collision-free books retain their existing sequences; invalid within-collection duplicate counters are still rejected. The v4 book retains `sequenceMigration` with source version, rule and complete old/new mapping; the untouched raw original and migration change event remain available. Loads, plain imports and decrypted legacy backups use this same rule. Native v4 collisions are always rejected. No trade amounts, dates, fees, FX, IDs or holdings are manufactured by this repair.

The history byte cap bounds history data, not total browser storage (books, resilience snapshots and other origin storage also consume quota). A genuine quota failure still aborts the whole transaction safely; it never commits an unlogged book change. Local retention/pruning counters remain in metadata, and original migration/recovery books are not deleted by history pruning.
