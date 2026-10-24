# DPM implementation phases

## Phase 0: integrity foundation

Implemented:
- Revision-checked writes serialized across tabs using Web Locks. Stale writes fail with a reload message; recovery explicitly preserves the original book.
- Imported recovery keys are retained separately instead of replacing the active device key. Legacy envelopes remain decryptable.
- Yahoo split-adjusted closes are reconstructed into contemporaneous share units before ledger corporate actions are applied. Daily bars avoid weekly event-date look-ahead.
- Complete capital loss is valued at zero; a full withdrawal is not classified as investment loss.
- Missing required valuations stop performance calculation. Missing benchmark opening anchors suppress benchmark and excess return.
- Shared navigation connects Dashboard, Operations, Performance, Backup and Market Access.

Validation: 116 unit/regression tests; lint; TypeScript; production build; dependency audit. Browser checks use synthetic state on a separate localhost origin: stale-tab rejection, reload/retry preserving both entries, navigation, and 390px layout. Protected market APIs require deployment configuration; no live authenticated provider performance run is claimed.

Upgrade: reload every open DPM tab before writing. Web Locks requires a current browser on localhost or HTTPS. The primary book remains in localStorage in this phase; encrypted snapshots remain in IndexedDB. Backup exports remain essential for device-loss recovery.

## Phase 1: normalized book and transactional persistence

Next: schema v4 with backward-compatible migration; Security Master; explicit accounts; transactional IndexedDB primary book and change history. Migration must preserve the original book and be validated before activation. Test rollback, old-book migration, identifier collisions and atomic book/history writes before shipping.

## Phase 2: reconciliation

Custodian snapshots and position/cash reconciliation, with explicit as-of dates, tolerances, unmatched identifiers and review states. Importing a snapshot must not silently rewrite the ledger.

## Phase 3: governed adjustments and grouping

Overrides with source lineage and effective dates, household grouping without double-counting, then configurable reports and fee workflows. Each stage requires accounting regression tests and browser verification before publication.
