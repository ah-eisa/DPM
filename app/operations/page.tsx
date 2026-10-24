"use client";

import { WorkspaceLinks } from "../workspace-links";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { importGtnCsv, allocateMasterExecution, maxLedgerSequence } from "@/lib/operations";
import { downloadSavedBook, importState, loadState, recoverState, saveState, seedState } from "@/lib/storage";
import { AssetClass, CashMovement, CashMovementKind, CorporateAction, CorporateActionKind, DpmState, Side } from "@/lib/types";
import { ASSET_CLASSES, validateState } from "@/lib/validation";

const CASH_KINDS: CashMovementKind[] = ["DEPOSIT","WITHDRAWAL","DIVIDEND","COUPON","INTEREST","FEE","TAX","OTHER"];
const ACTION_KINDS: CorporateActionKind[] = ["SPLIT","REVERSE_SPLIT","STOCK_DIVIDEND"];
const today = () => new Date().toISOString().slice(0,10);
const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

export default function OperationsPage() {
  const [state, setState] = useState<DpmState>(seedState);
  const [ready, setReady] = useState(false);
  const [loadBlocked, setLoadBlocked] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState<"dark"|"light">("dark");
  const [cash, setCash] = useState({clientId:"c001",accountId:"",kind:"DEPOSIT" as CashMovementKind,amount:"",currency:"USD",fxRate:"1",movementDate:today(),symbol:"",reference:"",notes:""});
  const [action, setAction] = useState({clientId:"c001",accountId:"",securityId:"",kind:"SPLIT" as CorporateActionKind,symbol:"",factor:"2",actionDate:today(),reference:"",notes:""});
  const [master, setMaster] = useState({symbol:"",name:"",assetClass:"US Equity" as AssetClass,side:"BUY" as Side,totalQuantity:"",price:"",fees:"0",currency:"USD",fxRate:"1",tradeDate:today(),gtnRef:"",notes:""});
  const [allocations, setAllocations] = useState<Record<string,string>>({});

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    void (async()=>{try {
      const book = await loadState();
      adoptLoadedBook(book);
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
      setLoadBlocked(true);
      setReady(true);
    }})();
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem("dpm-desk-theme", next); } catch { /* Visual toggle still works. */ }
  }

  function adoptLoadedBook(book: DpmState) {
    setState(book);
    const first = book.clients[0];
    if (first) {
      setCash(c => ({...c,clientId:first.id,currency:first.baseCurrency,fxRate:"1"}));
      setAction(a => ({...a,clientId:first.id}));
      setMaster(m => ({...m,currency:first.baseCurrency,fxRate:"1"}));
    }
    setLoadBlocked(false); setError("");
  }

  async function commit(next: DpmState, ok: string) {
    if (loadBlocked) { setError("Writes are blocked until the saved book is successfully restored or imported."); return false; }
    try {
      const valid = await saveState(validateState(next));
      setState(valid);
      setError(""); setMessage(ok);
      return true;
    } catch (e) { setError((e as Error).message); setMessage(""); return false; }
  }

  async function restoreBackup(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const imported = await importState(file);
      const saved = await saveState(imported,{expectedRevision:state.revision ?? 0,recovery:loadBlocked});
      adoptLoadedBook(saved);
      setMessage("Validated backup restored");
    } catch (err) { setError(err instanceof Error ? err.message : "Restore failed"); }
    e.target.value = "";
  }

  async function recoverPrevious() {
    try {
      const previous = await recoverState();
      const saved = await saveState(previous,{expectedRevision:state.revision ?? 0,recovery:loadBlocked});
      adoptLoadedBook(saved);
      setMessage("Previous validated save recovered");
    } catch (e) { setError((e as Error).message); }
  }

  const clientById = useMemo(() => new Map(state.clients.map(c => [c.id,c])), [state.clients]);
  const activeCashClient = clientById.get(cash.clientId);

  async function addCash(e: FormEvent) {
    e.preventDefault(); if (!activeCashClient) return;
    const item: CashMovement = { id:uid("cash"),clientId:cash.clientId,...(cash.accountId?{accountId:cash.accountId}:{}),sequence:maxLedgerSequence(state)+1,kind:cash.kind,amount:Number(cash.amount),currency:cash.currency.toUpperCase(),fxRate:Number(cash.fxRate),movementDate:cash.movementDate,symbol:cash.symbol.trim().toUpperCase()||undefined,reference:cash.reference.trim()||undefined,notes:cash.notes.trim()||undefined };
    if (await commit({...state,cashMovements:[...state.cashMovements,item]}, `${cash.kind} recorded`)) setCash(c=>({...c,amount:"",symbol:"",reference:"",notes:""}));
  }

  async function addAction(e: FormEvent) {
    e.preventDefault();
    const item: CorporateAction = { id:uid("ca"),clientId:action.clientId,...(action.securityId?{securityId:action.securityId}:{}),...(action.accountId?{accountId:action.accountId}:{}),sequence:maxLedgerSequence(state)+1,kind:action.kind,symbol:action.symbol.trim().toUpperCase(),actionDate:action.actionDate,factor:Number(action.factor),reference:action.reference.trim()||undefined,notes:action.notes.trim()||undefined };
    if (await commit({...state,corporateActions:[...state.corporateActions,item]}, `${action.kind} recorded`)) setAction(a=>({...a,symbol:"",reference:"",notes:""}));
  }

  async function addBulk(e: FormEvent) {
    e.preventDefault();
    try {
      const txs = allocateMasterExecution(state,{symbol:master.symbol,name:master.name||undefined,assetClass:master.assetClass,side:master.side,totalQuantity:Number(master.totalQuantity),price:Number(master.price),fees:Number(master.fees),currency:master.currency,fxRate:Number(master.fxRate),tradeDate:master.tradeDate,gtnRef:master.gtnRef||undefined,notes:master.notes||undefined},Object.entries(allocations).filter(([,q])=>Number(q)>0).map(([clientId,q])=>({clientId,quantity:Number(q)})));
      if (await commit({...state,transactions:[...state.transactions,...txs]}, `Master execution allocated to ${txs.length} clients`)) { setMaster(m=>({...m,symbol:"",name:"",totalQuantity:"",price:"",fees:"0",gtnRef:"",notes:""})); setAllocations({}); }
    } catch (e) { setError((e as Error).message); setMessage(""); }
  }

  async function onCsv(e: ChangeEvent<HTMLInputElement>) {
    const file=e.target.files?.[0]; if(!file) return;
    try {
      const txs=importGtnCsv(await file.text(),state);
      if (!window.confirm(`Import ${txs.length} validated GTN executions?`)) return;
      await commit({...state,transactions:[...state.transactions,...txs]}, `${txs.length} GTN executions imported`);
    } catch(err){setError(err instanceof Error?err.message:"GTN import failed");setMessage("");}
    e.target.value="";
  }

  function removeCash(id:string){if(window.confirm("Delete this cash movement?"))commit({...state,cashMovements:state.cashMovements.filter(x=>x.id!==id)},"Cash movement deleted");}
  function removeAction(id:string){if(window.confirm("Delete this corporate action?"))commit({...state,corporateActions:state.corporateActions.filter(x=>x.id!==id)},"Corporate action deleted");}

  if(!ready) return <main className="app"><div className="container">Loading operations...</div></main>;

  if(loadBlocked) return <main className="app">
    <header className="topbar operations-topbar"><div className="brand"><div className="brandmark">O</div><div><h1>DPM Operations</h1><div className="muted small">Recovery mode</div></div></div><div className="row"><button className="btn" onClick={toggleTheme}>{theme==="dark"?"Light mode":"Dark mode"}</button><WorkspaceLinks current="/operations" /></div></header>
    <div className="container"><section className="card"><h2>Saved book could not be loaded</h2><div className="notice negative" role="alert">{error}</div><p className="muted">All operational writes are blocked. The demo state is not writable and will not replace the saved book.</p><div className="row"><button className="btn" onClick={async()=>{try{await downloadSavedBook();}catch(e){setError((e as Error).message);}}}>Download original saved book</button><button className="btn" onClick={recoverPrevious}>Recover previous save</button><label className="btn primary">Restore validated backup<input hidden type="file" accept="application/json" onChange={restoreBackup}/></label></div></section></div>
  </main>;

  return <main className="app">
    <header className="topbar operations-topbar"><div className="brand"><div className="brandmark">O</div><div><h1>DPM Operations</h1><div className="muted small">Cash, corporate actions, bulk allocation and GTN import</div></div></div><div className="row"><button className="btn" onClick={toggleTheme}>{theme==="dark"?"Light mode":"Dark mode"}</button><WorkspaceLinks current="/operations" /></div></header>
    <div className="container">
      <div className="notice">All entries are validated against cash, holdings, currencies and one global ledger sequence before they are saved.</div>
      {error&&<div className="notice negative" role="alert">{error}</div>}{message&&<div className="notice positive" role="status">{message}</div>}
      <div className="grid two">
        <section className="card"><div className="section-title"><h2>Cash ledger</h2><span className="pill">Base-currency accounting</span></div><form className="form-grid" onSubmit={addCash}>
          <Field label="Client"><select value={cash.clientId} onChange={e=>{const c=clientById.get(e.target.value);setCash({...cash,clientId:e.target.value,accountId:"",currency:c?.baseCurrency??"USD",fxRate:"1"});}}>{state.clients.map(c=><option key={c.id} value={c.id}>{c.code} / {c.baseCurrency}</option>)}</select></Field>
          <Field label="Account"><select value={cash.accountId} onChange={e=>setCash({...cash,accountId:e.target.value})}><option value="">Primary account</option>{state.controls?.accounts.filter(a=>a.clientId===cash.clientId).map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></Field><Field label="Type"><select value={cash.kind} onChange={e=>setCash({...cash,kind:e.target.value as CashMovementKind})}>{CASH_KINDS.map(k=><option key={k}>{k}</option>)}</select></Field>
          <Field label="Amount"><input required type="number" min="0" step="any" value={cash.amount} onChange={e=>setCash({...cash,amount:e.target.value})}/></Field><Field label="Currency"><input required maxLength={3} value={cash.currency} onChange={e=>setCash({...cash,currency:e.target.value.toUpperCase()})}/></Field><Field label="FX to base"><input required type="number" min="0" step="any" value={cash.fxRate} onChange={e=>setCash({...cash,fxRate:e.target.value})}/></Field><Field label="Date"><input required type="date" value={cash.movementDate} onChange={e=>setCash({...cash,movementDate:e.target.value})}/></Field><Field label="Symbol (optional)"><input value={cash.symbol} onChange={e=>setCash({...cash,symbol:e.target.value})} placeholder="AAPL"/></Field><Field label="Reference"><input value={cash.reference} onChange={e=>setCash({...cash,reference:e.target.value})}/></Field><Field label="Notes"><input value={cash.notes} onChange={e=>setCash({...cash,notes:e.target.value})}/></Field><div className="field" style={{alignSelf:"end"}}><button className="btn primary">Add cash entry</button></div>
        </form></section>

        <section className="card"><div className="section-title"><h2>Corporate action</h2><span className="pill">Quantity multiplier</span></div><form className="form-grid" onSubmit={addAction}>
          <Field label="Client"><select value={action.clientId} onChange={e=>setAction({...action,clientId:e.target.value,accountId:""})}>{state.clients.map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select></Field><Field label="Account"><select value={action.accountId} onChange={e=>setAction({...action,accountId:e.target.value})}><option value="">Primary account</option>{state.controls?.accounts.filter(a=>a.clientId===action.clientId).map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></Field><Field label="Security Master instrument"><select value={action.securityId} onChange={e=>{const security=state.controls?.securities.find(s=>s.id===e.target.value);setAction({...action,securityId:e.target.value,symbol:security?.symbol??action.symbol});}}><option value="">Resolve symbol</option>{state.controls?.securities.map(s=><option key={s.id} value={s.id}>{s.name} / {s.exchange}</option>)}</select></Field><Field label="Action"><select value={action.kind} onChange={e=>setAction({...action,kind:e.target.value as CorporateActionKind})}>{ACTION_KINDS.map(k=><option key={k}>{k}</option>)}</select></Field><Field label="Symbol"><input required value={action.symbol} onChange={e=>setAction({...action,symbol:e.target.value})}/></Field><Field label="Factor"><input required type="number" min="0" step="any" value={action.factor} onChange={e=>setAction({...action,factor:e.target.value})}/></Field><Field label="Date"><input required type="date" value={action.actionDate} onChange={e=>setAction({...action,actionDate:e.target.value})}/></Field><Field label="Reference"><input value={action.reference} onChange={e=>setAction({...action,reference:e.target.value})}/></Field><Field label="Notes"><input value={action.notes} onChange={e=>setAction({...action,notes:e.target.value})}/></Field><div className="field" style={{alignSelf:"end"}}><button className="btn primary">Apply action</button></div>
        </form><p className="muted small">2-for-1 split = 2.0, 1-for-2 reverse split = 0.5, 10% stock dividend = 1.1. Cost basis is preserved.</p></section>

        <section className="card full"><div className="section-title"><h2>Master trade allocation</h2><span className="pill">One execution → many clients</span></div><form onSubmit={addBulk}><div className="form-grid">
          <Field label="Side"><select value={master.side} onChange={e=>setMaster({...master,side:e.target.value as Side})}><option>BUY</option><option>SELL</option></select></Field><Field label="Symbol"><input required value={master.symbol} onChange={e=>setMaster({...master,symbol:e.target.value})}/></Field><Field label="Name"><input value={master.name} onChange={e=>setMaster({...master,name:e.target.value})}/></Field><Field label="Asset class"><select value={master.assetClass} onChange={e=>setMaster({...master,assetClass:e.target.value as AssetClass})}>{ASSET_CLASSES.filter(x=>x!=="Cash").map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Master quantity"><input required type="number" min="0" step="any" value={master.totalQuantity} onChange={e=>setMaster({...master,totalQuantity:e.target.value})}/></Field><Field label="Execution price"><input required type="number" min="0" step="any" value={master.price} onChange={e=>setMaster({...master,price:e.target.value})}/></Field><Field label="Total fees"><input required type="number" min="0" step="any" value={master.fees} onChange={e=>setMaster({...master,fees:e.target.value})}/></Field><Field label="Currency"><input required maxLength={3} value={master.currency} onChange={e=>setMaster({...master,currency:e.target.value.toUpperCase()})}/></Field><Field label="FX to base"><input required type="number" min="0" step="any" value={master.fxRate} onChange={e=>setMaster({...master,fxRate:e.target.value})}/></Field><Field label="Trade date"><input required type="date" value={master.tradeDate} onChange={e=>setMaster({...master,tradeDate:e.target.value})}/></Field><Field label="GTN ref"><input value={master.gtnRef} onChange={e=>setMaster({...master,gtnRef:e.target.value})}/></Field><Field label="Notes"><input value={master.notes} onChange={e=>setMaster({...master,notes:e.target.value})}/></Field>
        </div><div className="table-scroll" style={{marginTop:16}}><table><thead><tr><th>Client</th><th>Base</th><th className="right">Allocated quantity</th></tr></thead><tbody>{state.clients.map(c=><tr key={c.id}><td>{c.code}</td><td>{c.baseCurrency}</td><td className="right"><input style={{width:140}} type="number" min="0" step="any" value={allocations[c.id]??""} onChange={e=>setAllocations({...allocations,[c.id]:e.target.value})}/></td></tr>)}</tbody></table></div><div className="row" style={{justifyContent:"space-between",marginTop:14}}><span className="muted small">Allocated: {Object.values(allocations).reduce((s,q)=>s+(Number(q)||0),0)} / {Number(master.totalQuantity)||0}</span><button className="btn primary">Allocate execution</button></div></form></section>

        <section className="card full"><div className="section-title"><h2>GTN CSV import</h2><label className="btn primary">Choose CSV<input hidden type="file" accept=".csv,text/csv" onChange={onCsv}/></label></div><p className="muted">Strict validated import. Client/Account, Side, Symbol/Ticker, Quantity/Qty, Price, Fees/Commission, Currency, FX Rate, Trade Date, GTN Ref, Asset Class and Security Name aliases are supported.</p><p className="muted small">Duplicate GTN references are rejected. Rows without a GTN reference are fingerprinted by client/date/side/symbol/quantity/price/fees/currency/FX and exact probable duplicates are blocked.</p></section>

        <section className="card"><div className="section-title"><h2>Recent cash entries</h2><span className="muted small">{state.cashMovements.length}</span></div><div className="table-scroll"><table><thead><tr><th>Date</th><th>Client</th><th>Type</th><th className="right">Amount</th><th></th></tr></thead><tbody>{[...state.cashMovements].sort((a,b)=>b.sequence-a.sequence).slice(0,20).map(m=><tr key={m.id}><td>{m.movementDate}</td><td>{clientById.get(m.clientId)?.code}</td><td>{m.kind}</td><td className="right">{m.amount} {m.currency}</td><td className="right"><button className="btn danger" onClick={()=>removeCash(m.id)}>Delete</button></td></tr>)}</tbody></table></div></section>
        <section className="card"><div className="section-title"><h2>Corporate actions</h2><span className="muted small">{state.corporateActions.length}</span></div><div className="table-scroll"><table><thead><tr><th>Date</th><th>Client</th><th>Symbol</th><th>Action</th><th className="right">Factor</th><th></th></tr></thead><tbody>{[...state.corporateActions].sort((a,b)=>b.sequence-a.sequence).slice(0,20).map(a=><tr key={a.id}><td>{a.actionDate}</td><td>{clientById.get(a.clientId)?.code}</td><td>{a.symbol}</td><td>{a.kind}</td><td className="right">{a.factor}</td><td className="right"><button className="btn danger" onClick={()=>removeAction(a.id)}>Delete</button></td></tr>)}</tbody></table></div></section>
      </div>
    </div>
  </main>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
