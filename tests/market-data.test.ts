import { describe, expect, it } from "vitest";
import { CascadingMarketDataProvider, MarketDataProvider, parseYahooHistory } from "../lib/market-data";
import { Quote } from "../lib/types";

const live=(symbol:string,price:number):Quote=>({symbol,price,currency:"USD",asOf:"2026-10-23T20:00:00.000Z",source:"test"});
const provider=(quoteImpl:()=>Promise<Quote>,historyImpl:MarketDataProvider["history"]):MarketDataProvider=>({name:"test",quote:quoteImpl,history:historyImpl});

describe("cascading market data",()=>{
  it("uses a secondary provider after a primary quote failure",async()=>{
    const primary=provider(async()=>{throw new Error("down");},async()=>{throw new Error("down");});
    const secondary=provider(async()=>live("AAPL",200),async(symbol)=>({symbol,currency:"USD",points:[{date:"2026-10-01",close:100}]}));
    await expect(new CascadingMarketDataProvider([primary,secondary]).quote("AAPL")).resolves.toMatchObject({price:200});
  });
  it("prefers a live secondary quote over a stale primary quote",async()=>{
    const primary=provider(async()=>({...live("AAPL",190),stale:true}),async()=>{throw new Error("down");});
    const secondary=provider(async()=>live("AAPL",200),async(symbol)=>({symbol,currency:"USD",points:[{date:"2026-10-01",close:100}]}));
    const result=await new CascadingMarketDataProvider([primary,secondary]).quote("AAPL");
    expect(result.price).toBe(200);expect(result.stale).not.toBe(true);
  });
  it("preserves raw and adjusted Yahoo history separately",()=>{
    const series=parseYahooHistory("ABC",{chart:{result:[{meta:{currency:"USD"},timestamp:[1790812800],indicators:{quote:[{close:[50]}],adjclose:[{adjclose:[25]}]}}]}});
    expect(series.points[0]).toMatchObject({close:50,adjustedClose:25});
  });
});
