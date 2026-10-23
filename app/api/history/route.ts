import { NextRequest, NextResponse } from "next/server";
import { guardMarketApi } from "@/lib/api-guard";
import { HistoryInterval, marketDataProvider, MarketHistorySeries } from "@/lib/market-data";
import { currency } from "@/lib/validation";

export const dynamic = "force-dynamic";
const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.^=\-]{0,39}$/;
const provider = marketDataProvider();

function parseDate(value: string | null, name: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${name}`);
  const t = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new Error(`Invalid ${name}`);
  return t;
}

export async function GET(request:NextRequest){
  const guard = guardMarketApi(request, "history", 30);
  if (!guard.ok) return NextResponse.json({error:guard.error},{status:guard.status,headers:guard.headers});

  try{
    const raw=(request.nextUrl.searchParams.get("symbols")??"").toUpperCase();
    const symbols=Array.from(new Set(raw.split(",").map(x=>x.trim()).filter(Boolean)));
    if(!symbols.length || symbols.length>25 || symbols.some(s=>!SYMBOL_RE.test(s))) throw new Error("Provide 1 to 25 valid symbols");
    const start=parseDate(request.nextUrl.searchParams.get("start"),"start date");
    const end=parseDate(request.nextUrl.searchParams.get("end"),"end date");
    if(end<start) throw new Error("End date must be after start date");
    const days=(end-start)/86400000;
    if(days>3660) throw new Error("Maximum history window is 10 years");
    const interval:HistoryInterval=days>800?"1wk":"1d";
    const output:Record<string,MarketHistorySeries>={},errors:Record<string,string>={};
    for(let i=0;i<symbols.length;i+=5){
      await Promise.all(symbols.slice(i,i+5).map(async symbol=>{try{output[symbol]=await provider.history(symbol,start,end,interval);}catch(e){errors[symbol]=e instanceof Error?e.message:"History unavailable";}}));
    }
    const base=(request.nextUrl.searchParams.get("base")??"").toUpperCase();
    if(base){
      currency(base);
      const pairs=new Set<string>();
      for(const s of Object.values(output)) if(s.currency!==base) pairs.add(`${s.currency}${base}=X`);
      for(const pair of pairs) if(!output[pair]) try{output[pair]=await provider.history(pair,start,end,interval);}catch(e){errors[pair]=e instanceof Error?e.message:"FX history unavailable";}
    }
    return NextResponse.json({series:output,errors,interval,priceModel:{portfolio:"raw-close",benchmark:"adjusted-close-when-available"}},{headers:{"Cache-Control":"private, max-age=300"}});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid history request"},{status:400});}
}
