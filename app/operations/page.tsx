"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { importGtnCsv, allocateMasterExecution, maxLedgerSequence } from "@/lib/operations";
import { loadState, saveState, seedState } from "@/lib/storage";
import { AssetClass, CashMovement, CashMovementKind, CorporateAction, CorporateActionKind, DpmState, Side } from "@/lib/types";
import { ASSET_CLASSES, validateState } from "@/lib/validation";

const CASH_KINDS: CashMovementKind[] = ["DEPOSIT","WITHDRAWAL","DIVIDEND","COUPON","INTEREST","FEE","TAX","OTHER"];
const ACTION_KINDS: CorporateActionKind[] = ["SPLIT","REVERSE_SPLIT","STOCK_DIVIDEND"];
const today = () => new Date().toISOString().slice(0,10);
const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

export default function OperationsPage() {
  const [state, setState] = useState<DpmState>(seedState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cash, setCash] = useState({clientId:"c001",kind:"DEPOSIT" as CashMovementKind,amount:"",currency:"USD",fxRate:"1",movementDate:today(),symbol:"",reference:"",notes:""});
  const [action, setAction] = useState({clientId:"c001",kind:"SPLIT" as CorporateActionKind,symbol:"",factor:"2",actionDate:today(),reference:"",notes:""});
  const [master, setMaster] = useState({symbol:"",name:"",assetClass:"US Equity" as AssetClass,side:"BUY" as Side,totalQuantity:"",price:"",fees:"0",currency:"USD",fxRate:"1",tradeDate:today(),gtnRef:"",notes:""});
  const [allocations, setAllocations] = useState<Record<string,string>>({});

  useEffect(() => {
    try {
      const book = loadState();
      setState(book);
      const first = book.clients[0];
      if (first) {
        setCash(c => ({...c,clientId:first.id,currency:first.baseCurrency}));
        setAction(a => ({...a,clientId:first.id}));
        setMaster(m => ({...m,currency:first.baseCurrency}));
      }
    } catch (e) { setError((e as Error).message); }
    setReady(true);
  }, []);

  function commit(next: DpmState, ok: string) {
    try {
      const valid = validateState(next);
      saveState(valid);
      setState(valid);
      setError(""); setMessage(ok);
      return true;
    } catch (e) { setError((e as Error).message); setMessage(""); return false; }
  }

  const clientById = useMemo(() => new Map(state.clients.map(c => [c.id,c])), [state.clients]);
  const activeCashClient = clientById.get(cash.clientId);

  function addCash(e: FormEvent) {
    e.preventDefault();
    if (!activeCashClient) return;
    const item: CashMovement = {
      id: uid("cash"), clientId: cash.clientId, sequence: maxLedgerSequence(state)+1, kind: cash.kind,
      amount: Number(cash.amount), currency: cash.currency.toUpperCase(), fxRate: Number(cash.fxRate), movementDate: cash.movementDate,
      symbol: cash.symbol.trim().toUpperCase() || undefined, reference: cash.reference.trim() || undefined, notes: cash.notes.trim() || undefined,
    };
    if (commit({...state,cashMovements:[...(state.cashMovements??[]),item]}, `${cash.kind} recorded`)) setCash(c=>({...c,amount:"",symbol:"",reference:"",notes:""}));
  }

  function addAction(e: FormEvent) {
    e.preventDefault();
    const item: CorporateAction = {
      id: uid("ca"), clientId: action.clientId, sequence: maxLedgerSequence(state)+1, kind: action.kind,
      symbol: action.symbol.trim().toUpperCase(), actionDate: action.actionDate, factor: Number(action.factor),
      reference: action.reference.trim() || undefined, notes: action.notes.trim() || undefined,
    };
    if (commit({...state,corporateActions:[...(state.corporateActions??[]),item]}, `${action.kind} recorded`)) setAction(a=>({...a,symbol:"",reference:"",notes:""}));
  }

  function addBulk(e: FormEvent) {
    e.preventDefault();
    try {
      const totalQuantity = Number(master.totalQuantity);
      const txs = allocateMasterExecution(state, {
        symbol: master.symbol, name: master.name || undefined, assetClass: master.assetClass, side: master.side,
        totalQuantity, price:Number(master.price), fees:Number(master.fees), currency:master.currency, fxRate:Number(master.fxRate),
        tradeDate:master.tradeDate, gtnRef:master.gtnRef || undefined, notes:master.notes || undefined,
      }, Object.entries(allocations).filter(([,q])=>Number(q)>0).map(([clientId,q])=>({clientId,quantity:Number(q)})));
      if (commit({...state,transactions:[...state.transactions,...txs]}, `Master execution allocated to ${txs.length} clients`)) {
        setMaster(m=>({...m,symbol:"",name:"",totalQuantity:"",price:"",fees:"0",gtnRef:"",notes:""})); setAllocations({});
      }
    } catch (e) { setError((e as Error).message); setMessage(""); }
  }

  async function onCsv(e: ChangeEvent<HTMLInputElement>) {
    const file=e.target.files?.[0]; if(!file) return;
    try {
      const txs=importGtnCsv(await file.text(),state);
      if (!window.confirm(`Import ${txs.length} validated GTN executions?`)) return;
      commit({...state,transactions:[...state.transactions,...txs]}, `${txs.length} GTN executions imported`);
    } catch(err){setError(err instanceof Error?err.message:"GTN import failed");setMessage("");}
    e.target.value="";
  }

  function removeCash(id:string){if(window.confirm("Delete this cash movement?"))commit({...state,cashMovements:state.cashMovements.filter(x=>x.id!==id)},"Cash movement deleted");}
  function removeAction(id:string){if(window.confirm("Delete this corporate action?"))commit({...state,corporateActions:state.corporateActions.filter(x=>x.id!==id)},"Corporate action deleted");}

  if(!ready) return <main className="app"><div className="container">Loading operations...</div></main>;

  return <main className="app">
    <header className="topbar"><div className="brand"><div className="brandmark">O</div><div><h1>DPM Operations</h1><div className="muted small">Cash, corporate actions, bulk allocation and GTN import</div></div></div><a className="btn" href="/">Dashboard</a></header>
    <div className="container">
      <div className="notice">All entries are validated against cash, holdings, currencies and the global ledger sequence before they are saved.</div>
      {error&&<div className="notice negative" role="alert">{error}</div>}{message&&<div className="notice positive" role="status">{message}</div>}

      <div className="grid two">
        <section className="card"><div className="section-title"><h2>Cash ledger</h2><span className="pill">Base-currency accounting</span></div>
          <form className="form-grid" onSubmit={addCash}>
            <Field label="Client"><select value={cash.clientId} onChange={e=>{const c=clientById.get(e.target.value);setCash({...cash,clientId:e.target.value,currency:c?.baseCurrency??"USD",fxRate:"1"});}}>{state.clients.map(c=><option key={c.id} value={c.id}>{c.code} / {c.baseCurrency}</option>)}</select></Field>
            <Field label="Type"><select value={cash.kind} onChange={e=>setCash({...cash,kind:e.target.value as CashMovementKind})}>{CASH_KINDS.map(k=><option key={k}>{k}</option>)}</select></Field>
            <Field label="Amount"><input required type="number" min="0" step="any" value={cash.amount} onChange={e=>setCash({...cash,amount:e.target.value})}/></Field>
            <Field label="Currency"><input required maxLength={3} value={cash.currency} onChange={e=>setCash({...cash,currency:e.target.value.toUpperCase()})}/></Field>
            <Field label="FX to base"><input required type="number" min="0" step="any" value={cash.fxRate} onChange={e=>setCash({...cash,fxRate:e.target.value})}/></Field>
            <Field label="Date"><input required type="date" value={cash.movementDate} onChange={e=>setCash({...cash,movementDate:e.target.value})}/></Field>
            <Field label="Symbol (optional)"><input value={cash.symbol} onChange={e=>setCash({...cash,symbol:e.target.value})} placeholder="AAPL"/></Field>
            <Field label="Reference"><input value={cash.reference} onChange={e=>setCash({...cash,reference:e.target.value})}/></Field>
            <Field label="Notes"><input value={cash.notes} onChange={e=>setCash({...cash,notes:e.target.value})}/></Field>
            <div className="field" style={{alignSelf:"end"}}><button className="btn primary">Add cash entry</button></div>
          </form>
        </section>

        <section className="card"><div className="section-title"><h2>Corporate action</h2><span className="pill">Quantity multiplier</span></div>
          <form className="form-grid" onSubmit={addAction}>
            <Field label="Client"><select value={action.clientId} onChange={e=>setAction({...action,clientId:e.target.value})}>{state.clients.map(c=><option key={c.id} value={c.id}>{c.code}</option>)}</select></Field>
            <Field label="Action"><select value={action.kind} onChange={e=>setAction({...action,kind:e.target.value as CorporateActionKind})}>{ACTION_KINDS.map(k=><option key={k}>{k}</option>)}</select></Field>
            <Field label="Symbol"><input required value={action.symbol} onChange={e=>setAction({...action,symbol:e.target.value})}/></Field>
            <Field label="Factor"><input required type="number" min="0" step="any" value={action.factor} onChange={e=>setAction({...action,factor:e.target.value})}/></Field>
            <Field label="Date"><input required type="date" value={action.actionDate} onChange={e=>setAction({...action,actionDate:e.target.value})}/></Field>
            <Field label="Reference"><input value={action.reference} onChange={e=>setAction({...action,reference:e.target.value})}/></Field>
            <Field label="Notes"><input value={action.notes} onChange={e=>setAction({...action,notes:e.target.value})}/></Field>
            <div className="field" style={{alignSelf:"end"}}><button className="btn primary">Apply action</button></div>
          </form><p className="muted small">Examples: 2-for-1 split = 2.0, 1-for-2 reverse split = 0.5, 10% stock dividend = 1.1. Cost basis is preserved.</p>
        </section>

        <section className="card full"><div className="section-title"><h2>Master trade allocation</h2><span className="pill">One execution → many clients</span></div>
          <form onSubmit={addBulk}>
            <div className="form-grid">
              <Field label="Side"><select value={master.side} onChange={e=>setMaster({...master,side:e.target.value as Side})}><option>BUY</option><option>SELL</option></select></Field>
              <Field label="Symbol"><input required value={master.symbol} onChange={e=>setMaster({...master,symbol:e.target.value})}/></Field>
              <Field label="Name"><input value={master.name} onChange={e=>setMaster({...master,name:e.target.value})}/></Field>
              <Field label="Asset class"><select value={master.assetClass} onChange={e=>setMaster({...master,assetClass:e.target.value as AssetClass})}>{ASSET_CLASSES.filter(x=>x!=="Cash").map(x=><option key={x}>{x}</option>)}</select></Field>
              <Field label="Master quantity"><input required type="number" min="0" step="any" value={master.totalQuantity} onChange={e=>setMaster({...master,totalQuantity:e.target.value})}/></Field>
              <Field label="Execution price"><input required type="number" min="0" step="any" value={master.price} onChange={e=>setMaster({...master,price:e.target.value})}/></Field>
              <Field label="Total fees"><input required type="number" min="0" step="any" value={master.fees} onChange={e=>setMaster({...master,fees:e.target.value})}/></Field>
              <Field label="Currency"><input required maxLength={3} value={master.currency} onChange={e=>setMaster({...master,currency:e.target.value.toUpperCase()})}/></Field>
              <Field label="FX to base"><input required type="number" min="0" step="any" value={master.fxRate} onChange={e=>setMaster({...master,fxRate:e.target.value})}/></Field>
              <Field label="Trade date"><input required type="date" value={master.tradeDate} onChange={e=>setMaster({...master,tradeDate:e.target.value})}/></Field>
              <Field label="GTN ref"><input value={master.gtnRef} onChange={e=>setMaster({...master,gtnRef:e.target.value})}/></Field>
              <Field label="Notes"><input value={master.notes} onChange={e=>setMaster({...master,notes:e.target.value})}/></Field>
            </div>
            <div style={{overflowX:"auto",marginTop:16}}><table><thead><tr><th>Client</th><th>Base</th><th className="right">Allocated quantity</th></tr></thead><tbody>{state.clients.map(c=><tr key={c.id}><td>{c.code}</td><td>{c.baseCurrency}</td><td className="right"><input style={{width:140}} type="number" min="0" step="any" value={allocations[c.id]??""} onChange={e=>setAllocations({...allocations,[c.id]:e.target.value})}/></td></tr>)}</tbody></table></div>
            <div className="row" style={{justifyContent:"space-between",marginTop:14}}><span className="muted small">Allocated: {Object.values(allocations).reduce((s,q)=>s+(Number(q)||0),0)} / {Number(master.totalQuantity)||0}</span><button className="btn primary">Allocate execution</button></div>
          </form>
        </section>

        <section className="card full"><div className="section-title"><h2>GTN CSV import</h2><label className="btn primary">Choose CSV<input hidden type="file" accept=".csv,text/csv" onChange={onCsv}/></label></div>
          <p className="muted">Strict validated import. Supported header aliases include Client/Account, Side, Symbol/Ticker, Quantity/Qty, Price, Fees/Commission, Currency, FX Rate, Trade Date, GTN Ref, Asset Class and Security Name.</p>
          <p className="muted small">Client values must match the anonymised client codes already in this book. Foreign-currency rows require an FX Rate. Duplicate GTN references are rejected.</p>
        </section>

        <section className="card"><div className="section-title"><h2>Recent cash entries</h2><span className="muted small">{state.cashMovements.length}</span></div><div style={{overflowX:"auto"}}><table><thead><tr><th>Date</th><th>Client</th><th>Type</th><th className="right">Amount</th><th></th></tr></thead><tbody>{[...state.cashMovements].sort((a,b)=>b.sequence-a.sequence).slice(0,20).map(m=><tr key={m.id}><td>{m.movementDate}</td><td>{clientById.get(m.clientId)?.code}</td><td>{m.kind}</td><td className="right">{m.amount} {m.currency}</td><td className="right"><button className="btn danger" onClick={()=>removeCash(m.id)}>Delete</button></td></tr>)}</tbody></table></div></section>
        <section className="card"><div className="section-title"><h2>Corporate actions</h2><span className="muted small">{state.corporateActions.length}</span></div><div style={{overflowX:"auto"}}><table><thead><tr><th>Date</th><th>Client</th><th>Symbol</th><th>Action</th><th className="right">Factor</th><th></th></tr></thead><tbody>{[...state.corporateActions].sort((a,b)=>b.sequence-a.sequence).slice(0,20).map(a=><tr key={a.id}><td>{a.actionDate}</td><td>{clientById.get(a.clientId)?.code}</td><td>{a.symbol}</td><td>{a.kind}</td><td className="right">{a.factor}</td><td className="right"><button className="btn danger" onClick={()=>removeAction(a.id)}>Delete</button></td></tr>)}</tbody></table></div></section>
      </div>
    </div>
  </main>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
