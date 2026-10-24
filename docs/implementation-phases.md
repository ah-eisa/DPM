# DPM implementation phases

## Phase 0 — integrity foundation

Completed: stale-tab protection; retained recovery keys; contemporaneous Yahoo split prices; daily historical observations; zero-ending-value TWR; explicit missing-valuation/benchmark anchors; shared navigation. The temporary Web Lock/localStorage writer is superseded by phase 1 below.

## Phase 1 — v4 and transactional persistence

Implemented schema-v4 validation/migration; explicit accounts; stable Security Master IDs and pricing mappings; per-account cash and holding checks; explicit price multipliers; transactional IndexedDB book/revision/before-and-after history. The original v3 JSON remains untouched and is retained in migration metadata. Tests cover simultaneous migration/writes, stale revisions, simulated history-write failure rolling back the entire book transaction, and fixed-price migration economics.

## Phase 2 — custodian observations

Implemented strict documented CSV template, optional compatible clean-price/value fields, preview and instrument mapping, effective/received dates, SHA-256 source lineage, duplicate-source rejection, superseding observation references, historical account reconciliation, partial/complete scope, absolute/relative tolerances and reasoned break reviews. Observations do not mutate the ledger. Native foreign-currency cash and dirty/accrued values are explicitly not comparable rather than guessed. Settlement-date observations need normalisation before import.

## Phase 3 — governed prices and reporting groups

Implemented expiring manual price policy and selection lineage, unique-account households and saved views, per-currency historical account valuation reports, CSV and browser printing. Missing manual prices remain indicative cost. Current overrides affect current portfolio valuation; they do not silently change historical TWR. Reports include as-of date, selected accounts and revision.

Fee support is a bounded Actual/365 estimate only. Automatic billing, high-water marks, performance-fee crystallisation, fractional ownership, custom-attribute query builders, verified operator identity and server-side multi-user persistence remain separate future specifications.

## Release checks

Automated coverage includes migrated FIFO/cash/P&L, account isolation, same-ticker instrument ambiguity, split scope, percentage-of-par multipliers, duplicate CSV, historical scope, native foreign-cash not-comparable handling, clean/dirty value compatibility, override expiry/zero/currency, group double counting, formula-safe export, encrypted v4 round trips, IDB concurrency and atomic failure rollback. Run tests, lint, TypeScript, production build and audit before publishing.

Browser checks use synthetic state on a separate localhost origin. Account creation, accepted observation preview, grouping/reporting, reload persistence, change history, navigation and light/dark 390px layouts were checked. This does not assert live authenticated provider availability or Arabic/RTL support. Reload all old application tabs on upgrade and keep an exported backup for rollback to the old application; old code writes only the preserved legacy store.


## Post-review integrity hardening

Legacy per-collection sequence collisions now migrate deterministically before v4 validation, with a complete old/new mapping in the book and untouched original JSON preserved. Within-collection invalid counters and every v4 global collision still fail. This path covers initial loading, JSON imports and encrypted legacy restores.

Local history now retains at most 100 newest entries and 20 MiB. Pruning, the revision update, the book and the new change event share one transaction; a failure rolls pruning back too. Manual pruning requires exporting a fresh snapshot and confirming the file was saved; a revision lease rejects concurrent unseen writes. Original migration and previous-book metadata remain separate. Tests cover counter collisions, funding-before-trade/split order, retained mapping, failed migration rollback, both retention limits, v1-IDB history upgrade and failed pruning rollback.
