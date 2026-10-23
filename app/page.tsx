"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { aggregateAum, buildPortfolio, driftForClient } from "@/lib/portfolio";
import { exportState, importState, loadState, saveState, seedState, resetState, recoverState, downloadSavedBook } from "@/lib/storage";
import { MandateForm } from "./mandate-form";
import { orderedTrades, validateState } from "@/lib/validation";
import { AssetClass, DpmState, Quote, Side, Transaction } from "@/lib/types";

const ASSET_CLASSES: AssetClass[] = ["US Equity","UAE Equity","ETF","Bond/Sukuk","Crypto","Metal","Cash","Other"];
const moneyFor = (currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem("dpm-desk-theme", next); } catch { /* Theme still works when storage is unavailable. */ }
  }
  const [state, setState] = useState<DpmState>(seedState);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<"new" | "edit" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const requestId = useRef(0);
  const [ready, setReady] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quoteStatus, setQuoteStatus] = useState<"idle"|"loading"|"ok"|"partial">("idle");
  const [activeClientId, setActiveClientId] = useState("c001");
  const [tab, setTab] = useState<"overview"|"portfolio"|"trades"|"rebalance">("overview");
  const [trade, setTrade] = useState({ clientId: "c001", symbol: "", name: "", assetClass: "US Equity" as AssetClass, side: "BUY" as Side, quantity: "", price: "", fees: "0", fxRate: "1", currency: "USD", sequence: "", tradeDate: new Date().toISOString().slice(0,10), gtnRef: "" });

  useEffect(() => {
    try {
      const initial = loadState(); setState(initial); setActiveClientId(initial.clients[0].id);
      setTrade(t => ({...t,clientId:initial.clients[0].id,currency:initial.clients[0].baseCurrency})); setReady(true);
    } catch (e) { setError((e as Error).message); }
    setLoaded(true);
  }, []);

  function commit(next: DpmState): boolean {
    try { const valid = validateState(next); saveState(valid); setState(valid); setError(""); return true; }
    catch (e) { setError((e as Error).message); return false; }
  }

  const symbols = useMemo(() => Array.from(new Set(state.transactions.map((t) => t.symbol.toUpperCase()))).sort(), [state.transactions]);

  async function refreshQuotes() {
    const id = ++requestId.current;
    if (!symbols.length) { setQuotes({}); setQuoteStatus("idle"); return; }
    setQuoteStatus("loading");
    try {
      const fetchBatch = async (items: string[]) => {
        const quotes: Record<string, Quote> = {}; const errors: Record<string, string> = {};
        for (let i = 0; i < items.length; i += 50) {
          const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(items.slice(i,i+50).join(","))}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
          if (!response.ok) throw new Error(`Quote request failed (${response.status})`);
          const data = await response.json(); Object.assign(quotes,data.quotes); Object.assign(errors,data.errors);
        }
        return {quotes,errors};
      };
      const data = await fetchBatch(symbols);
      const pairs = new Set<string>();
      for (const t of state.transactions) {
        const base = state.clients.find(c => c.id === t.clientId)?.baseCurrency;
        const source = data.quotes[t.symbol]?.currency;
        if (base && source && base !== source) pairs.add(`${source}${base}=X`);
      }
      const fx = await fetchBatch([...pairs]);
      if (id !== requestId.current) return;
      setQuotes({...data.quotes,...fx.quotes});
      setQuoteStatus(Object.keys({...data.errors,...fx.errors}).length ? "partial" : "ok");
    } catch { if (id === requestId.current) { setQuotes({}); setQuoteStatus("partial"); } }
  }

  const quoteKey = [...new Set(state.transactions.map(t => `${t.symbol}:${state.clients.find(c => c.id === t.clientId)?.baseCurrency}`))].sort().join("|");
  useEffect(() => {
    if (!ready) return;
    void refreshQuotes();
    const timer = window.setInterval(refreshQuotes, 15 * 60 * 1000);
    return () => { requestId.current++; window.clearInterval(timer); };
  }, [ready, quoteKey]);

  const summaries = useMemo(() => state.clients.map((client) => buildPortfolio(client, state, quotes)), [state, quotes]);
  const active = summaries.find((p) => p.client.id === activeClientId) ?? summaries[0];
  const activeDrift = active ? driftForClient(state, active) : [];
  const money = moneyFor(active?.client.baseCurrency ?? "USD");
  const sameCurrency = summaries.filter(p => p.client.baseCurrency === active?.client.baseCurrency);
  const aum = aggregateAum(sameCurrency);
  const totalDayPnl = sameCurrency.reduce((s,p) => s + p.dayPnl, 0);
  const totalPnl = sameCurrency.reduce((s,p) => s + p.totalPnl, 0);
  const breachCount = summaries.reduce((count,p) => count + driftForClient(state,p).filter((d) => d.breach).length, 0);

  function selectClient(id: string) {
    setActiveClientId(id);
    setTrade((t) => ({ ...t, clientId: id, currency: state.clients.find(c => c.id === id)?.baseCurrency ?? "USD" }));
  }

  function addTrade(e: FormEvent) {
    e.preventDefault();
    const quantity = Number(trade.quantity);
    const price = Number(trade.price);
    if (!trade.clientId || !trade.symbol.trim() || !Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price < 0) {setError("Enter a valid client, symbol, positive quantity and non-negative price");return;}
    const tx: Transaction = {
      id: uid("tx"),
      sequence: trade.sequence ? Number(trade.sequence) : Math.max(0,...state.transactions.map(t => t.sequence ?? 0)) + 1,
      currency: trade.currency,
      clientId: trade.clientId,
      symbol: trade.symbol.trim().toUpperCase(),
      name: trade.name.trim() || undefined,
      assetClass: trade.assetClass,
      side: trade.side,
      quantity,
      price,
      fees: Number(trade.fees),
      fxRate: Number(trade.fxRate),
      tradeDate: trade.tradeDate,
      gtnRef: trade.gtnRef.trim() || undefined,
    };
    if (!commit({ ...state, transactions: [...state.transactions, tx] })) return;
    setTrade((t) => ({ ...t, symbol: "", name: "", quantity: "", price: "", fees: "0", gtnRef: "", sequence: "" }));
  }

  function deleteTrade(id: string) {
    if (!window.confirm("Delete this transaction?")) return;
    commit({ ...state, transactions: state.transactions.filter(t => t.id !== id) });
  }

  function adoptBook(next: DpmState) {
    if (!commit(next)) return false;
    setActiveClientId(next.clients[0].id);
    setTrade(t => ({...t,clientId:next.clients[0].id,currency:next.clients[0].baseCurrency,fxRate:"1"}));
    setReady(true); return true;
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importState(file);
      if (!window.confirm("Replace current book? Download a Backup first. The previous saved book is retained for recovery.")) return;
      adoptBook(imported);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
    e.target.value = "";
  }

  if (!ready || !active) return <main className="app"><div className="container"><h1>DPM Desk</h1>{loaded ? <><p role="alert">{error}</p><button className="btn" onClick={() => { try { downloadSavedBook(); } catch(e) {setError((e as Error).message);} }}>Download original saved book</button><label className="btn">Restore validated backup<input type="file" accept="application/json" onChange={onImport} hidden/></label><button className="btn" onClick={() => { try { const previous = recoverState(); adoptBook(previous); } catch(e) { setError((e as Error).message); } }}>Recover previous save</button></> : "Loading DPM Desk..."}</div></main>;

  const clientTrades = orderedTrades(state.transactions.filter(t => t.clientId === active.client.id)).reverse();

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><div className="brandmark">D</div><div><h1>DPM Desk</h1><div className="muted small">Private portfolio operating workbench</div></div></div>
        <div className="row">
          <button className="btn" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={toggleTheme}>{theme === "dark" ? "Light mode" : "Dark mode"}</button>
          <span className="status"><span className={`dot ${quoteStatus === "partial" ? "off" : ""}`} />{quoteStatus === "loading" ? "Refreshing prices" : quoteStatus === "ok" ? "Latest quotes received" : quoteStatus === "partial" ? "Partial market data" : "Local data ready"}</span>
          <button className="btn ghost" onClick={refreshQuotes}>Refresh</button>
        </div>
      </header>

      <div className="container">
        <div className="notice">Local-first design: client records and transactions stay in this browser. The quote endpoint receives security symbols only. Use anonymised client codes and follow your employer&apos;s information-security rules.</div>
        <div className="toolbar">
          <div className="tabs">
            {(["overview","portfolio","trades","rebalance"] as const).map((name) => <button key={name} className={`tab ${tab===name?"active":""}`} onClick={() => setTab(name)}>{name[0].toUpperCase()+name.slice(1)}</button>)}
          </div>
          <div className="row">
            <button className="btn" onClick={() => setSettings("new")}>+ Client</button>
            <button className="btn" onClick={() => setSettings("edit")}>Edit mandate</button>
            <button className="btn" onClick={() => { try {exportState(state);} catch(e) {setError((e as Error).message);} }}>Backup</button>
            <button className="btn" onClick={() => {try { const previous = recoverState(); if (window.confirm("Recover previous saved book?")) adoptBook(previous); } catch(e) {setError((e as Error).message);} }}>Recover previous</button>
            <button className="btn danger" onClick={() => {if(window.confirm("Reset to demo? Back up first. Your previous saved book is retained for recovery.")) {try {resetState(); const next=loadState(); setState(next); setActiveClientId(next.clients[0].id); setTrade(t=>({...t,clientId:next.clients[0].id,currency:next.clients[0].baseCurrency,fxRate:"1"}));} catch(e) {setError((e as Error).message);}}}}>Reset demo</button>
            <label className="btn">Restore<input type="file" accept="application/json" onChange={onImport} style={{display:"none"}} /></label>
          </div>
        </div>

        {error && <div className="notice negative" role="alert">{error}</div>}
        <div className="row client-selector"><label htmlFor="active-client">Active client</label><select id="active-client" value={active.client.id} onChange={e => selectClient(e.target.value)}>{state.clients.map(c => <option key={c.id} value={c.id}>{c.code}  /  {c.baseCurrency}</option>)}</select><span className="muted small">Book totals below include {active.client.baseCurrency} portfolios only.</span></div>
        {settings && <MandateForm key={settings + active.client.id} state={state} client={settings === "edit" ? active.client : undefined} onClose={() => setSettings(null)} onSave={(next,id) => {if(!commit(next))return false; setActiveClientId(id); setTrade(t=>({...t,clientId:id,currency:next.clients.find(c=>c.id===id)!.baseCurrency}));setSettings(null);return true;}}/>}
        {!sameCurrency.every(p => p.valuationComplete) && <div className="notice" role="status">Indicative valuation: some holdings use cost or stale prices. P&amp;L, allocations and rebalance values may be incomplete. Review each holding below.</div>}
        <section className="grid kpis">
          <Kpi label={`${sameCurrency.every(p => p.valuationComplete) ? "AUM" : "Indicative AUM"} (${active.client.baseCurrency})`} value={money.format(aum)} />
          <Kpi label="Clients" value={String(state.clients.length)} />
          <Kpi label="Day P&L" value={sameCurrency.every(p => p.dayPnlComplete) ? money.format(totalDayPnl) : "Unavailable"} tone={totalDayPnl>=0?"positive":"negative"} />
          <Kpi label="Total P&L" value={sameCurrency.every(p => p.valuationComplete) ? money.format(totalPnl) : "Unavailable"} tone={totalPnl>=0?"positive":"negative"} />
          <Kpi label="Mandate Breaches" value={summaries.every(p => p.valuationComplete) ? String(breachCount) : "Review prices"} tone={breachCount?"negative":"positive"} />
        </section>

        {tab === "overview" && <div className="grid two">
          <section className="card">
            <div className="section-title"><h2>Client book</h2><span className="muted small">{state.clients.length} mandates</span></div>
            <div className="client-list">{summaries.map((p) => <div key={p.client.id} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==="Enter" || e.key===" "){e.preventDefault();selectClient(p.client.id);}}} aria-pressed={p.client.id===active.client.id} className={`client ${p.client.id===active.client.id?"active":""}`} onClick={() => selectClient(p.client.id)}>
              <div className="client-top"><div><div className="client-code">{p.client.code}</div><div className="muted small">{p.client.label}</div></div><span className="pill">{p.client.riskProfile}</span></div>
              <div style={{marginTop:14,fontSize:20,fontWeight:800}}>{moneyFor(p.client.baseCurrency).format(p.marketValue)}</div>
              <div className="row small" style={{marginTop:7,justifyContent:"space-between"}}><span className="muted">Day {p.dayPnlComplete ? moneyFor(p.client.baseCurrency).format(p.dayPnl) : "Unavailable"}</span><span className={p.totalPnl>=0?"positive":"negative"}>P&L {p.valuationComplete ? moneyFor(p.client.baseCurrency).format(p.totalPnl) : "Unavailable"}</span></div>
            </div>)}</div>
          </section>
          <section className="card">
            <div className="section-title"><h2>{active.client.code} allocation</h2><span className="pill">{active.client.benchmark}</span></div>
            <div className="allocation">{Object.entries(active.allocation).sort((a,b)=>b[1]-a[1]).map(([key,value]) => <div className="alloc-row" key={key}><span>{key}</span><div className="bar"><span style={{width:`${Math.max(0,Math.min(100,value))}%`}} /></div><span className="right">{value.toFixed(1)}%</span></div>)}</div>
          </section>
          <section className="card full">
            <div className="section-title"><h2>{active.client.code} holdings</h2><span className="muted small">{active.holdings.length} securities</span></div>
            <HoldingsTable holdings={active.holdings} quotes={quotes} baseCurrency={active.client.baseCurrency} />
          </section>
        </div>}

        {tab === "portfolio" && <div className="grid two">
          <section className="card">
            <div className="section-title"><h2>Portfolio snapshot</h2><span className="pill">{active.client.riskProfile}</span></div>
            <table><tbody>
              <Metric label="Market value" value={money.format(active.marketValue)} />
              <Metric label="Invested" value={money.format(active.investedValue)} />
              <Metric label="Cash" value={money.format(active.cash)} />
              <Metric label="Cost basis" value={money.format(active.costBasis)} />
              <Metric label="Realised P&L" value={money.format(active.realisedPnl)} />
              <Metric label="Unrealised P&L" value={active.valuationComplete ? money.format(active.unrealisedPnl) : "Unavailable"} />
            </tbody></table>
          </section>
          <section className="card">
            <div className="section-title"><h2>Mandate targets</h2><span className="muted small">Use Edit mandate to update all limits</span></div>
            <table><thead><tr><th>Asset class</th><th className="right">Target</th><th className="right">Actual</th><th className="right">Drift</th></tr></thead><tbody>{activeDrift.map((d)=><tr key={d.assetClass}><td>{d.assetClass}</td><td className="right">{d.targetPct.toFixed(1)}%</td><td className="right">{d.actualPct.toFixed(1)}%</td><td className={`right ${Math.abs(d.driftPct)>5?"negative":""}`}>{pct(d.driftPct)}</td></tr>)}</tbody></table>
          </section>
          <section className="card full"><div className="section-title"><h2>Holdings</h2><span className="muted small">FIFO cost basis</span></div><HoldingsTable holdings={active.holdings} quotes={quotes} baseCurrency={active.client.baseCurrency}/></section>
        </div>}

        {tab === "trades" && <div className="grid two">
          <section className="card">
            <div className="section-title"><h2>Capture execution</h2><span className="pill">GTN reference optional</span></div>
            <form className="form-grid" onSubmit={addTrade}>
              <Field label="Client"><select value={trade.clientId} onChange={(e)=>setTrade({...trade,clientId:e.target.value,currency:state.clients.find(c=>c.id===e.target.value)?.baseCurrency ?? "USD",fxRate:"1"})}>{state.clients.map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select></Field>
              <Field label="Side"><select value={trade.side} onChange={(e)=>setTrade({...trade,side:e.target.value as Side})}><option>BUY</option><option>SELL</option></select></Field>
              <Field label="Symbol"><input required value={trade.symbol} onChange={(e)=>setTrade({...trade,symbol:e.target.value})} placeholder="NVDA" /></Field>
              <Field label="Asset class"><select value={trade.assetClass} onChange={(e)=>setTrade({...trade,assetClass:e.target.value as AssetClass})}>{ASSET_CLASSES.filter(x=>x!=="Cash").map(x=><option key={x}>{x}</option>)}</select></Field>
              <Field label="Quantity"><input required type="number" step="any" value={trade.quantity} onChange={(e)=>setTrade({...trade,quantity:e.target.value})} /></Field>
              <Field label="Execution price"><input required type="number" step="any" value={trade.price} onChange={(e)=>setTrade({...trade,price:e.target.value})} /></Field>
              <Field label="Fees"><input type="number" step="any" value={trade.fees} onChange={(e)=>setTrade({...trade,fees:e.target.value})} /></Field>
              <Field label="Quote currency"><input required maxLength={3} value={trade.currency} onChange={e=>setTrade({...trade,currency:e.target.value.toUpperCase()})}/></Field>
              <Field label="Execution sequence (optional)"><input type="number" min="1" step="1" value={trade.sequence} onChange={e=>setTrade({...trade,sequence:e.target.value})} placeholder="Auto: after existing trades"/></Field>
              <Field label="FX rate to base"><input type="number" step="any" value={trade.fxRate} onChange={(e)=>setTrade({...trade,fxRate:e.target.value})} /></Field>
              <Field label="Trade date"><input type="date" value={trade.tradeDate} onChange={(e)=>setTrade({...trade,tradeDate:e.target.value})} /></Field>
              <Field label="GTN ref"><input value={trade.gtnRef} onChange={(e)=>setTrade({...trade,gtnRef:e.target.value})} placeholder="optional" /></Field>
              <Field label="Security name"><input value={trade.name} onChange={(e)=>setTrade({...trade,name:e.target.value})} placeholder="optional" /></Field>
              <div className="field" style={{alignSelf:"end"}}><button className="btn primary" type="submit">Add execution</button></div>
            </form>
          </section>
          <section className="card">
            <div className="section-title"><h2>{active.client.code} transaction blotter</h2><span className="muted small">{clientTrades.length} rows</span></div>
            <table><thead><tr><th>Date / sequence</th><th>Side</th><th>Symbol</th><th className="right">Qty</th><th className="right">Price</th><th>Ref</th><th></th></tr></thead><tbody>{clientTrades.map(t=><tr key={t.id}><td>{t.tradeDate} / {t.sequence}</td><td><span className={`pill ${t.side==="BUY"?"good":"warn"}`}>{t.side}</span></td><td className="mono">{t.symbol}</td><td className="right">{num.format(t.quantity)}</td><td className="right">{num.format(t.price)}</td><td className="muted">{t.gtnRef||"-"}</td><td className="right"><button className="btn danger" aria-label={`Delete ${t.symbol} execution ${t.sequence}`} onClick={()=>deleteTrade(t.id)}>Delete</button></td></tr>)}</tbody></table>
          </section>
        </div>}

        {tab === "rebalance" && <section className="card">
          <div className="section-title"><h2>{active.client.code} rebalance worksheet</h2><span className="muted small">Target value minus current value</span></div>
          <table><thead><tr><th>Asset class</th><th className="right">Target</th><th className="right">Actual</th><th className="right">Drift</th><th className="right">Indicative action</th><th>Status</th></tr></thead><tbody>{activeDrift.map(d=><tr key={d.assetClass}><td>{d.assetClass}</td><td className="right">{d.targetPct.toFixed(1)}%</td><td className="right">{d.actualPct.toFixed(1)}%</td><td className={`right ${d.breach?"negative":""}`}>{pct(d.driftPct)}</td><td className={`right ${d.tradeValue>=0?"positive":"negative"}`}>{d.tradeValue>=0?"BUY ":"SELL "}{money.format(Math.abs(d.tradeValue))}</td><td>{!active.valuationComplete?<span className="pill warn">REVIEW PRICES</span>:d.breach?<span className="pill warn">BREACH</span>:<span className="pill good">IN RANGE</span>}</td></tr>)}</tbody></table>
        </section>}
      </div>
    </main>
  );
}

