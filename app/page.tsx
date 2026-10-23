"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { aggregateAum, buildPortfolio, driftForClient } from "@/lib/portfolio";
import { exportState, importState, loadState, saveState, seedState } from "@/lib/storage";
import { AssetClass, DpmState, Quote, Side, Transaction } from "@/lib/types";

const ASSET_CLASSES: AssetClass[] = ["US Equity","UAE Equity","ETF","Bond/Sukuk","Crypto","Metal","Cash","Other"];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function Home() {
  const [state, setState] = useState<DpmState>(seedState);
  const [ready, setReady] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [quoteStatus, setQuoteStatus] = useState<"idle"|"loading"|"ok"|"partial">("idle");
  const [activeClientId, setActiveClientId] = useState("c001");
  const [tab, setTab] = useState<"overview"|"portfolio"|"trades"|"rebalance">("overview");
  const [trade, setTrade] = useState({ clientId: "c001", symbol: "", name: "", assetClass: "US Equity" as AssetClass, side: "BUY" as Side, quantity: "", price: "", fees: "0", fxRate: "1", tradeDate: new Date().toISOString().slice(0,10), gtnRef: "" });

  useEffect(() => {
    const loaded = loadState();
    setState(loaded);
    setActiveClientId(loaded.clients[0]?.id ?? "");
    setTrade((t) => ({ ...t, clientId: loaded.clients[0]?.id ?? "" }));
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveState(state);
  }, [state, ready]);

  const symbols = useMemo(() => Array.from(new Set(state.transactions.map((t) => t.symbol.toUpperCase()))).sort(), [state.transactions]);

  async function refreshQuotes() {
    if (!symbols.length) return;
    setQuoteStatus("loading");
    try {
      const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, { cache: "no-store" });
      const data = await response.json();
      setQuotes(data.quotes ?? {});
      setQuoteStatus(Object.keys(data.errors ?? {}).length ? "partial" : "ok");
    } catch {
      setQuoteStatus("partial");
    }
  }

  useEffect(() => {
    if (!ready || !symbols.length) return;
    refreshQuotes();
    const timer = window.setInterval(refreshQuotes, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [ready, symbols.join("|")]);

  const summaries = useMemo(() => state.clients.map((client) => buildPortfolio(client, state, quotes)), [state, quotes]);
  const active = summaries.find((p) => p.client.id === activeClientId) ?? summaries[0];
  const activeDrift = active ? driftForClient(state, active) : [];
  const aum = aggregateAum(summaries);
  const totalDayPnl = summaries.reduce((s,p) => s + p.dayPnl, 0);
  const totalPnl = summaries.reduce((s,p) => s + p.totalPnl, 0);
  const breachCount = summaries.reduce((count,p) => count + driftForClient(state,p).filter((d) => d.breach).length, 0);

  function selectClient(id: string) {
    setActiveClientId(id);
    setTrade((t) => ({ ...t, clientId: id }));
  }

  function addTrade(e: FormEvent) {
    e.preventDefault();
    const quantity = Number(trade.quantity);
    const price = Number(trade.price);
    if (!trade.clientId || !trade.symbol || quantity <= 0 || price < 0) return;
    const tx: Transaction = {
      id: uid("tx"),
      clientId: trade.clientId,
      symbol: trade.symbol.trim().toUpperCase(),
      name: trade.name.trim() || undefined,
      assetClass: trade.assetClass,
      side: trade.side,
      quantity,
      price,
      fees: Number(trade.fees) || 0,
      fxRate: Number(trade.fxRate) || 1,
      tradeDate: trade.tradeDate,
      gtnRef: trade.gtnRef.trim() || undefined,
    };
    setState((s) => ({ ...s, transactions: [...s.transactions, tx] }));
    setTrade((t) => ({ ...t, symbol: "", name: "", quantity: "", price: "", fees: "0", gtnRef: "" }));
  }

  function deleteTrade(id: string) {
    if (!window.confirm("Delete this transaction?")) return;
    setState((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) }));
  }

  function addClient() {
    const code = window.prompt("Client code (use an anonymised code, e.g. C003)");
    if (!code?.trim()) return;
    const id = uid("client");
    const client = { id, code: code.trim().toUpperCase(), label: "New Mandate", baseCurrency: "USD", benchmark: "SPY", riskProfile: "Balanced" as const, initialCash: 0 };
    setState((s) => ({ ...s, clients: [...s.clients, client] }));
    selectClient(id);
  }

  function setTarget(assetClass: AssetClass, targetPct: number) {
    if (!active) return;
    setState((s) => {
      const exists = s.targets.some((t) => t.clientId === active.client.id && t.assetClass === assetClass);
      return {
        ...s,
        targets: exists
          ? s.targets.map((t) => t.clientId === active.client.id && t.assetClass === assetClass ? { ...t, targetPct } : t)
          : [...s.targets, { clientId: active.client.id, assetClass, targetPct }],
      };
    });
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importState(file);
      setState(imported);
      selectClient(imported.clients[0]?.id ?? "");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Import failed");
    }
    e.target.value = "";
  }

  if (!ready || !active) return <main className="app"><div className="container">Loading DPM Desk...</div></main>;

  const clientTrades = state.transactions.filter((t) => t.clientId === active.client.id).slice().sort((a,b) => b.tradeDate.localeCompare(a.tradeDate));

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand"><div className="brandmark">D</div><div><h1>DPM Desk</h1><div className="muted small">Private portfolio operating workbench</div></div></div>
        <div className="row">
          <span className="status"><span className={`dot ${quoteStatus === "partial" ? "off" : ""}`} />{quoteStatus === "loading" ? "Refreshing prices" : quoteStatus === "ok" ? "Market data live" : quoteStatus === "partial" ? "Partial market data" : "Local data ready"}</span>
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
            <button className="btn" onClick={addClient}>+ Client</button>
            <button className="btn" onClick={() => exportState(state)}>Backup</button>
            <label className="btn">Restore<input type="file" accept="application/json" onChange={onImport} style={{display:"none"}} /></label>
          </div>
        </div>

        <section className="grid kpis">
          <Kpi label="Total AUM" value={money.format(aum)} />
          <Kpi label="Clients" value={String(state.clients.length)} />
          <Kpi label="Day P&L" value={money.format(totalDayPnl)} tone={totalDayPnl>=0?"positive":"negative"} />
          <Kpi label="Total P&L" value={money.format(totalPnl)} tone={totalPnl>=0?"positive":"negative"} />
          <Kpi label="Mandate Breaches" value={String(breachCount)} tone={breachCount?"negative":"positive"} />
        </section>

        {tab === "overview" && <div className="grid two">
          <section className="card">
            <div className="section-title"><h2>Client book</h2><span className="muted small">{state.clients.length} mandates</span></div>
            <div className="client-list">{summaries.map((p) => <div key={p.client.id} className={`client ${p.client.id===active.client.id?"active":""}`} onClick={() => selectClient(p.client.id)}>
              <div className="client-top"><div><div className="client-code">{p.client.code}</div><div className="muted small">{p.client.label}</div></div><span className="pill">{p.client.riskProfile}</span></div>
              <div style={{marginTop:14,fontSize:20,fontWeight:800}}>{money.format(p.marketValue)}</div>
              <div className="row small" style={{marginTop:7,justifyContent:"space-between"}}><span className="muted">Day {money.format(p.dayPnl)}</span><span className={p.totalPnl>=0?"positive":"negative"}>P&L {money.format(p.totalPnl)}</span></div>
            </div>)}</div>
          </section>
          <section className="card">
            <div className="section-title"><h2>{active.client.code} allocation</h2><span className="pill">{active.client.benchmark}</span></div>
            <div className="allocation">{Object.entries(active.allocation).sort((a,b)=>b[1]-a[1]).map(([key,value]) => <div className="alloc-row" key={key}><span>{key}</span><div className="bar"><span style={{width:`${Math.max(0,Math.min(100,value))}%`}} /></div><span className="right">{value.toFixed(1)}%</span></div>)}</div>
          </section>
          <section className="card full">
            <div className="section-title"><h2>{active.client.code} holdings</h2><span className="muted small">{active.holdings.length} securities</span></div>
            <HoldingsTable holdings={active.holdings} quotes={quotes} />
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
              <Metric label="Unrealised P&L" value={money.format(active.unrealisedPnl)} />
            </tbody></table>
          </section>
          <section className="card">
            <div className="section-title"><h2>Mandate targets</h2><span className="muted small">editable</span></div>
            <table><thead><tr><th>Asset class</th><th className="right">Target</th><th className="right">Actual</th><th className="right">Drift</th></tr></thead><tbody>{activeDrift.map((d)=><tr key={d.assetClass}><td>{d.assetClass}</td><td className="right"><input style={{width:68}} type="number" value={d.targetPct} onChange={(e)=>setTarget(d.assetClass,Number(e.target.value))}/></td><td className="right">{d.actualPct.toFixed(1)}%</td><td className={`right ${Math.abs(d.driftPct)>5?"negative":""}`}>{pct(d.driftPct)}</td></tr>)}</tbody></table>
          </section>
          <section className="card full"><div className="section-title"><h2>Holdings</h2><span className="muted small">FIFO cost basis</span></div><HoldingsTable holdings={active.holdings} quotes={quotes}/></section>
        </div>}

        {tab === "trades" && <div className="grid two">
          <section className="card">
            <div className="section-title"><h2>Capture execution</h2><span className="pill">GTN reference optional</span></div>
            <form className="form-grid" onSubmit={addTrade}>
              <Field label="Client"><select value={trade.clientId} onChange={(e)=>setTrade({...trade,clientId:e.target.value})}>{state.clients.map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select></Field>
              <Field label="Side"><select value={trade.side} onChange={(e)=>setTrade({...trade,side:e.target.value as Side})}><option>BUY</option><option>SELL</option></select></Field>
              <Field label="Symbol"><input required value={trade.symbol} onChange={(e)=>setTrade({...trade,symbol:e.target.value})} placeholder="NVDA" /></Field>
              <Field label="Asset class"><select value={trade.assetClass} onChange={(e)=>setTrade({...trade,assetClass:e.target.value as AssetClass})}>{ASSET_CLASSES.filter(x=>x!=="Cash").map(x=><option key={x}>{x}</option>)}</select></Field>
              <Field label="Quantity"><input required type="number" step="any" value={trade.quantity} onChange={(e)=>setTrade({...trade,quantity:e.target.value})} /></Field>
              <Field label="Execution price"><input required type="number" step="any" value={trade.price} onChange={(e)=>setTrade({...trade,price:e.target.value})} /></Field>
              <Field label="Fees"><input type="number" step="any" value={trade.fees} onChange={(e)=>setTrade({...trade,fees:e.target.value})} /></Field>
              <Field label="FX rate to base"><input type="number" step="any" value={trade.fxRate} onChange={(e)=>setTrade({...trade,fxRate:e.target.value})} /></Field>
              <Field label="Trade date"><input type="date" value={trade.tradeDate} onChange={(e)=>setTrade({...trade,tradeDate:e.target.value})} /></Field>
              <Field label="GTN ref"><input value={trade.gtnRef} onChange={(e)=>setTrade({...trade,gtnRef:e.target.value})} placeholder="optional" /></Field>
              <Field label="Security name"><input value={trade.name} onChange={(e)=>setTrade({...trade,name:e.target.value})} placeholder="optional" /></Field>
              <div className="field" style={{alignSelf:"end"}}><button className="btn primary" type="submit">Add execution</button></div>
            </form>
          </section>
          <section className="card">
            <div className="section-title"><h2>{active.client.code} transaction blotter</h2><span className="muted small">{clientTrades.length} rows</span></div>
            <table><thead><tr><th>Date</th><th>Side</th><th>Symbol</th><th className="right">Qty</th><th className="right">Price</th><th>Ref</th><th></th></tr></thead><tbody>{clientTrades.map(t=><tr key={t.id}><td>{t.tradeDate}</td><td><span className={`pill ${t.side==="BUY"?"good":"warn"}`}>{t.side}</span></td><td className="mono">{t.symbol}</td><td className="right">{num.format(t.quantity)}</td><td className="right">{num.format(t.price)}</td><td className="muted">{t.gtnRef||"-"}</td><td className="right"><button className="btn danger" onClick={()=>deleteTrade(t.id)}>×</button></td></tr>)}</tbody></table>
          </section>
        </div>}

        {tab === "rebalance" && <section className="card">
          <div className="section-title"><h2>{active.client.code} rebalance worksheet</h2><span className="muted small">Target value minus current value</span></div>
          <table><thead><tr><th>Asset class</th><th className="right">Target</th><th className="right">Actual</th><th className="right">Drift</th><th className="right">Indicative action</th><th>Status</th></tr></thead><tbody>{activeDrift.map(d=><tr key={d.assetClass}><td>{d.assetClass}</td><td className="right">{d.targetPct.toFixed(1)}%</td><td className="right">{d.actualPct.toFixed(1)}%</td><td className={`right ${d.breach?"negative":""}`}>{pct(d.driftPct)}</td><td className={`right ${d.tradeValue>=0?"positive":"negative"}`}>{d.tradeValue>=0?"BUY ":"SELL "}{money.format(Math.abs(d.tradeValue))}</td><td>{d.breach?<span className="pill warn">BREACH</span>:<span className="pill good">IN RANGE</span>}</td></tr>)}</tbody></table>
        </section>}
      </div>
    </main>
  );
}

