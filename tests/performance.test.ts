import { describe, expect, it } from "vitest";
import { calculatePerformance, HistorySeries, parseBenchmark } from "../lib/performance";
import { DpmState } from "../lib/types";

const base:DpmState={version:3,clients:[{id:"c1",code:"C001",label:"Test",baseCurrency:"USD",benchmark:"SPY",riskProfile:"Balanced",initialCash:1000}],transactions:[{id:"t1",sequence:1,clientId:"c1",symbol:"X",assetClass:"ETF",side:"BUY",quantity:10,price:50,fees:0,fxRate:1,currency:"USD",tradeDate:"2026-01-02"}],cashMovements:[],corporateActions:[],targets:[{clientId:"c1",assetClass:"Cash",targetPct:50},{clientId:"c1",assetClass:"ETF",targetPct:50}]};
const h=(symbol:string,currency:string,values:[string,number][]):HistorySeries=>({symbol,currency,points:values.map(([date,close])=>({date,close}))});
const ha=(symbol:string,currency:string,values:[string,number,number][]):HistorySeries=>({symbol,currency,points:values.map(([date,close,adjustedClose])=>({date,close,adjustedClose}))});

describe("benchmark parsing",()=>{
  it("parses a simple benchmark",()=>expect(parseBenchmark("SPY")).toEqual([{symbol:"SPY",weight:1}]));
  it("parses and normalizes blended benchmarks",()=>expect(parseBenchmark("60% SPY / 40% BND")).toEqual([{symbol:"SPY",weight:.6},{symbol:"BND",weight:.4}]));
});

