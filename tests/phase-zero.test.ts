import { describe, expect, it } from "vitest";
import { calculatePerformance, HistorySeries } from "../lib/performance";
import { parseYahooHistory } from "../lib/market-data";
import { seedState } from "../lib/storage";
import { validateState } from "../lib/validation";
const client={...seedState.clients[0],id:"c",code:"C",initialCash:1000,benchmark:"SPY"};
const base={...seedState,clients:[client],transactions:[],cashMovements:[],corporateActions:[],targets:[{clientId:"c",assetClass:"Cash" as const,targetPct:100}]};
const history=(symbol:string,rows:[string,number][]):HistorySeries=>({symbol,currency:"USD",points:rows.map(([date,close])=>({date,close}))});
describe("phase-zero performance integrity",()=>{
  it("includes total capital loss rather than silently reporting the last positive valuation",()=>{
    const state=validateState({...base,cashMovements:[{id:"fee",clientId:"c",sequence:1,kind:"FEE",amount:1000,currency:"USD",fxRate:1,movementDate:"2026-01-04"}]});
    const p=calculatePerformance(state,client,[history("SPY",[["2026-01-01",100],["2026-01-02",100],["2026-01-03",100],["2026-01-04",100]])],"2026-01-02","2026-01-04");
    expect(p.endValue).toBe(0);expect(p.twrPct).toBe(-100);expect(p.points.at(-1)?.date).toBe("2026-01-04");
  });
  it("preserves final withdrawals as flows with zero ending value",()=>{
    const state=validateState({...base,cashMovements:[{id:"w",clientId:"c",sequence:1,kind:"WITHDRAWAL",amount:1000,currency:"USD",fxRate:1,movementDate:"2026-01-03"}]});
    const p=calculatePerformance(state,client,[history("SPY",[["2026-01-01",100],["2026-01-02",100],["2026-01-03",100]])],"2026-01-02","2026-01-03");
    expect(p.endValue).toBe(0);expect(p.twrPct).toBe(0);expect(p.externalFlows).toBe(-1000);
  });
  it("does not fabricate benchmark or excess returns without an opening anchor",()=>{
    const p=calculatePerformance(base,client,[history("SPY",[["2026-01-02",100],["2026-01-03",110]])],"2026-01-02","2026-01-03");
    expect(p.benchmarkPct).toBeUndefined();expect(p.excessPct).toBeUndefined();
  });
  it("undoes Yahoo split adjustment before applying recorded corporate actions",()=>{
    const price=124.80750274658203, close=134.17999267578125;
    const data={chart:{result:[{meta:{currency:"USD"},timestamp:[1598572800,1598832000,1598918400],indicators:{quote:[{close:[price,129.0399932861328,close]}],adjclose:[{adjclose:[price,129.0399932861328,close]}]},events:{splits:{split:{date:1598832000,numerator:4,denominator:1}}}}]}};
    const series=parseYahooHistory("AAPL",data);
    expect(series.points[0].close).toBeCloseTo(price*4);expect(series.points[0].adjustedClose).toBe(price);
    const c={...client,initialCash:price*4};
    const state=validateState({...base,clients:[c],transactions:[{id:"buy",sequence:1,clientId:"c",symbol:"AAPL",assetClass:"US Equity",side:"BUY",quantity:1,price:price*4,fees:0,currency:"USD",fxRate:1,tradeDate:"2020-08-28"}],corporateActions:[{id:"split",sequence:2,clientId:"c",symbol:"AAPL",kind:"SPLIT",factor:4,actionDate:"2020-08-31"}]});
    const p=calculatePerformance(state,c,[series,history("SPY",[["2020-08-28",100],["2020-08-31",100],["2020-09-01",100]])],"2020-08-31","2020-09-01");
    expect(p.startValue).toBeCloseTo(price*4);expect(p.twrPct).toBeCloseTo((close/price-1)*100);
  });
  it("restores reverse splits and compounded later splits as well",()=>{
    const data={chart:{result:[{meta:{currency:"USD"},timestamp:[1598572800,1598832000],indicators:{quote:[{close:[100,200]}]},events:{splits:{a:{date:1598832000,numerator:1,denominator:2},b:{date:1598918400,numerator:3,denominator:1}}}}]}};
    expect(parseYahooHistory("X",data).points.map(p=>p.close)).toEqual([150,600]);
  });
});
