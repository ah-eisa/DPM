# WealthGate office publisher

`/publish` prepares a snapshot for one controlled account. It never sends a
portable book to the portal. Review its valuation timestamp, base currency,
cash, NAV, holdings, pricing warnings and optional performance before export.

Build the standalone office signing tools with `npm run build:publisher`.
The compiled contract/verifier has no browser storage or ledger dependencies.

```sh
npm run publisher -- keygen --dir /private/dpm-publisher/key-2026
npm run publisher -- sign --in account.json --out publication.json \
  --source office-1 --stream stream-1 --key-id key-2026 \
  --key /private/dpm-publisher/key-2026/private.pem \
  --outbox /private/dpm-publisher/outbox
# Supply DPM_PUBLISH_TOKEN securely in the process environment.
npm run publisher -- send --in publication.json \
  --url https://wealthgateai.com/api/dpm/ingest
```

Register the public key, source, stream and account IDs in the receiver's trusted
registry first. Keep the private key, bearer token and outbox outside the app
checkout and all public web infrastructure. Protect them with the host's user
permissions/ACLs and a private backup. Unix file modes alone do not implement
Windows ACL protection.

The outbox allocates a durable per-account/source/stream publication sequence
under an exclusive lock and retains immutable signed files. A retry of the same
snapshot ID/digest reuses its signed envelope. A conflicting payload is rejected.
An interrupted signing lock fails closed: inspect the outbox before clearing
the lock. Restore/reconcile a lost outbox against accepted receipts or arrange
an explicitly reviewed new stream; do not reset counters silently.

Publishing is explicit because the authoritative office book currently lives
in browser IndexedDB. Automatic publishing requires a separately designed
trusted outbox source; a server timer cannot read that browser book.

The receiver's acknowledgement records receipt only. WealthGate account binding
and snapshot activation each use its Maker/Checker workflow. The portal uses
the signed valuation as supplied and checks grants for every read/statement.

The new publication envelope v2 signs source, stream, sequence, key ID, digest
and the unchanged account snapshot v1 payload. Existing v1 signing helpers
remain available to their existing consumers. To update WealthGate's standalone
public contract and verifier:

```sh
node scripts/sync-wealthgate-contract.mjs /path/to/wealthgate
```

The CLI refuses plaintext HTTP outside loopback and redirects when sending.
Never pass a token on the command line or embed it in a URL.
