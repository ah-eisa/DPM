"use client";

import { WorkspaceLinks } from "../workspace-links";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculatePerformance, HistorySeries, parseBenchmark, PerformanceResult } from "@/lib/performance";
import { loadState, seedState } from "@/lib/storage";
import { DpmState } from "@/lib/types";

const pct=(n:number|undefined)=>n==null?"Unavailable":`${n>=0?"+":""}${n.toFixed(2)}%`;
const money=(ccy:string,n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:ccy,maximumFractionDigits:0}).format(n);
const today=()=>new Date().toISOString().slice(0,10);
const esc=(value:unknown)=>String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]!));
function startFor(range:string){const d=new Date();if(range==="YTD")return `${d.getUTCFullYear()}-01-01`;const years=range.endsWith("Y")?Number(range.slice(0,-1)):0;const months=range.endsWith("M")?Number(range.slice(0,-1)):0;if(years)d.setUTCFullYear(d.getUTCFullYear()-years);if(months)d.setUTCMonth(d.getUTCMonth()-months);return d.toISOString().slice(0,10);}
function historyStartFor(start:string){const d=new Date(`${start}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-7);return d.toISOString().slice(0,10);}

export default function PerformancePage(){
  const [state,setState]=useState<DpmState>(seedState);const [ready,setReady]=useState(false);const [error,setError]=useState("");const [clientId,setClientId]=useState("c001");const [range,setRange]=useState("1Y");const [result,setResult]=useState<PerformanceResult|null>(null);const [status,setStatus]=useState("");
  const requestId=useRef(0);const controller=useRef<AbortController|null>(null);
  useEffect(()=>{try{const s=loadState();setState(s);setClientId(s.clients[0].id);setReady(true);}catch(e){setError((e as Error).message);}return()=>controller.current?.abort();},[]);
  const client=state.clients.find(c=>c.id===clientId)??state.clients[0];
  const symbols=useMemo(()=>{if(!client)return[];const s=new Set(state.transactions.filter(t=>t.clientId===client.id).map(t=>t.symbol.toUpperCase()));for(const b of parseBenchmark(client.benchmark))s.add(b.symbol);return [...s];},[state,client]);

  async function run(){
    if(!client)return;
    const id=++requestId.current;
    controller.current?.abort();
    const abort=new AbortController();controller.current=abort;
    let timedOut=false;
    const timeout=window.setTimeout(()=>{timedOut=true;abort.abort();},60000);
    setError("");setStatus("Loading historical prices...");setResult(null);
    try{
      if(!symbols.length)throw new Error("This client has no securities or benchmark symbols");
      if(symbols.length>25)throw new Error("Performance workspace supports up to 25 market symbols per client");
      const start=startFor(range),historyStart=historyStartFor(start),end=today();
      const r=await fetch(`/api/history?symbols=${encodeURIComponent(symbols.join(","))}&start=${historyStart}&end=${end}&base=${client.baseCurrency}`,{cache:"no-store",signal:abort.signal});
      const data=await r.json();if(!r.ok)throw new Error(data.error??"Historical data request failed");
      const series=Object.values(data.series??{}) as HistorySeries[];
      const perf=calculatePerformance(state,client,series,start,end);
      if(id!==requestId.current||abort.signal.aborted)return;
      setResult(perf);
      const failures=Object.keys(data.errors??{}).length;
      setStatus(`${perf.points.length} observations / ${data.interval}${failures?` / ${failures} provider warning(s)`:""}`);
    }catch(e){
      if(id!==requestId.current)return;
      if(timedOut){setError("Historical data request timed out after 60 seconds");setStatus("");return;}
      if(abort.signal.aborted)return;
      setError(e instanceof Error?e.message:"Performance calculation failed");setStatus("");
    }finally{window.clearTimeout(timeout);if(controller.current===abort)controller.current=null;}
  }
  useEffect(()=>{if(ready&&client)void run();return()=>{requestId.current++;controller.current?.abort();};},[ready,clientId,range]);

  function exportCsv(){if(!result||!client)return;const rows=["Date,Portfolio Value,Portfolio TWR Index,Benchmark Index,External Flow",...result.points.map(p=>[p.date,p.value.toFixed(2),p.portfolioIndex.toFixed(6),p.benchmarkIndex?.toFixed(6)??"",p.externalFlow.toFixed(2)].join(","))];const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([rows.join("\n")],{type:"text/csv"}));a.download=`${client.code}-performance-${range}.csv`;a.click();URL.revokeObjectURL(a.href);}
  function exportHtml(){if(!result||!client)return;const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(client.code)} Performance Report</title><style>body{font-family:Arial,sans-serif;padding:36px;color:#172033}h1{margin-bottom:4px}.muted{color:#667085}.k{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.c{border:1px solid #ddd;border-radius:10px;padding:14px}.v{font-size:24px;font-weight:700}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #eee;text-align:right}th:first-child,td:first-child{text-align:left}@media print{body{padding:0}}</style></head><body><h1>DPM Performance Report</h1><div class="muted">${esc(client.code)} / ${esc(client.label)} / ${esc(range)} / generated ${esc(new Date().toLocaleString())}</div><div class="k"><div class="c"><div>Portfolio TWR</div><div class="v">${esc(pct(result.twrPct))}</div></div><div class="c"><div>Benchmark</div><div class="v">${esc(pct(result.benchmarkPct))}</div></div><div class="c"><div>Excess Return</div><div class="v">${esc(pct(result.excessPct))}</div></div></div><p>Benchmark: ${esc(client.benchmark)}</p><p>Flow convention: beginning-of-day</p><p>Start value: ${esc(money(client.baseCurrency,result.startValue))} &nbsp; End value: ${esc(money(client.baseCurrency,result.endValue))} &nbsp; External flows: ${esc(money(client.baseCurrency,result.externalFlows))}</p><table><thead><tr><th>Date</th><th>Portfolio Value</th><th>TWR Index</th><th>Benchmark Index</th></tr></thead><tbody>${result.points.filter((_,i)=>i%Math.max(1,Math.floor(result.points.length/24))===0||i===result.points.length-1).map(p=>`<tr><td>${esc(p.date)}</td><td>${esc(money(client.baseCurrency,p.value))}</td><td>${esc(p.portfolioIndex.toFixed(2))}</td><td>${esc(p.benchmarkIndex?.toFixed(2)??"-")}</td></tr>`).join("")}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([html],{type:"text/html"}));a.download=`${client.code}-performance-report-${range}.html`;a.click();URL.revokeObjectURL(a.href);}

  if(!ready||!client)return <main className="app"><div className="container"><h1>Performance</h1><p role="alert">{error||"Loading book..."}</p><a className="btn" href="/">Dashboard</a></div></main>;
  return <main className="app"><header className="topbar"><div className="brand"><div className="brandmark">P</div><div><h1>Performance & Reports</h1><div className="muted small">TWR, benchmark comparison and client-ready export</div></div></div><div className="row"><WorkspaceLinks current="/performance" /></div></header><div className="container">
    <div className="toolbar"><div className="row"><label className="field">Client<select value={client.id} onChange={e=>setClientId(e.target.value)}>{state.clients.map(c=><option key={c.id} value={c.id}>{c.code} / {c.baseCurrency}</option>)}</select></label><label className="field">Period<select value={range} onChange={e=>setRange(e.target.value)}>{["1M","3M","YTD","1Y","3Y","5Y","10Y"].map(x=><option key={x}>{x}</option>)}</select></label><button className="btn primary" onClick={run}>Refresh history</button></div><div className="row"><button className="btn" disabled={!result} onClick={exportCsv}>Export CSV</button><button className="btn" disabled={!result} onClick={exportHtml}>Printable report</button></div></div>
    <div className="notice">Portfolio TWR uses a pre-period market anchor plus raw historical closes and recorded corporate actions, so the first sub-period return is included. External deposits/withdrawals use a beginning-of-day convention. Yahoo closes are restored to contemporaneous share units before recorded splits are applied. Benchmarks require a pre-period anchor and use adjusted closes when available. Incomplete valuation dates stop the calculation; no partial report is produced.</div>{error&&<div className="notice negative" role="alert">{error}</div>}{status&&<div className="muted small" style={{marginBottom:12}}>{status}</div>}
    {result&&<><section className="grid kpis"><K label="Portfolio TWR" value={pct(result.twrPct)} tone={result.twrPct>=0?"positive":"negative"}/><K label="Benchmark" value={pct(result.benchmarkPct)} tone={(result.benchmarkPct??0)>=0?"positive":"negative"}/><K label="Excess return" value={pct(result.excessPct)} tone={(result.excessPct??0)>=0?"positive":"negative"}/><K label="End value" value={money(client.baseCurrency,result.endValue)}/><K label="External flows" value={money(client.baseCurrency,result.externalFlows)}/></section><div className="grid two"><section className="card full"><div className="section-title"><h2>Growth of 100</h2><span className="pill">vs {result.benchmarkLabel}</span></div><Chart result={result}/></section><section className="card"><div className="section-title"><h2>Performance reconciliation</h2></div><table><tbody><tr><td>Start value before first-period flow</td><td className="right">{money(client.baseCurrency,result.startValue)}</td></tr><tr><td>External flows</td><td className="right">{money(client.baseCurrency,result.externalFlows)}</td></tr><tr><td>End value</td><td className="right">{money(client.baseCurrency,result.endValue)}</td></tr><tr><td>Flow convention</td><td className="right">Beginning of day</td></tr><tr><td>TWR</td><td className="right">{pct(result.twrPct)}</td></tr><tr><td>Benchmark</td><td className="right">{pct(result.benchmarkPct)}</td></tr><tr><td>Excess</td><td className="right">{pct(result.excessPct)}</td></tr></tbody></table></section><section className="card"><div className="section-title"><h2>Mandate context</h2></div><table><tbody><tr><td>Client</td><td className="right">{client.code}</td></tr><tr><td>Risk</td><td className="right">{client.riskProfile}</td></tr><tr><td>Base currency</td><td className="right">{client.baseCurrency}</td></tr><tr><td>Benchmark</td><td className="right">{client.benchmark}</td></tr><tr><td>Observations</td><td className="right">{result.points.length}</td></tr></tbody></table></section></div></>}
  </div></main>;
}

function K({label,value,tone}:{label:string;value:string;tone?:string}){return <div className="card kpi"><div className="label">{label}</div><div className={`value ${tone??""}`}>{value}</div></div>}
function Chart({result}:{result:PerformanceResult}){const pts=result.points;if(pts.length<2)return <div className="empty">Not enough data</div>;const vals=pts.flatMap(p=>[p.portfolioIndex,...(p.benchmarkIndex==null?[]:[p.benchmarkIndex])]);const min=Math.min(...vals),max=Math.max(...vals),span=Math.max(1e-9,max-min);const path=(pick:(p:typeof pts[number])=>number|undefined)=>pts.map((p,i)=>{const v=pick(p);if(v==null)return"";const x=20+i*(760/(pts.length-1)),y=220-(v-min)/span*190;return`${i===0?"M":"L"}${x.toFixed(1)} ${y.toFixed(1)}`}).join(" ");return <div><svg viewBox="0 0 800 250" role="img" aria-label="Portfolio and benchmark indexed performance" style={{width:"100%",minWidth:520}}><line x1="20" y1="220" x2="780" y2="220" stroke="var(--border)"/><path d={path(p=>p.portfolioIndex)} fill="none" stroke="var(--accent)" strokeWidth="3"/><path d={path(p=>p.benchmarkIndex)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="7 5"/></svg><div className="row small"><span><strong style={{color:"var(--accent)"}}>Portfolio</strong></span><span className="muted">Benchmark</span><span className="muted">{pts[0].date} to {pts.at(-1)?.date}</span></div></div>}