function Kpi({label,value,tone}:{label:string;value:string;tone?:string}) { return <div className="card kpi"><div className="label">{label}</div><div className={`value ${tone??""}`}>{value}</div></div>; }
function Field({label,children}:{label:string;children:React.ReactNode}) { return <div className="field"><label>{label}</label>{children}</div>; }
function Metric({label,value}:{label:string;value:string}) { return <tr><td className="muted">{label}</td><td className="right" style={{fontWeight:700}}>{value}</td></tr>; }
function HoldingsTable({holdings,quotes}:{holdings:ReturnType<typeof buildPortfolio>["holdings"];quotes:Record<string,Quote>}) {
  if (!holdings.length) return <div className="empty">No open positions</div>;
  return <table><thead><tr><th>Security</th><th>Class</th><th className="right">Qty</th><th className="right">Avg cost</th><th className="right">Price</th><th className="right">Value</th><th className="right">Weight</th><th className="right">Unreal. P&L</th><th className="right">Day</th></tr></thead><tbody>{holdings.map(h=>{const q=quotes[h.symbol];return <tr key={h.symbol}><td><strong className="mono">{h.symbol}</strong>{h.name&&<div className="muted small">{h.name}</div>}</td><td>{h.assetClass}</td><td className="right">{num.format(h.quantity)}</td><td className="right">{num.format(h.averageCost)}</td><td className="right">{num.format(h.marketPrice)}</td><td className="right">{money.format(h.marketValue)}</td><td className="right">{h.weight.toFixed(1)}%</td><td className={`right ${h.unrealisedPnl>=0?"positive":"negative"}`}>{money.format(h.unrealisedPnl)}</td><td className={`right ${(q?.changePct??0)>=0?"positive":"negative"}`}>{q?.changePct!=null?pct(q.changePct):"-"}</td></tr>})}</tbody></table>;
}