function Kpi({label,value,tone}:{label:string;value:string;tone?:string}) { return <div className="card kpi"><div className="label">{label}</div><div className={`value ${tone??""}`}>{value}</div></div>; }
function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="field"><span>{label}</span>{children}</label>; }
function Metric({label,value}:{label:string;value:string}) { return <tr><td className="muted">{label}</td><td className="right" style={{fontWeight:700}}>{value}</td></tr>; }
function HoldingsTable({holdings,quotes,baseCurrency}:{baseCurrency:string;holdings:ReturnType<typeof buildPortfolio>["holdings"];quotes:Record<string,Quote>}) {
  const money = moneyFor(baseCurrency);
  if (!holdings.length) return <div className="empty">No open positions</div>;
  return <table><thead><tr><th>Security</th><th>Class</th><th className="right">Qty</th><th className="right">Avg cost</th><th className="right">Price</th><th className="right">Value</th><th className="right">Weight</th><th className="right">Unreal. P&L</th><th className="right">Day</th></tr></thead><tbody>{holdings.map(h=>{const q=quotes[h.symbol];return <tr key={h.symbol}><td><strong className="mono">{h.symbol}</strong>{h.name&&<div className="muted small">{h.name}</div>}</td><td>{h.assetClass}</td><td className="right">{num.format(h.quantity)}</td><td className="right">{num.format(h.averageCost)}</td><td className="right">{num.format(h.marketPrice)}<div className="muted small">{baseCurrency}  /  {h.valuationStatus === "cost" ? "COST ONLY" : h.valuationStatus === "stale" ? "STALE" : "Market quote"}</div><div className="muted small">{h.valuationNote}</div>{q && <div className="muted small">{q.currency}  /  {new Date(q.asOf).toLocaleString()}</div>}</td><td className="right">{money.format(h.marketValue)}</td><td className="right">{h.weight.toFixed(1)}%</td><td className={`right ${h.unrealisedPnl>=0?"positive":"negative"}`}>{h.valuationStatus === "cost" ? "Unavailable" : money.format(h.unrealisedPnl)}</td><td className={`right ${(q?.changePct??0)>=0?"positive":"negative"}`}>{h.valuationStatus !== "cost" && q?.changePct!=null?pct(q.changePct):"-"}</td></tr>})}</tbody></table>;
}
