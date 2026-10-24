# DPM Client Portal Publish Layer

## Security invariant

The DPM office book remains the only write source. The client portal never receives, imports, decrypts or stores a portable DPM book. It receives an immutable account-scoped `ClientPortalSnapshotV1` only.

There is no supported route from the public client portal back into the DPM ledger.

## Phase 0: publish contract

`buildClientPortalSnapshot` requires a v4 controlled book and an explicit `clientId` plus `accountId`. Every ledger event for that client must already be bound to an account. Publishing fails closed if an event is unbound.

The published ledger view is also time-bounded. Trades, cash movements and corporate actions dated after the snapshot `publishedAt` calendar date are excluded. A requested performance period may not end after the snapshot date.

The account view retains the complete Security Master internally while pricing so duplicate tickers remain ambiguous exactly as they are in the office book. Only account holdings and their filtered price lineage are emitted in the snapshot.

The snapshot intentionally includes only data required for a read-only client experience:

- client code, never the client label
- account ID, never the account label or custodian label
- NAV, cash, P&L and allocation
- holdings and current valuation status
- drift versus mandate targets
- current price-source lineage for securities actually present in the published account
- optional performance series calculated by the existing DPM performance engine
- valuation warnings

The snapshot is versioned independently from the DPM book schema so the portal can evolve without accepting the office book format.

## Deterministic valuation

`publishedAt` is the explicit valuation reference time for portal snapshots. Current-price staleness is evaluated against that timestamp, not the server or browser wall clock. Quotes dated after `publishedAt` are not classified as live.

This makes repeated generation from the same book, quotes and snapshot timestamp deterministic even if the process runs later.

## Integrity model

`signClientPortalSnapshot` signs the canonical envelope metadata and payload with Ed25519. The signed bytes include the envelope schema/version, algorithm, `keyId`, content digest and payload. The private signing key belongs to the DPM publishing environment only. Portal infrastructure receives trusted public keys and verifies every snapshot before persistence or presentation.

The signed envelope contains a SHA-256 payload digest for statement/audit display. A changed payload, digest, signing-key identifier or signed envelope metadata fails verification.

Recommended production key handling:

1. Generate Ed25519 keys outside the repository.
2. Keep the private key in an office/server secret store, never browser storage and never source control.
3. Give the portal verifier the public key only.
4. Rotate with a new `keyId`; retain old public keys for historical verification.
5. Resolve `keyId` to a trusted public-key registry. Never accept a public key supplied by the snapshot itself.

## Phase 1: secure statements

`renderClientStatementHtml` creates a self-contained, print/PDF-ready statement only after it successfully verifies the signed envelope with a trusted public key. Invalid or modified envelopes are rejected before the payload is rendered. The statement includes the snapshot ID, signing key ID and content digest.

`issuePortalStatementAccessToken` creates a short-lived HMAC token for statement retrieval. TTL is bounded to 60-3600 seconds. The token contains no client name or email. Production storage should remain private and return the statement only after token/session authorization.

The HMAC token is an access-link mechanism, not the long-term Phase 2 identity system. Phase 2 should use a managed identity provider with MFA/passkeys/TOTP, recovery controls and session revocation.

## Recommended portal-side storage

Persist append-only records, not a mutable "current portfolio" row:

```sql
create table portal_snapshots (
  snapshot_id text primary key,
  client_code text not null,
  account_id text not null,
  published_at timestamptz not null,
  book_revision bigint not null,
  key_id text not null,
  content_digest text not null,
  envelope jsonb not null,
  received_at timestamptz not null default now(),
  unique (account_id, book_revision)
);

create index portal_snapshots_account_published_idx
  on portal_snapshots (account_id, published_at desc);
```

The ingest service must verify the Ed25519 signature before insert, reject duplicate/replayed revisions, impose a body-size limit and log acceptance/rejection events. The client-facing API should have SELECT-only database credentials or an equivalent read-only role.

## Network separation

Recommended production split:

- `portal-publish.eisax.com`: ingest only, authenticated for the DPM publisher, no client sessions
- `portal.eisax.com`: client UI/read API only, no publish credential and no ledger write route

Do not expose an endpoint that accepts a portable book. Do not put the office signing private key in portal infrastructure.

## Release control

The repository workflow runs lint, tests, TypeScript, production build and dependency audit. Production release policy should separately require the successful `Verify` status on `main` through GitHub branch protection or a repository ruleset so a successful workflow is a merge gate rather than only a post-hoc signal.

## Phase 2 and later

The snapshot schema is designed as a WealthGate read model. DPM is the first publisher, not the permanent boundary of the client experience. Documents, historical statements, suitability and other WealthGate modules can reference the same `clientCode`, `accountId` and immutable snapshot IDs without gaining write access to the DPM ledger.
