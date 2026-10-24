"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { WorkspaceLinks } from "../workspace-links";
import { loadState, saveState, downloadSavedBook } from "@/lib/storage";
import {
  bookHistory,
  readBookMeta,
  pruneBookHistory,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_BYTES,
} from "@/lib/book-store";
import { validateState, ASSET_CLASSES } from "@/lib/validation";
import {
  addAccount,
  addOverride,
  previewObservation,
  reconcile,
  groupedAccountTotals,
  feeEstimate,
  reportCsv,
  selectPrices,
} from "@/lib/controls";
import type {
  BookChange,
  CustodianObservation,
  DpmState,
  Security,
} from "@/lib/types";

type Section =
  | "Master data"
  | "Reconciliation"
  | "Prices"
  | "Groups & views"
  | "Reports"
  | "History";
const sections: Section[] = [
  "Master data",
  "Reconciliation",
  "Prices",
  "Groups & views",
  "Reports",
  "History",
];
const today = () => new Date().toISOString().slice(0, 10);
function download(name: string, content: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
function Field({
  name,
  label,
  type = "text",
  value,
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        {...(type === "number" ? { min: 0, step: "any" } : {})}
      />
    </label>
  );
}
export default function ControlsPage() {
  const [book, setBook] = useState<DpmState>();
  const [section, setSection] = useState<Section>("Master data");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<BookChange[]>([]);
  const [historyExportRevision, setHistoryExportRevision] = useState<number>();
  const [historyExportConfirmed, setHistoryExportConfirmed] = useState(false);
  const [preview, setPreview] = useState<CustodianObservation>();
  const [fileText, setFileText] = useState("");
  const [accountId, setAccountId] = useState("");
  const [observationId, setObservationId] = useState("");
  const [absolute, setAbsolute] = useState("0.000001");
  const [relative, setRelative] = useState("0.000001");
  const [selected, setSelected] = useState<string[]>([]);
  const [asOf, setAsOf] = useState(today());
  const [fee, setFee] = useState<number>();
  const [theme, setTheme] = useState("dark");
  useEffect(() => {
    let active = true;
    setTheme(document.documentElement.dataset.theme ?? "dark");
    loadState()
      .then((s) => {
        if (active) {
          setBook(s);
          setAccountId(s.controls!.accounts[0].id);
          setSelected(s.controls!.accounts.map((a) => a.id));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function commit(next: DpmState, action: string) {
    setPending(true);
    setError("");
    try {
      const saved = await saveState(next, { action });
      setBook(saved);
      setStatus(`${action} saved at revision ${saved.revision}`);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setPending(false);
    }
  }
  async function run(task: () => Promise<void>) {
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function switchTheme() {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem("dpm-desk-theme", t);
  }
  async function submit(
    e: FormEvent<HTMLFormElement>,
    action: string,
    handler: (data: FormData) => DpmState,
  ) {
    e.preventDefault();
    const form = e.currentTarget;
    await run(async () => {
      if (await commit(handler(new FormData(form)), action)) form.reset();
    });
  }
  async function file(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setError("CSV exceeds 5 MB");
      return;
    }
    setFileText(await f.text());
    setPreview(undefined);
  }
  const controls = book?.controls;
  const observation =
    preview ?? controls?.observations.find((o) => o.id === observationId);
  let breaks: ReturnType<typeof reconcile> = [];
  let breakError = "";
  if (book && observation)
    try {
      breaks = reconcile(book, observation, Number(absolute), Number(relative));
    } catch (e) {
      breakError = (e as Error).message;
    }
  const pricing = book
    ? selectPrices(book, {}, `${asOf}T23:59:59.999Z`)
    : { quotes: {}, lineage: [] };
  let totals: ReturnType<typeof groupedAccountTotals> = {};
  if (book && selected.length)
    try {
      totals = groupedAccountTotals(book, selected, pricing.quotes, asOf);
    } catch {
      /* Surface validation in the export action. */
    }
  if (!book || !controls)
    return (
      <main className="app">
        <div className="container">
          <h1>Book Controls</h1>
          <p role="alert">{error || "Loading validated book…"}</p>
          {error && (
            <>
              <a className="btn" href="/operations">
                Open recovery
              </a>
              <button
                className="btn"
                onClick={() =>
                  run(async () => {
                    await downloadSavedBook();
                  })
                }
              >
                Download original saved book
              </button>
            </>
          )}
        </div>
      </main>
    );
  const accountSelect = (
    <label className="field">
      Account
      <select
        value={accountId}
        onChange={(e) => {
          setAccountId(e.target.value);
          setPreview(undefined);
        }}
      >
        {controls.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label} / {book.clients.find((c) => c.id === a.clientId)?.code} /{" "}
            {a.baseCurrency}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <main className="app controls">
      <header className="topbar">
        <div className="brand">
          <div className="brandmark">C</div>
          <div>
            <h1>Book Controls</h1>
            <span className="muted small">
              Accounts, reconciliation and governed valuations
            </span>
          </div>
        </div>
        <button className="btn" onClick={switchTheme}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <WorkspaceLinks current="/controls" />
      </header>
      <div className="container">
        <div className="notice">
          Schema v{book.version} · Revision {book.revision} · Transactional
          browser book. Operator labels are unverified; local history is
          editable and is not a regulatory audit trail.
        </div>
        {error && (
          <p role="alert" className="negative">
            {error}
          </p>
        )}
        {status && <p role="status">{status}</p>}
        <div className="tabs" aria-label="Control sections">
          {sections.map((s) => (
            <button
              key={s}
              className={`tab ${s === section ? "active" : ""}`}
              aria-pressed={s === section}
              onClick={() => {
                setSection(s);
                setError("");
                if (s === "History")
                  void run(async () => setHistory(await bookHistory()));
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {section === "Master data" && (
          <div className="grid two" style={{ marginTop: 16 }}>
            <section className="card">
              <h2>Accounts</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Account / ID</th>
                      <th>Client</th>
                      <th>Custodian</th>
                      <th>Base / Opening cash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {controls.accounts.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {a.label}
                          <div className="small mono">{a.id}</div>
                        </td>
                        <td>
                          {book.clients.find((c) => c.id === a.clientId)?.code}
                        </td>
                        <td>{a.custodian}</td>
                        <td>
                          {a.baseCurrency} {a.initialCash.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Add zero-opening account</h3>
              <form
                onSubmit={(e) =>
                  submit(e, "Account created", (d) =>
                    addAccount(book, {
                      clientId: String(d.get("clientId")),
                      label: String(d.get("label")),
                      custodian: String(d.get("custodian")),
                    }),
                  )
                }
              >
                <div className="form-grid">
                  <label className="field">
                    Client
                    <select name="clientId">
                      {book.clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field name="label" label="Account label" />
                  <Field name="custodian" label="Custodian" />
                </div>
                <p className="muted small">
                  Opening cash stays unchanged. Fund this account with an
                  explicit cash movement; trades and cash are validated
                  independently per account.
                </p>
                <button disabled={pending} className="btn primary">
                  Add account
                </button>
              </form>
            </section>
            <section className="card">
              <h2>Security Master</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Instrument / ID</th>
                      <th>Pricing alias / exchange</th>
                      <th>Currency / multiplier</th>
                      <th>Mapping</th>
                    </tr>
                  </thead>
                  <tbody>
                    {controls.securities.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.name}
                          <div className="small mono">{s.id}</div>
                        </td>
                        <td>
                          {s.symbol} / {s.exchange}
                        </td>
                        <td>
                          {s.currency} × {s.priceMultiplier}
                        </td>
                        <td>
                          {s.exchange === "UNRESOLVED"
                            ? "Review exchange mapping"
                            : "Explicit"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h3>Resolve pricing mapping</h3>
              <form
                onSubmit={(e) =>
                  submit(e, "Security mapping updated", (d) => ({
                    ...book,
                    controls: {
                      ...controls,
                      securities: controls.securities.map((s) =>
                        s.id === d.get("securityId")
                          ? {
                              ...s,
                              exchange: String(d.get("exchange")),
                              symbol: String(d.get("symbol")),
                            }
                          : s,
                      ),
                    },
                  }))
                }
              >
                <div className="form-grid">
                  <label className="field">
                    Existing instrument
                    <select name="securityId">
                      {controls.securities.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} / {s.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Field name="exchange" label="Confirmed exchange" />
                  <Field name="symbol" label="Confirmed provider alias" />
                </div>
                <p className="muted small">
                  The stable instrument ID and original ledger symbols are
                  preserved. Only the pricing mapping changes.
                </p>
                <button
                  className="btn"
                  disabled={pending || !controls.securities.length}
                >
                  Update mapping
                </button>
              </form>
              <h3>Add instrument</h3>
              <form
                onSubmit={(e) =>
                  submit(e, "Security created", (d) =>
                    validateState({
                      ...book,
                      controls: {
                        ...controls,
                        securities: [
                          ...controls.securities,
                          {
                            id: crypto.randomUUID(),
                            symbol: String(d.get("symbol")),
                            name: String(d.get("name")),
                            exchange: String(d.get("exchange")),
                            currency: String(d.get("currency")),
                            assetClass: String(
                              d.get("assetClass"),
                            ) as Security["assetClass"],
                            priceMultiplier: Number(d.get("multiplier")),
                            shariaStatus: "unknown",
                            ...(d.get("isin")
                              ? { isin: String(d.get("isin")) }
                              : {}),
                          },
                        ],
                      },
                    }),
                  )
                }
              >
                <div className="form-grid">
                  <Field name="name" label="Instrument name" />
                  <Field name="symbol" label="Provider pricing alias" />
                  <Field name="exchange" label="Exchange" />
                  <Field name="currency" label="Quote currency" value="USD" />
                  <label className="field">
                    Asset class
                    <select name="assetClass">
                      {ASSET_CLASSES.filter((c) => c !== "Cash").map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <Field
                    name="multiplier"
                    label="Price multiplier"
                    type="number"
                    value="1"
                  />
                  <Field name="isin" label="ISIN (optional)" required={false} />
                </div>
                <p className="muted small">
                  Unit price: 1. Percentage-of-par per unit face value: 0.01.
                  Record accrued interest separately; clean bond prices exclude
                  accrued interest. Ambiguous aliases need security-specific
                  prices. Sharia status remains unknown.
                </p>
                <button disabled={pending} className="btn primary">
                  Add security
                </button>
              </form>
            </section>
          </div>
        )}
        {section === "Reconciliation" && (
          <div className="grid" style={{ marginTop: 16 }}>
            <section className="card">
              <h2>Custodian observation</h2>
              <p className="muted small">
                CSV required columns: security_id,symbol,currency,quantity.
                Optional:
                price,reported_value,unit_multiplier,price_as_of,price_convention.
                Price/value comparison requires same-date clean prices and
                compatible units; otherwise it is marked not comparable.
              </p>
              <p className="muted">
                Trade-date positions and one reported cash currency per
                observation. A statement is evidence; accepting it never changes
                ledger entries. Foreign-currency cash is retained as not
                comparable; settlement-date statements require separate
                normalisation.
              </p>
              <button
                className="btn"
                onClick={() =>
                  download(
                    "custodian-template.csv",
                    "security_id,symbol,currency,quantity\r\n",
                  )
                }
              >
                Download CSV template
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = new FormData(e.currentTarget);
                  void run(async () => {
                    setPreview(
                      await previewObservation(book, fileText, {
                        accountId,
                        effectiveDate: String(d.get("date")),
                        source: String(d.get("source")),
                        ...(d.get("supersedes")
                          ? { supersedesId: String(d.get("supersedes")) }
                          : {}),
                        scope: String(d.get("scope")) as "partial" | "complete",
                        ...(String(d.get("cash")).trim()
                          ? {
                              cash: Number(d.get("cash")),
                              cashCurrency: String(d.get("cashCurrency")),
                            }
                          : {}),
                      }),
                    );
                    setStatus("Validated preview; review before acceptance");
                  });
                }}
              >
                <div className="form-grid">
                  {accountSelect}
                  <Field
                    name="date"
                    label="Effective date (UTC trade date)"
                    type="date"
                    value={today()}
                  />
                  <Field name="source" label="Statement source" />
                  <label className="field">
                    Scope
                    <select name="scope">
                      <option value="partial">Partial</option>
                      <option value="complete">Complete positions</option>
                    </select>
                  </label>
                  <label className="field">
                    Supersedes observation (optional)
                    <select name="supersedes">
                      <option value="">New observation</option>
                      {controls.observations
                        .filter((o) => o.accountId === accountId)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.effectiveDate} / {o.source}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Field
                    name="cash"
                    label="Reported cash (optional)"
                    type="number"
                    required={false}
                  />
                  <Field
                    name="cashCurrency"
                    label="Statement cash currency"
                    value="USD"
                  />
                  <label className="field">
                    Statement CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      required
                      onChange={file}
                    />
                  </label>
                </div>
                <button className="btn" disabled={!fileText}>
                  Preview statement
                </button>
              </form>
              <div className="form-grid">
                <label className="field">
                  Saved observation
                  <select
                    value={observationId}
                    onChange={(e) => {
                      setObservationId(e.target.value);
                      setPreview(undefined);
                    }}
                  >
                    <option value="">Select observation</option>
                    {controls.observations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.effectiveDate} · {o.source} · {o.scope}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Absolute tolerance
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={absolute}
                    onChange={(e) => setAbsolute(e.target.value)}
                  />
                </label>
                <label className="field">
                  Relative tolerance (fraction)
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={relative}
                    onChange={(e) => setRelative(e.target.value)}
                  />
                </label>
              </div>
              {observation && (
                <>
                  <p className="small">
                    {observation.source} · Effective {observation.effectiveDate}{" "}
                    · Received {observation.receivedAt} · {observation.scope} ·{" "}
                    {observation.basis}
                    {observation.supersedesId
                      ? ` · Supersedes ${observation.supersedesId}`
                      : ""}
                  </p>
                  <p
                    className="mono small"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    SHA-256 {observation.sourceHash}
                  </p>
                  {breakError ? (
                    <p role="alert">{breakError}</p>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Position</th>
                            <th>Internal</th>
                            <th>Custodian</th>
                            <th>Tolerance</th>
                            <th>Break</th>
                            <th>Review</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breaks.map((b) => (
                            <tr key={b.key}>
                              <td>
                                {controls.securities.find((s) => s.id === b.key)
                                  ?.name ?? b.key}
                              </td>
                              <td>{b.internal ?? "—"}</td>
                              <td>{b.external ?? "—"}</td>
                              <td>{b.tolerance}</td>
                              <td>
                                {b.kind}
                                {b.note && (
                                  <div className="muted small">{b.note}</div>
                                )}
                              </td>
                              <td>
                                {controls.reviews
                                  .filter(
                                    (r) =>
                                      r.observationId === observation.id &&
                                      r.key === b.key,
                                  )
                                  .at(-1)?.status ?? "Unreviewed"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {preview && (
                    <div className="form-grid">
                      {preview.rows.map((row, i) => (
                        <label className="field" key={`${row.symbol}:${i}`}>
                          Map {row.symbol} ({row.currency})
                          <select
                            value={row.securityId ?? ""}
                            onChange={(e) =>
                              setPreview({
                                ...preview,
                                rows: preview.rows.map((r, index) =>
                                  index === i
                                    ? {
                                        ...r,
                                        securityId: e.target.value || undefined,
                                      }
                                    : r,
                                ),
                              })
                            }
                          >
                            <option value="">
                              Unmapped — retain for review
                            </option>
                            {controls.securities
                              .filter((s) => s.currency === row.currency)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} / {s.exchange}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                  {preview && (
                    <button
                      className="btn primary"
                      disabled={pending || !!breakError}
                      onClick={() =>
                        run(async () => {
                          if (
                            await commit(
                              {
                                ...book,
                                controls: {
                                  ...controls,
                                  observations: [
                                    ...controls.observations,
                                    preview,
                                  ],
                                },
                              },
                              "Observation accepted",
                            )
                          ) {
                            setObservationId(preview.id);
                            setPreview(undefined);
                          }
                        })
                      }
                    >
                      Accept observation
                    </button>
                  )}
                  {!preview && (
                    <form
                      onSubmit={(e) =>
                        submit(e, "Break reviewed", (d) => ({
                          ...book,
                          controls: {
                            ...controls,
                            reviews: [
                              ...controls.reviews,
                              {
                                id: crypto.randomUUID(),
                                observationId: observation.id,
                                key: String(d.get("key")),
                                status: String(d.get("status")) as
                                  | "accepted"
                                  | "resolved",
                                reason: String(d.get("reason")),
                                recordedAt: new Date().toISOString(),
                              },
                            ],
                          },
                        }))
                      }
                    >
                      <div className="form-grid">
                        <label className="field">
                          Break
                          <select name="key">
                            {breaks
                              .filter((b) => b.kind !== "matched")
                              .map((b) => (
                                <option key={b.key}>{b.key}</option>
                              ))}
                          </select>
                        </label>
                        <label className="field">
                          Review status
                          <select name="status">
                            <option value="accepted">
                              Accepted with reason
                            </option>
                            <option value="resolved">
                              Resolved with reason
                            </option>
                          </select>
                        </label>
                        <Field
                          name="reason"
                          label="Review reason / correction reference"
                        />
                      </div>
                      <button
                        className="btn"
                        disabled={
                          pending || !breaks.some((b) => b.kind !== "matched")
                        }
                      >
                        Record review
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
          </div>
        )}
        {section === "Prices" && (
          <section className="card" style={{ marginTop: 16 }}>
            <h2>Manual price observations</h2>
            <p className="muted">
              Active manual overrides take precedence until expiry. Latest
              effective timestamp wins; recorded timestamp breaks ties. Expired
              observations remain in history. Prices use the instrument quote
              unit, before its multiplier.
            </p>
            <form
              onSubmit={(e) =>
                submit(e, "Price override recorded", (d) => {
                  const securityId = String(d.get("securityId"));
                  return addOverride(book, {
                    securityId,
                    price: Number(d.get("price")),
                    currency: controls.securities.find(
                      (s) => s.id === securityId,
                    )!.currency,
                    effectiveAt: new Date(
                      String(d.get("effective")),
                    ).toISOString(),
                    expiresAt: new Date(String(d.get("expires"))).toISOString(),
                    source: String(d.get("source")),
                    reason: String(d.get("reason")),
                  });
                })
              }
            >
              <div className="form-grid">
                <label className="field">
                  Security
                  <select name="securityId">
                    {controls.securities.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} / {s.exchange} / {s.currency}
                      </option>
                    ))}
                  </select>
                </label>
                <Field name="price" label="Price" type="number" />
                <Field
                  name="effective"
                  label="Effective time (local)"
                  type="datetime-local"
                />
                <Field
                  name="expires"
                  label="Expiry time (local)"
                  type="datetime-local"
                />
                <Field name="source" label="Price source" />
                <Field name="reason" label="Override reason" />
              </div>
              <button
                className="btn primary"
                disabled={pending || !controls.securities.length}
              >
                Record override
              </button>
            </form>
            <h3>Selection lineage</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Security</th>
                    <th>Selected at report date</th>
                    <th>Alternatives</th>
                  </tr>
                </thead>
                <tbody>
                  {pricing.lineage.map((p) => (
                    <tr key={p.securityId}>
                      <td>
                        {
                          controls.securities.find((s) => s.id === p.securityId)
                            ?.name
                        }
                      </td>
                      <td>{p.selected}</td>
                      <td>{p.rejected.join("; ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {section === "Groups & views" && (
          <section className="card" style={{ marginTop: 16 }}>
            <h2>Households and saved views</h2>
            <p className="muted">
              Groups are reporting memberships, not legal ownership. Accounts
              are counted once. Mixed currencies remain separate.
            </p>
            <fieldset>
              <legend>Selected accounts</legend>
              {controls.accounts.map((a) => (
                <label key={a.id} className="row">
                  <input
                    type="checkbox"
                    checked={selected.includes(a.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, a.id]
                          : selected.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {a.label} / {a.baseCurrency}
                </label>
              ))}
            </fieldset>
            <form
              onSubmit={(e) =>
                submit(e, "Reporting group created", (d) => {
                  const field =
                    d.get("kind") === "view" ? "views" : "households";
                  return {
                    ...book,
                    controls: {
                      ...controls,
                      [field]: [
                        ...controls[field],
                        {
                          id: crypto.randomUUID(),
                          label: String(d.get("label")),
                          accountIds: selected,
                        },
                      ],
                    },
                  };
                })
              }
            >
              <div className="form-grid">
                <Field name="label" label="Group label" />
                <label className="field">
                  Kind
                  <select name="kind">
                    <option value="household">Household</option>
                    <option value="view">Saved view</option>
                  </select>
                </label>
              </div>
              <button
                disabled={pending || !selected.length}
                className="btn primary"
              >
                Save group
              </button>
            </form>
            {[...controls.households, ...controls.views].map((g) => (
              <div className="row" key={g.id}>
                <strong>{g.label}</strong>
                <span>{g.accountIds.length} accounts</span>
                <button
                  className="btn"
                  onClick={() => {
                    setSelected(g.accountIds);
                    setSection("Reports");
                  }}
                >
                  Open report
                </button>
              </div>
            ))}
          </section>
        )}
        {section === "Reports" && (
          <section className="card report" style={{ marginTop: 16 }}>
            <h2>Account valuation report</h2>
            <label className="field">
              As-of date
              <input
                type="date"
                value={asOf}
                max={today()}
                onChange={(e) => setAsOf(e.target.value)}
              />
            </label>
            <p className="small">
              Accounts:{" "}
              {selected
                .map(
                  (id) =>
                    controls.accounts.find((a) => a.id === id)?.label ?? id,
                )
                .join(", ")}{" "}
              · Book revision {book.revision} · Effective-date report
            </p>
            <p className="muted">
              Historical ledger with valid manual prices at the selected date.
              Missing prices use indicative FIFO cost and are marked incomplete.
              No cross-currency total is invented.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Accounts</th>
                    <th>Value</th>
                    <th>Valuation</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(totals).map(([ccy, t]) => (
                    <tr key={ccy}>
                      <td>{ccy}</td>
                      <td>{t.accounts}</td>
                      <td>
                        {t.value.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td>
                        {t.complete
                          ? "Complete"
                          : "Indicative cost / incomplete"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button
                className="btn"
                disabled={!selected.length}
                onClick={() =>
                  run(async () =>
                    download(
                      `dpm-accounts-${asOf}.csv`,
                      reportCsv(book, selected, pricing.quotes, asOf),
                    ),
                  )
                }
              >
                Export account CSV
              </button>
              <button className="btn" onClick={() => window.print()}>
                Print / Save PDF
              </button>
              <button
                className="btn"
                onClick={() => setSection("Groups & views")}
              >
                Choose accounts
              </button>
            </div>
            <h3>Management fee estimate</h3>
            <p className="muted small">
              Illustrative single-value accrual, Actual/365. Not an invoice,
              billing run, high-water mark or performance fee. It creates no
              cash movement.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void run(async () =>
                  setFee(
                    feeEstimate(
                      Number(d.get("value")),
                      Number(d.get("bps")),
                      Number(d.get("days")),
                    ),
                  ),
                );
              }}
            >
              <div className="form-grid">
                <Field
                  name="value"
                  label="Agreed fee base (one currency)"
                  type="number"
                />
                <Field name="bps" label="Annual basis points" type="number" />
                <Field
                  name="days"
                  label="Accrual days"
                  type="number"
                  value="90"
                />
              </div>
              <button className="btn">Calculate estimate</button>
              {fee !== undefined && (
                <output aria-live="polite">
                  {" "}
                  Estimated fee: {fee.toFixed(2)} in the fee-base currency
                </output>
              )}
            </form>
          </section>
        )}
        {section === "History" && (
          <section className="card" style={{ marginTop: 16 }}>
            <h2>Local change history</h2>
            <p className="muted">
              Book and change event commit atomically. Local operator identity
              is unverified. Full before/after states are retained for
              inspection, bounded to the newest {HISTORY_MAX_ENTRIES} revisions
              and at most {HISTORY_MAX_BYTES / 1024 / 1024} MiB (whichever is
              reached first). Older entries roll off automatically during saves.
              Export regularly before they roll off; this browser log is not
              tamper-proof.
            </p>
            {book.sequenceMigration && (
              <p className="notice">
                Legacy v{book.sequenceMigration.sourceVersion} sequencing was
                migrated using date → old sequence → event priority → stable ID.{" "}
                {book.sequenceMigration.mapping.length} events are recorded in
                the mapping.{" "}
                <button
                  className="btn"
                  onClick={() =>
                    download(
                      "dpm-sequence-migration.json",
                      JSON.stringify(book.sequenceMigration, null, 2),
                      "application/json",
                    )
                  }
                >
                  Export sequence mapping
                </button>
              </p>
            )}
            <div className="row">
              <button
                className="btn"
                onClick={() =>
                  run(async () => {
                    const fresh = await bookHistory();
                    download(
                      "dpm-local-history.json",
                      JSON.stringify(fresh, null, 2),
                      "application/json",
                    );
                    setHistory(fresh);
                    setHistoryExportRevision(fresh[0]?.revisionAfter);
                    setHistoryExportConfirmed(false);
                    setStatus(
                      "History download started. Save the file, then confirm before pruning.",
                    );
                  })
                }
              >
                Export history
              </button>
              <label className="row">
                <input
                  type="checkbox"
                  checked={historyExportConfirmed}
                  disabled={historyExportRevision === undefined}
                  onChange={(e) => setHistoryExportConfirmed(e.target.checked)}
                />
                I saved the exported history file
              </label>
              <button
                className="btn"
                disabled={
                  historyExportRevision === undefined ||
                  !historyExportConfirmed ||
                  pending
                }
                onClick={() =>
                  run(async () => {
                    if (
                      historyExportRevision === undefined ||
                      !historyExportConfirmed
                    )
                      throw Error("Export and save history before pruning");
                    const result = await pruneBookHistory(
                      historyExportRevision,
                    );
                    setHistory(await bookHistory());
                    setHistoryExportConfirmed(false);
                    setHistoryExportRevision(undefined);
                    setStatus(
                      `${result.removed} older entries removed; latest revision and book retained.`,
                    );
                  })
                }
              >
                Prune exported older history
              </button>
              <button
                className="btn"
                onClick={() =>
                  run(async () => {
                    const original = await readBookMeta("original-v3");
                    if (!original) throw Error("No legacy original stored");
                    download(
                      "dpm-original-v3.json",
                      String(original),
                      "application/json",
                    );
                  })
                }
              >
                Download migration original
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Revision</th>
                    <th>Recorded</th>
                    <th>Action</th>
                    <th>Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>
                        {h.revisionBefore} → {h.revisionAfter}
                      </td>
                      <td>{h.recordedAt}</td>
                      <td>{h.action}</td>
                      <td>{h.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