describe("historical TWR",()=>{
  it("calculates return from historical portfolio value",()=>{
    const series=[h("X","USD",[["2026-01-02",50],["2026-01-05",60]]),h("SPY","USD",[["2026-01-01",100],["2026-01-02",100],["2026-01-05",110]])];
    const r=calculatePerformance(base,base.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.twrPct).toBeCloseTo(10);expect(r.benchmarkPct).toBeCloseTo(10);expect(r.excessPct).toBeCloseTo(0);expect(r.endValue).toBeCloseTo(1100);
  });

  it("includes return earned on the first observation day",()=>{
    const s:DpmState={...base,transactions:[{...base.transactions[0],sequence:2,quantity:20,price:100,tradeDate:"2026-01-02"}],cashMovements:[{id:"m1",clientId:"c1",sequence:1,kind:"DEPOSIT",amount:1000,currency:"USD",fxRate:1,movementDate:"2026-01-02"}]};
    const series=[h("X","USD",[["2026-01-02",110],["2026-01-05",110]]),h("SPY","USD",[["2026-01-02",100],["2026-01-05",100]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.startValue).toBeCloseTo(1000);expect(r.externalFlows).toBeCloseTo(1000);expect(r.points[0].portfolioIndex).toBeCloseTo(110);expect(r.twrPct).toBeCloseTo(10);
  });

  it("removes external deposits using the beginning-of-day convention",()=>{
    const s:DpmState={...base,cashMovements:[{id:"m1",clientId:"c1",sequence:2,kind:"DEPOSIT",amount:500,currency:"USD",fxRate:1,movementDate:"2026-01-05"}]};
    const series=[h("X","USD",[["2026-01-02",50],["2026-01-05",50]]),h("SPY","USD",[["2026-01-02",100],["2026-01-05",100]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.endValue).toBeCloseTo(1500);expect(r.externalFlows).toBeCloseTo(500);expect(r.twrPct).toBeCloseTo(0);expect(r.flowConvention).toBe("beginning-of-day");
  });

  it("does not report pre-period funding as a period cash flow",()=>{
    const s:DpmState={...base,cashMovements:[{id:"m0",clientId:"c1",sequence:2,kind:"DEPOSIT",amount:500,currency:"USD",fxRate:1,movementDate:"2026-01-03"}]};
    const series=[h("X","USD",[["2026-01-04",50],["2026-01-05",50],["2026-01-06",50]]),h("SPY","USD",[["2026-01-04",100],["2026-01-05",100],["2026-01-06",100]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-05","2026-01-06");
    expect(r.startValue).toBeCloseTo(1500);expect(r.externalFlows).toBe(0);expect(r.twrPct).toBeCloseTo(0);
  });

  it("rejects missing flow-date valuation instead of fabricating performance",()=>{
    const s:DpmState={...base,transactions:[{...base.transactions[0],sequence:2,quantity:10,price:100,tradeDate:"2026-01-05"}],cashMovements:[{id:"m1",clientId:"c1",sequence:1,kind:"DEPOSIT",amount:500,currency:"USD",fxRate:1,movementDate:"2026-01-05"}]};
    const series=[h("X","USD",[["2026-01-06",100],["2026-01-07",100]]),h("SPY","USD",[["2026-01-05",100],["2026-01-06",100],["2026-01-07",100]])];
    expect(()=>calculatePerformance(s,s.clients[0],series,"2026-01-05","2026-01-07")).toThrow(/Incomplete portfolio valuation/);
  });

  it("treats same-day funding as beginning capital when it is invested before the close",()=>{
    const s:DpmState={...base,transactions:[{...base.transactions[0],quantity:10,price:100,tradeDate:"2026-01-01"},{...base.transactions[0],id:"t2",sequence:3,quantity:10,price:100,tradeDate:"2026-01-05"}],cashMovements:[{id:"m1",clientId:"c1",sequence:2,kind:"DEPOSIT",amount:1000,currency:"USD",fxRate:1,movementDate:"2026-01-05"}]};
    const series=[h("X","USD",[["2026-01-03",100],["2026-01-04",100],["2026-01-05",110]]),h("SPY","USD",[["2026-01-03",100],["2026-01-04",100],["2026-01-05",100]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-04","2026-01-05");
    expect(r.endValue).toBeCloseTo(2200);expect(r.externalFlows).toBeCloseTo(1000);expect(r.twrPct).toBeCloseTo(10);
  });

  it("reconciles an external flow on the first observation without double-counting start value",()=>{
    const s:DpmState={...base,transactions:[],cashMovements:[{id:"m1",clientId:"c1",sequence:1,kind:"DEPOSIT",amount:500,currency:"USD",fxRate:1,movementDate:"2026-01-02"}],targets:[{clientId:"c1",assetClass:"Cash",targetPct:100}]};
    const series=[h("SPY","USD",[["2026-01-02",100],["2026-01-05",100]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.startValue).toBeCloseTo(1000);expect(r.externalFlows).toBeCloseTo(500);expect(r.endValue).toBeCloseTo(1500);expect(r.twrPct).toBeCloseTo(0);
  });

  it("uses raw closes for a split portfolio and adjusted closes for its benchmark",()=>{
    const s:DpmState={...base,clients:[{...base.clients[0],initialCash:1000}],transactions:[{...base.transactions[0],quantity:10,price:100,tradeDate:"2026-01-02"}],corporateActions:[{id:"a1",clientId:"c1",sequence:2,kind:"SPLIT",symbol:"X",actionDate:"2026-01-05",factor:2}]};
    const series=[ha("X","USD",[["2026-01-02",100,50],["2026-01-05",50,50]]),ha("SPY","USD",[["2026-01-01",100,50],["2026-01-02",100,50],["2026-01-05",50,50]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.endValue).toBeCloseTo(1000);expect(r.twrPct).toBeCloseTo(0);expect(r.benchmarkPct).toBeCloseTo(0);
  });

  it("handles foreign assets using historical FX",()=>{
    const s:DpmState={...base,transactions:[{...base.transactions[0],currency:"AED",fxRate:.27,price:100}]};
    const series=[h("X","AED",[["2026-01-02",100],["2026-01-05",100]]),h("AEDUSD=X","USD",[["2026-01-02",.27],["2026-01-05",.28]]),h("SPY","USD",[["2026-01-02",100],["2026-01-05",100]])];
    const r=calculatePerformance(s,s.clients[0],series,"2026-01-02","2026-01-05");
    expect(r.twrPct).toBeGreaterThan(0);
  });
});
