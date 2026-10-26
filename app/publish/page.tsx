"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceLinks } from "../workspace-links";
import { loadState } from "@/lib/storage";
import {
  buildClientPortalSnapshot,
  type ClientPortalSnapshotV1,
} from "@/lib/client-portal";
import { validatePortalSnapshot } from "@/lib/portal-contract";
import { parseBenchmark, type HistorySeries } from "@/lib/performance";
import type { DpmState, Quote } from "@/lib/types";

export default function PublishPage() {
  const [book, setBook] = useState<DpmState | null>(null),
    [accountId, setAccountId] = useState("");
  const [snapshot, setSnapshot] = useState<ClientPortalSnapshotV1 | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [performance, setPerformance] = useState(false),
    [asOf, setAsOf] = useState("");
  const [costOnly, setCostOnly] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    void loadState()
      .then((s) => {
        if (active) {
          setBook(s);
          setAccountId(s.controls?.accounts[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
      request.current++;
    };
  }, []);
  const account = book?.controls?.accounts.find((a) => a.id === accountId);
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: snapshot?.baseCurrency ?? "USD",
    }).format(n);
  async function prepare() {
    if (!book || !account) return;
    const id = ++request.current;
    setBusy(true);
    setError("");
    setSnapshot(null);
    try {
      const tx = book.transactions.filter((t) => t.accountId === account.id);
      const symbols = [
        ...new Set(
          tx.map(
            (t) =>
              book.controls?.securities.find((s) => s.id === t.securityId)
                ?.symbol ?? t.symbol,
          ),
        ),
      ];
      const quotes: Record<string, Quote> = {};
      async function batch(items: string[]) {
        for (let i = 0; i < items.length; i += 50) {
          const r = await fetch(
            `/api/quotes?symbols=${encodeURIComponent(items.slice(i, i + 50).join(","))}`,
            { cache: "no-store", signal: AbortSignal.timeout(60000) },
          );
          if (!r.ok)
            throw Error(
              "Market quotes unavailable; retry or prepare an indicative cost valuation",
            );
          const data = await r.json();
          Object.assign(quotes, data.quotes);
        }
      }
      if (!costOnly) await batch(symbols);
      const currencies = [
        ...new Set(
          Object.values(quotes)
            .map((q) => q.currency)
            .filter((c): c is string => !!c && c !== account.baseCurrency),
        ),
      ];
      await batch(currencies.map((c) => `${c}${account.baseCurrency}=X`));
      const publishedAt = asOf
        ? new Date(`${asOf}:00Z`).toISOString()
        : new Date().toISOString();
      if (Date.parse(publishedAt) > Date.now())
        throw Error("Choose a valuation time that is not in the future");
      let history: HistorySeries[] | undefined;
      let performancePeriod: { startDate: string; endDate: string } | undefined;
      if (performance) {
        const client = book.clients.find((c) => c.id === account.clientId);
        if (!client) throw Error("Client not found");
        const all = [
          ...new Set([
            ...symbols,
            ...parseBenchmark(client.benchmark).map((b) => b.symbol),
          ]),
        ];
        if (all.length > 25)
          throw Error("Performance supports up to 25 symbols per account");
        const endDate = publishedAt.slice(0, 10),
          start = new Date(publishedAt);
        start.setUTCFullYear(start.getUTCFullYear() - 1);
        const startDate = start.toISOString().slice(0, 10);
        start.setUTCDate(start.getUTCDate() - 7);
        const r = await fetch(
          `/api/history?symbols=${encodeURIComponent(all.join(","))}&start=${start.toISOString().slice(0, 10)}&end=${endDate}&base=${account.baseCurrency}`,
          { cache: "no-store", signal: AbortSignal.timeout(60000) },
        );
        const data = await r.json();
        if (!r.ok) throw Error(data.error ?? "Historical prices unavailable");
        history = Object.values(data.series ?? {});
        performancePeriod = { startDate, endDate };
      }
      const prepared = buildClientPortalSnapshot({
        state: book,
        clientId: account.clientId,
        accountId: account.id,
        quotes,
        snapshotId: crypto.randomUUID(),
        publishedAt,
        history,
        performancePeriod,
      });
      validatePortalSnapshot(prepared);
      if (id === request.current) setSnapshot(prepared);
    } catch (e) {
      if (id === request.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  function download() {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dpm-account-${snapshot.snapshotId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="controls">
      <header className="topbar">
        <div>
          <h1>Account publishing</h1>
          <p className="muted">Prepare an account valuation for WealthGate.</p>
        </div>
        <WorkspaceLinks current="/publish" />
      </header>
      <div className="container">
        <section className="card">
          <h2>Prepare publication</h2>
          <p className="muted">
            This export contains one account snapshot. A trusted office
            publisher signs and sends it; WealthGate approval controls when it
            becomes visible.
          </p>
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          {!book ? (
            <p>
              {error
                ? "Saved book unavailable. Open Backup to recover the book before preparing a publication."
                : "Loading saved book…"}
            </p>
          ) : !book.controls ? (
            <p>Account publishing requires a controlled v4 book.</p>
          ) : (
            <>
              <div className="form-grid grid">
                <label>
                  Account
                  <select
                    disabled={busy}
                    value={accountId}
                    onChange={(e) => {
                      setAccountId(e.target.value);
                      setSnapshot(null);
                    }}
                  >
                    {book.controls.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label} · {a.baseCurrency}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Valuation time (UTC, blank for current time)
                  <input
                    disabled={busy}
                    type="datetime-local"
                    value={asOf}
                    onChange={(e) => {
                      setAsOf(e.target.value);
                      setSnapshot(null);
                    }}
                  />
                </label>
              </div>
              <label className="row">
                <input
                  style={{ width: "auto" }}
                  disabled={busy}
                  type="checkbox"
                  checked={performance}
                  onChange={(e) => {
                    setPerformance(e.target.checked);
                    setSnapshot(null);
                  }}
                />
                Include one-year performance when market history is available
              </label>
              <label className="row">
                <input
                  style={{ width: "auto" }}
                  disabled={busy}
                  type="checkbox"
                  checked={costOnly}
                  onChange={(e) => {
                    setCostOnly(e.target.checked);
                    setSnapshot(null);
                  }}
                />
                Prepare an indicative FIFO cost valuation without market quotes
              </label>
              <button
                className="btn"
                disabled={busy || !account}
                onClick={() => void prepare()}
              >
                {busy ? "Preparing…" : "Prepare preview"}
              </button>
            </>
          )}
        </section>
        {snapshot && (
          <section className="card">
            <h2>Publication preview</h2>
            <p>
              {snapshot.accountId} · {snapshot.baseCurrency} ·{" "}
              {snapshot.publishedAt}
            </p>
            <div className="grid kpis">
              {[
                ["NAV", snapshot.nav],
                ["Cash", snapshot.cash],
                ["Realised P&L", snapshot.realisedPnl],
                ["Unrealised P&L", snapshot.unrealisedPnl],
                ["Total P&L", snapshot.totalPnl],
              ].map(([label, n]) => (
                <div className="kpi" key={label}>
                  <span className="muted">{label}</span>
                  <div className="value">{money(Number(n))}</div>
                </div>
              ))}
            </div>
            <p>
              {snapshot.valuationComplete
                ? "Market valuation complete"
                : "Indicative valuation: review pricing warnings"}{" "}
              · Book revision {snapshot.bookRevision}
            </p>
            <ul>
              {snapshot.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Security</th>
                    <th>Quantity</th>
                    <th>Value</th>
                    <th>Valuation</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.holdings.map((h) => (
                    <tr key={h.securityId ?? h.symbol}>
                      <td>{h.symbol}</td>
                      <td>{h.quantity}</td>
                      <td>{money(h.marketValue)}</td>
                      <td>{h.valuationStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn" onClick={download}>
              Download account snapshot for signing
            </button>
            <p className="muted">
              The signing private key stays in the trusted publisher. Keep this
              financial snapshot private.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
