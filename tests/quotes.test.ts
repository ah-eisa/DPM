import { afterEach, describe, expect, it, vi } from "vitest";
import { getQuote, parseSymbols, parseYahoo } from "../lib/quotes";
const payload = {chart:{result:[{meta:{regularMarketPrice:100,regularMarketTime:1700000000,currency:"USD",previousClose:99,chartPreviousClose:95}}]}};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("market data",()=>{
  it("normalizes and deduplicates symbols",()=>expect(parseSymbols(" aapl,AAPL, BTC-USD, AEDUSD=X ")).toEqual(["AAPL","BTC-USD","AEDUSD=X"]));
  it("rejects malformed symbols",()=>expect(()=>parseSymbols("<script>")).toThrow());
  it("rejects excess symbols instead of silently dropping them",()=>expect(()=>parseSymbols(Array.from({length:51},(_,i)=>`X${i}`).join(","))).toThrow());
  it("uses market time and previous daily close",()=>{const q=parseYahoo("X",payload);expect(q.asOf).toBe(new Date(1700000000000).toISOString());expect(q.previousClose).toBe(99);});
  it("rejects malformed provider payload",()=>expect(()=>parseYahoo("X",{})).toThrow());
  it("normalizes pence rather than valuing them as pounds",()=>{const q=parseYahoo("X",{chart:{result:[{meta:{...payload.chart.result[0].meta,currency:"GBp"}}]}});expect(q.currency).toBe("GBP");expect(q.price).toBe(1);expect(q.previousClose).toBe(.99);});
  it("rejects unsupported quote units",()=>expect(()=>parseYahoo("X",{chart:{result:[{meta:{...payload.chart.result[0].meta,currency:"???"}}]}})).toThrow());
  it("caches, coalesces and returns an explicitly stale fallback",async()=>{
    vi.useFakeTimers();const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>payload});vi.stubGlobal("fetch",fetch);
    const [a,b]=await Promise.all([getQuote("TEST-CACHE"),getQuote("TEST-CACHE")]);expect(a).toEqual(b);expect(fetch).toHaveBeenCalledTimes(1);
    await getQuote("TEST-CACHE");expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61000);fetch.mockRejectedValue(new Error("offline"));expect((await getQuote("TEST-CACHE")).stale).toBe(true);
    expect(fetch.mock.calls[0][0]).toContain("range=1d");expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    vi.advanceTimersByTime(86400000);await expect(getQuote("TEST-CACHE")).rejects.toThrow("offline");
  });
});
