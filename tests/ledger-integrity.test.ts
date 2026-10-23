import { describe, expect, it } from "vitest";
import { importGtnCsv, maxLedgerSequence } from "../lib/operations";
import { DpmState } from "../lib/types";
import { validateState } from "../lib/validation";

const base: DpmState = {
  version: 3,
  clients: [{ id:"c1", code:"C001", label:"One", baseCurrency:"USD", benchmark:"SPY", riskProfile:"Balanced", initialCash:100000 }],
  transactions: [], cashMovements: [], corporateActions: [],
  targets: [{ clientId:"c1", assetClass:"Cash", targetPct:100 }],
};

describe("global ledger sequencing", () => {
  it("takes the maximum sequence across trades, cash and corporate actions", () => {
    const state: DpmState = {
      ...base,
      transactions:[{id:"t1",sequence:2,clientId:"c1",symbol:"AAPL",assetClass:"US Equity",side:"BUY",quantity:1,price:100,fees:0,fxRate:1,currency:"USD",tradeDate:"2026-10-20"}],
      cashMovements:[{id:"m1",clientId:"c1",sequence:8,kind:"DEPOSIT",amount:10,currency:"USD",fxRate:1,movementDate:"2026-10-21"}],
      corporateActions:[],
    };
    expect(maxLedgerSequence(state)).toBe(8);
  });

  it("rejects a sequence reused across different ledger event types", () => {
    const state: DpmState = {
      ...base,
      transactions:[{id:"t1",sequence:1,clientId:"c1",symbol:"AAPL",assetClass:"US Equity",side:"BUY",quantity:10,price:100,fees:0,fxRate:1,currency:"USD",tradeDate:"2026-10-20"}],
      cashMovements:[],
      corporateActions:[{id:"a1",clientId:"c1",sequence:1,kind:"SPLIT",symbol:"AAPL",actionDate:"2026-10-21",factor:2}],
    };
    expect(() => validateState(state)).toThrow(/ledger sequence must be globally unique/i);
  });
});

describe("CSV duplicate protection without GTN references", () => {
  it("rejects an exact probable duplicate already in the book", () => {
    const state: DpmState = {
      ...base,
      transactions:[{id:"t1",sequence:1,clientId:"c1",symbol:"AAPL",assetClass:"US Equity",side:"BUY",quantity:2,price:200,fees:1,fxRate:1,currency:"USD",tradeDate:"2026-10-20"}],
    };
    const csv = `Client,Side,Symbol,Quantity,Price,Commission,Currency,FX Rate,Trade Date\nC001,BUY,AAPL,2,200,1,USD,1,2026-10-20`;
    expect(() => importGtnCsv(csv,state)).toThrow(/probable duplicate/i);
  });

  it("allows the same economics when a unique GTN reference is supplied", () => {
    const state: DpmState = {
      ...base,
      transactions:[{id:"t1",sequence:1,clientId:"c1",symbol:"AAPL",assetClass:"US Equity",side:"BUY",quantity:2,price:200,fees:1,fxRate:1,currency:"USD",tradeDate:"2026-10-20"}],
    };
    const csv = `Client,Side,Symbol,Quantity,Price,Commission,Currency,FX Rate,Trade Date,GTN Ref\nC001,BUY,AAPL,2,200,1,USD,1,2026-10-20,NEW-REF`;
    expect(importGtnCsv(csv,state)).toHaveLength(1);
  });
});
