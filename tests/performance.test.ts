import { describe, expect, it } from "vitest";
import { calculatePerformance, HistorySeries, parseBenchmark } from "../lib/performance";
import { DpmState } from "../lib/types";

const base:DpmState={version:3,clients:[{id:"c1",code:"C001",label:"Test",baseCurrency:"USD",benchmark:"SPY",riskProfile:"Balanced",initialCash:1000}],transactions:[{id:"t1",sequence:1,clientId:"c1",symbol:"X",assetClass:"ETF",side:"BUY",quantity:10,price:50,fees:0,fxRate:1,currency:"USD",tradeDate:"2026-01-02"}],cashMovements:[],corporateActions:[],targets:[{clientId:"c1",assetClass:"Cash",targetPct:50},{clientId:"c1",assetClass:"ETF",targetPct:50}]};
const h=(symbol:string,currency:string,values:[string,number][]):HistorySeries=>({symbol,currency,points:values.map(([date,close])=>({date,close}))});

describe("benchmark parsing",()=>{
  it("parses a simple benchmark",()=>expect(parseBenchmark("SPY")).toEqual([{symbol:"SPY",weight:1}]));
  it("parses and normalizes blended benchmarks",()=>expect(parseBenchmark("60% SPY / 40% BND")).toEqual([{symbol:"SPY",weight:.6},{symbol:"BND",weight:.4}]));
});

describe("historical TWR",()=>{
  it("calculates return from historical portfolio value",()=>{
    const series=[h("X","USD",[["2026-01-02",50],["2026-01-05",60]]),h("SPY","USD",[["2026-01-02",100],["2026-01-05",110]])];
    const r=calculatePerformance(base,base.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.twrPct).toBeCloseTo(10);expect(r.benchmarkPct).toBeCloseTo(10);expect(r.excessPct).toBeCloseTo(0);expect(r.endValue).toBeCloseTo(1100);
  });
  it("removes external deposits from investment return",()=>{
    const s:DpmState={...base,cashMovements:[{id:"m1",clientId:"c1",sequence:2,kind:"DEPOSIT",amount:500,currency:"USD",fxRate:1,movementDate:"2026-01-05"}]};
    const series=[h("X","USD",[["2026-01-02",50],["2026-01-05",50]]),h("SPY","USD",[["2026-01-02",100],["2026-01-05",100]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.endValue).toBeCloseTo(1500);expect(r.externalFlows).toBeCloseTo(500);expect(r.twrPct).toBeCloseTo(0);
  });
  it("handles foreign assets using historical FX",()=>{
    const s:DpmState={...base,transactions:[{...base.transactions[0],currency:"AED",fxRate:.27,price:100}]};
    const series=[h("X","AED",[["2026-01-02",100],["2026-01-05",100]]),h("AEDUSD=X","USD",[["2026-01-02",.27],["2026-01-05",.28]]),h("SPY","USD",[["2026-01-02",100],["2026-01-05",100]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.twrPct).toBeGreaterThan(0);
  });
});
