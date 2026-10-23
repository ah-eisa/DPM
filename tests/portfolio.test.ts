import { describe, expect, it } from "vitest";
import { aggregateAum, buildPortfolio, driftForClient } from "../lib/portfolio";
import { validateState } from "../lib/validation";
import { Client, DpmState, Quote, Transaction } from "../lib/types";

const client: Client = { id:"c", code:"C", label:"Test", baseCurrency:"USD", initialCash:10000, benchmark:"SPY", riskProfile:"Balanced" };
const trade = (side: "BUY"|"SELL", quantity:number, price:number, sequence=1, extra:Partial<Transaction>={}):Transaction => ({id:`t${sequence}`,clientId:"c",symbol:"X",assetClass:"ETF",side,quantity,price,fees:0,fxRate:1,currency:"USD",tradeDate:"2026-10-01",sequence,...extra});
const state = (transactions:Transaction[]=[]):DpmState => ({version:2,clients:[{...client}],transactions,targets:[{clientId:"c",assetClass:"Cash",targetPct:100}]});
const quote = (price:number, currency="USD"):Quote => ({symbol:"X",price,currency,asOf:new Date().toISOString(),source:"Test",previousClose:price-1});
const summary = (trades:Transaction[], quotes:Record<string,Quote>={}) => buildPortfolio(client,state(trades),quotes);
describe("portfolio ledger and valuation",()=>{
  it("accounts for an empty book",()=>expect(summary([]).marketValue).toBe(10000));
  it("calculates FIFO partial sales including fees",()=>{
    const p=summary([trade("BUY",10,100,1,{fees:10}),trade("BUY",10,200,2),trade("SELL",12,250,3,{fees:5})],{X:quote(210)});
    expect(p.cash).toBe(9985);expect(p.realisedPnl).toBe(1585);expect(p.holdings[0].quantity).toBe(8);expect(p.costBasis).toBe(1600);expect(p.unrealisedPnl).toBe(80);expect(p.totalPnl).toBe(1665);
  });
  it("preserves realised profit after full closure",()=>{const p=summary([trade("BUY",1,100),trade("SELL",1,120,2)]);expect(p.holdings).toEqual([]);expect(p.totalPnl).toBe(20);});
  it("rejects overselling",()=>expect(()=>summary([trade("BUY",1,100),trade("SELL",2,120,2)])).toThrow(/sale exceeds/));
  it("rejects sale before purchase on the same date",()=>expect(()=>summary([trade("BUY",1,100,2),trade("SELL",1,120,1)])).toThrow());
  it("uses explicit execution sequence independent of array order",()=>expect(summary([trade("SELL",1,120,2),trade("BUY",1,100,1)]).totalPnl).toBe(20));
  it("rejects a backdated sale",()=>expect(()=>summary([trade("BUY",1,100),trade("SELL",1,120,2,{tradeDate:"2026-09-01"})])).toThrow());
  it("rejects insufficient cash",()=>expect(()=>summary([trade("BUY",1000,100)])).toThrow(/cash/));
  it("rejects deletion that invalidates later sales",()=>expect(()=>validateState(state([trade("SELL",1,120)]))).toThrow());
  it("rejects asset reclassification on later executions",()=>expect(()=>summary([trade("BUY",1,100),trade("BUY",1,100,2,{assetClass:"Crypto"})])).toThrow(/inconsistent/));
  it("converts current FX separately from execution FX",()=>{
    const p=summary([trade("BUY",10,100,1,{currency:"AED",fxRate:0.27})],{X:quote(110,"AED"),"AEDUSD=X":quote(0.28,"USD")});
    expect(p.costBasis).toBeCloseTo(270);expect(p.investedValue).toBeCloseTo(308);expect(p.totalPnl).toBeCloseTo(38);
  });
  it("does not invent a market price without FX",()=>{const p=summary([trade("BUY",1,100,1,{currency:"AED",fxRate:0.27})],{X:quote(100,"AED")});expect(p.investedValue).toBe(27);expect(p.valuationComplete).toBe(false);expect(p.holdings[0].valuationStatus).toBe("cost");});
  it("marks absent quotes as cost only",()=>expect(summary([trade("BUY",1,100)]).holdings[0].valuationStatus).toBe("cost"));
  it("rejects a quote with the wrong currency",()=>expect(summary([trade("BUY",1,100)],{X:quote(100,"AED"),"AEDUSD=X":quote(.27)}).valuationComplete).toBe(false));
  it("marks old market timestamps stale",()=>expect(summary([trade("BUY",1,100)],{X:{...quote(100),asOf:"2020-01-01"}}).holdings[0].valuationStatus).toBe("stale"));
  it("marks provider fallback stale",()=>expect(summary([trade("BUY",1,100)],{X:{...quote(100),stale:true}}).valuationComplete).toBe(false));
  it("reports classes missing from target settings",()=>{const s=state([trade("BUY",1,100)]);const rows=driftForClient(s,buildPortfolio(client,s,{X:quote(100)}));expect(rows.find(r=>r.assetClass==="ETF")).toMatchObject({targetPct:0,breach:true});});
  it("never sums different base currencies",()=>{const p=summary([]);expect(()=>aggregateAum([p,{...p,client:{...client,baseCurrency:"AED"}}])).toThrow(/currencies/);});
  it("calculates daily FX P&L from both current and previous FX",()=>{const fx={...quote(.28),previousClose:.27};const p=summary([trade("BUY",10,100,1,{currency:"AED",fxRate:.27})],{X:{...quote(110,"AED"),previousClose:100},"AEDUSD=X":fx});expect(p.dayPnl).toBeCloseTo(38);expect(p.dayPnlComplete).toBe(true);});
  it("marks day P&L unavailable when its baseline is missing",()=>expect(summary([trade("BUY",1,100)],{X:{...quote(100),previousClose:undefined}}).dayPnlComplete).toBe(false));
});
describe("validated and versioned state",()=>{
  it("migrates legacy sequence in original input order",()=>{const s=state([trade("BUY",1,100)]);delete s.version;delete s.transactions[0].sequence;expect(validateState(s)).toMatchObject({version:2,transactions:[{sequence:1}]});});
  it.each([NaN,Infinity,-1,0])("rejects bad quantity %s",n=>expect(()=>validateState(state([trade("BUY",n,100)]))).toThrow());
  it.each([-1,NaN,Infinity])("rejects bad fees %s",fees=>expect(()=>validateState(state([trade("BUY",1,100,1,{fees})]))).toThrow());
  it("rejects non-positive FX",()=>expect(()=>validateState(state([trade("BUY",1,100,1,{fxRate:0})]))).toThrow());
  it("rejects same-currency FX inconsistency",()=>expect(()=>validateState(state([trade("BUY",1,100,1,{fxRate:2})]))).toThrow());
  it("rejects duplicate IDs",()=>expect(()=>validateState(state([trade("BUY",1,100),trade("BUY",1,100)]))).toThrow());
  it("rejects duplicate sequence",()=>expect(()=>validateState(state([trade("BUY",1,100),trade("BUY",1,100,1,{id:"other"})]))).toThrow());
  it("rejects unknown clients",()=>expect(()=>validateState(state([trade("BUY",1,100,1,{clientId:"unknown"})]))).toThrow());
  it("rejects impossible dates",()=>expect(()=>validateState(state([trade("BUY",1,100,1,{tradeDate:"2026-02-30"})]))).toThrow());
  it("rejects invalid records even with valid array containers",()=>expect(()=>validateState({clients:[{}],transactions:[],targets:[]})).toThrow());
  it("rejects future schema versions",()=>expect(()=>validateState({...state(),version:99})).toThrow());
  it("rejects empty client books",()=>expect(()=>validateState({...state(),clients:[]})).toThrow());
  it("rejects targets not totaling 100",()=>expect(()=>validateState({...state(),targets:[]})).toThrow(/100/));
  it("rejects target outside its mandate limits",()=>expect(()=>validateState({...state(),targets:[{clientId:"c",assetClass:"Cash",targetPct:100,maxPct:90}]})).toThrow());
  it("normalizes symbols and codes",()=>expect(validateState(state([trade("BUY",1,100,1,{symbol:"x"})])).transactions[0].symbol).toBe("X"));
});
