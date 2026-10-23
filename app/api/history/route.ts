import { NextRequest, NextResponse } from "next/server";
import { currency } from "@/lib/validation";

export const dynamic = "force-dynamic";
const SYMBOL_RE = /^[A-Z0-9^][A-Z0-9.^=\-]{0,39}$/;

type Point = { date: string; close: number };
type Series = { symbol: string; currency: string; points: Point[] };

function parseDate(value: string | null, name: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${name}`);
  const t = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(t)) throw new Error(`Invalid ${name}`);
  return t;
}

async function yahoo(symbol: string, start: number, end: number, interval: string): Promise<Series> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(start/1000)}&period2=${Math.floor(end/1000)+86400}&interval=${interval}&events=div%2Csplits`;
  const res = await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(8000),headers:{"User-Agent":"DPMDesk/1.0",Accept:"application/json"}});
  if(!res.ok) throw new Error(`Market provider returned ${res.status}`);
  const data = await res.json() as {chart?:{result?:Array<{meta?:{currency?:string},timestamp?:number[],indicators?:{adjclose?:Array<{adjclose?:(number|null)[]}>,quote?:Array<{close?:(number|null)[]}>}}>}};
  const result=data.chart?.result?.[0];
  const rawCurrency=result?.meta?.currency;
  if(!result || !rawCurrency) throw new Error("Invalid historical provider response");
  const ccy = rawCurrency === "GBp" || rawCurrency === "GBX" ? "GBP" : rawCurrency === "ZAc" ? "ZAR" : currency(rawCurrency);
  const divisor = rawCurrency === "GBp" || rawCurrency === "GBX" || rawCurrency === "ZAc" ? 100 : 1;
  const ts=result.timestamp??[];
  const closes=result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close ?? [];
  const points:Point[]=[];
  for(let i=0;i<Math.min(ts.length,closes.length);i++){
    const close=closes[i]; if(typeof close!=="number" || !Number.isFinite(close) || close<=0) continue;
    points.push({date:new Date(ts[i]*1000).toISOString().slice(0,10),close:close/divisor});
  }
  if(!points.length) throw new Error("No historical prices");
  return {symbol,currency:ccy,points};
}

export async function GET(request:NextRequest){
  try{
    const raw=(request.nextUrl.searchParams.get("symbols")??"").toUpperCase();
    const symbols=Array.from(new Set(raw.split(",").map(x=>x.trim()).filter(Boolean)));
    if(!symbols.length || symbols.length>25 || symbols.some(s=>!SYMBOL_RE.test(s))) throw new Error("Provide 1 to 25 valid symbols");
    const start=parseDate(request.nextUrl.searchParams.get("start"),"start date");
    const end=parseDate(request.nextUrl.searchParams.get("end"),"end date");
    if(end<start) throw new Error("End date must be after start date");
    const days=(end-start)/86400000;
    if(days>3660) throw new Error("Maximum history window is 10 years");
    const interval=days>800?"1wk":"1d";
    const output:Record<string,Series>={},errors:Record<string,string>={};
    for(let i=0;i<symbols.length;i+=5){
      await Promise.all(symbols.slice(i,i+5).map(async symbol=>{try{output[symbol]=await yahoo(symbol,start,end,interval);}catch(e){errors[symbol]=e instanceof Error?e.message:"History unavailable";}}));
    }
    const base=(request.nextUrl.searchParams.get("base")??"").toUpperCase();
    if(base){
      currency(base);
      const pairs=new Set<string>();
      for(const s of Object.values(output)) if(s.currency!==base) pairs.add(`${s.currency}${base}=X`);
      for(const pair of pairs) if(!output[pair]) try{output[pair]=await yahoo(pair,start,end,interval);}catch(e){errors[pair]=e instanceof Error?e.message:"FX history unavailable";}
    }
    return NextResponse.json({series:output,errors,interval},{headers:{"Cache-Control":"private, max-age=300"}});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid history request"},{status:400});}
}
