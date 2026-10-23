"use client";
import { FormEvent, useState } from "react";
import { ASSET_CLASSES } from "@/lib/validation";
import { Client, DpmState } from "@/lib/types";

export function MandateForm({ state, client, onSave, onClose }: { state: DpmState; client?: Client; onSave: (state: DpmState, id: string) => boolean; onClose: () => void }) {
  const [draft, setDraft] = useState<Client>(client ?? { id: crypto.randomUUID(), code: "", label: "", baseCurrency: "USD", benchmark: "SPY", riskProfile: "Balanced", initialCash: 0 });
  const [targets, setTargets] = useState(ASSET_CLASSES.map(assetClass => state.targets.find(t => t.clientId === client?.id && t.assetClass === assetClass) ?? { clientId: draft.id, assetClass, targetPct: assetClass === "Cash" && !client ? 100 : 0, minPct: 0, maxPct: 100 }));
  const hasActivity = state.transactions.some(t => t.clientId === draft.id) || state.cashMovements.some(m => m.clientId === draft.id) || state.corporateActions.some(a => a.clientId === draft.id);
  const total = targets.reduce((sum,t) => sum + t.targetPct, 0);
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = { ...state, clients: client ? state.clients.map(c => c.id === draft.id ? draft : c) : [...state.clients, draft], targets: [...state.targets.filter(t => t.clientId !== draft.id), ...targets] };
    onSave(next, draft.id);
  }
  return <section className="card settings" aria-labelledby="mandate-title">
    <div className="section-title"><h2 id="mandate-title">{client ? "Edit mandate" : "New client mandate"}</h2><button className="btn" onClick={onClose}>Close</button></div>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="field">Client code<input required value={draft.code} onChange={e => setDraft({...draft,code:e.target.value})}/></label>
        <label className="field">Mandate label<input required value={draft.label} onChange={e => setDraft({...draft,label:e.target.value})}/></label>
        <label className="field">Base currency<select disabled={hasActivity} value={draft.baseCurrency} onChange={e => setDraft({...draft,baseCurrency:e.target.value})}>{Intl.supportedValuesOf("currency").map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Initial cash<input required type="number" min="0" step="any" value={draft.initialCash} onChange={e => setDraft({...draft,initialCash:Number(e.target.value)})}/></label>
        <label className="field">Benchmark<input required value={draft.benchmark} onChange={e => setDraft({...draft,benchmark:e.target.value})}/></label>
        <label className="field">Risk profile<select value={draft.riskProfile} onChange={e => setDraft({...draft,riskProfile:e.target.value as Client["riskProfile"]})}>{["Conservative","Balanced","Growth","Custom"].map(r => <option key={r}>{r}</option>)}</select></label>
      </div>
      <p className="muted small">Fees are in base currency. Initial cash changes revalidate the complete ledger. Base currency is fixed once trades, cash movements or corporate actions exist.</p>
      <h3>Allocation and mandate limits</h3>
      <div className="table-scroll"><table><thead><tr><th>Asset class</th><th>Minimum %</th><th>Target %</th><th>Maximum %</th></tr></thead><tbody>{targets.map((t,index) => <tr key={t.assetClass}><td>{t.assetClass}</td>{(["minPct","targetPct","maxPct"] as const).map(field => <td key={field}><input aria-label={`${t.assetClass} ${field}`} required type="number" min="0" max="100" step="any" value={t[field] ?? (field === "maxPct" ? 100 : 0)} onChange={e => setTargets(targets.map((x,i) => i === index ? {...x,[field]:Number(e.target.value)} : x))}/></td>)}</tr>)}</tbody></table></div>
      <div className="row" style={{marginTop:16}}><span role="status" className={Math.abs(total - 100) < 1e-6 ? "positive" : "negative"}>Target total: {total.toFixed(2)}% / 100%</span><button type="submit" className="btn primary">Save mandate</button></div>
    </form>
  </section>;
}
