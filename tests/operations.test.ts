import { describe, expect, it } from "vitest";
import { allocateMasterExecution, importGtnCsv, maxLedgerSequence } from "../lib/operations";
import { DpmState } from "../lib/types";
import { validateState } from "../lib/validation";

const base: DpmState = {
  version:3,
  clients:[
    {id:"c1",code:"C001",label:"One",baseCurrency:"USD",benchmark:"SPY",riskProfile:"Balanced",initialCash:100000},
    {id:"c2",code:"C002",label:"Two",baseCurrency:"USD",benchmark:"SPY",riskProfile:"Balanced",initialCash:100000},
  ],
  transactions:[],cashMovements:[],corporateActions:[],
  targets:[{clientId:"c1",assetClass:"Cash",targetPct:100},{clientId:"c2",assetClass:"Cash",targetPct:100}],
};

describe("master allocation",()=>{
  it("allocates quantity and fees pro rata across clients",()=>{
    const txs=allocateMasterExecution(base,{symbol:"NVDA",assetClass:"US Equity",side:"BUY",totalQuantity:100,price:200,fees:10,currency:"USD",fxRate:1,tradeDate:"2026-10-23",gtnRef:"GTN-1"},[{clientId:"c1",quantity:40},{clientId:"c2",quantity:60}]);
    expect(txs).toHaveLength(2);expect(txs[0]).toMatchObject({quantity:40,fees:4,gtnRef:"GTN-1-1"});expect(txs[1]).toMatchObject({quantity:60,fees:6,gtnRef:"GTN-1-2"});
    expect(()=>validateState({...base,transactions:txs})).not.toThrow();
  });
  it("rejects allocations that do not equal the master quantity",()=>expect(()=>allocateMasterExecution(base,{symbol:"NVDA",assetClass:"US Equity",side:"BUY",totalQuantity:100,price:1,fees:0,currency:"USD",fxRate:1,tradeDate:"2026-10-23"},[{clientId:"c1",quantity:90}])).toThrow(/must equal/));
  it("uses the next ledger sequence",()=>{const s={...base,cashMovements:[{id:"m",clientId:"c1",sequence:7,kind:"DEPOSIT" as const,amount:10,currency:"USD",fxRate:1,movementDate:"2026-10-22"}]};expect(maxLedgerSequence(s)).toBe(7);expect(allocateMasterExecution(s,{symbol:"AAPL",assetClass:"US Equity",side:"BUY",totalQuantity:1,price:100,fees:0,currency:"USD",fxRate:1,tradeDate:"2026-10-23"},[{clientId:"c1",quantity:1}])[0].sequence).toBe(8);});
  it("rejects mixed base currencies in one master allocation",()=>{const s={...base,clients:[base.clients[0],{...base.clients[1],baseCurrency:"AED"}]};expect(()=>allocateMasterExecution(s,{symbol:"AAPL",assetClass:"US Equity",side:"BUY",totalQuantity:2,price:100,fees:0,currency:"USD",fxRate:.2723,tradeDate:"2026-10-23"},[{clientId:"c1",quantity:1},{clientId:"c2",quantity:1}])).toThrow(/same base currency/);});
});

describe("GTN CSV import",()=>{
  it("imports common GTN-style headers and validates rows",()=>{
    const csv=`Client,Side,Symbol,Quantity,Price,Commission,Currency,FX Rate,Trade Date,GTN Ref,Asset Class,Security Name\nC001,BUY,AAPL,10,200,5,USD,1,2026-10-23,REF-1,US Equity,Apple\nC002,B,SPY,2,700,1,USD,1,2026-10-23,REF-2,ETF,SPDR S&P 500 ETF`;
    const txs=importGtnCsv(csv,base);expect(txs).toHaveLength(2);expect(txs[0]).toMatchObject({clientId:"c1",symbol:"AAPL",fees:5,gtnRef:"REF-1",assetClass:"US Equity"});expect(txs[1]).toMatchObject({clientId:"c2",side:"BUY",symbol:"SPY",assetClass:"ETF"});
  });
  it("parses quoted CSV fields containing commas",()=>{const csv=`Account,Side,Ticker,Qty,Price,Date,Name\nC001,BUY,AAPL,1,200,2026-10-23,"Apple, Inc."`;expect(importGtnCsv(csv,base)[0].name).toBe("Apple, Inc.");});
  it("rejects unknown client codes",()=>{const csv=`Client,Side,Symbol,Quantity,Price,Trade Date\nC999,BUY,AAPL,1,200,2026-10-23`;expect(()=>importGtnCsv(csv,base)).toThrow(/unknown client/);});
  it("requires FX for foreign currency rows",()=>{const csv=`Client,Side,Symbol,Quantity,Price,Currency,Trade Date\nC001,BUY,EMAAR.AE,1,14,AED,2026-10-23`;expect(()=>importGtnCsv(csv,base)).toThrow(/requires FX rate/);});
  it("rejects a duplicate GTN reference",()=>{const s={...base,transactions:[{id:"t",sequence:1,clientId:"c1",symbol:"AAPL",assetClass:"US Equity" as const,side:"BUY" as const,quantity:1,price:100,fees:0,fxRate:1,currency:"USD",tradeDate:"2026-10-20",gtnRef:"REF-1"}]};const csv=`Client,Side,Symbol,Quantity,Price,Trade Date,GTN Ref\nC001,BUY,MSFT,1,300,2026-10-23,REF-1`;expect(()=>importGtnCsv(csv,s)).toThrow(/duplicate GTN reference/);});
});
