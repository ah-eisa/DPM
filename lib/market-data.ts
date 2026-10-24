import { Quote } from "./types";
import { currency } from "./validation";

export type HistoryInterval = "1d" | "1wk";
export type MarketHistoryPoint = { date: string; close: number; adjustedClose?: number };
export type MarketHistorySeries = { symbol: string; currency: string; points: MarketHistoryPoint[]; source?: string };

export interface MarketDataProvider {
  readonly name: string;
  quote(symbol: string): Promise<Quote>;
  history(symbol: string, start: number, end: number, interval: HistoryInterval): Promise<MarketHistorySeries>;
}

const quoteCache = new Map<string, { quote: Quote; at: number }>();
const quotePending = new Map<string, Promise<Quote>>();

export function parseYahooQuote(symbol: string, data: unknown): Quote {
  const meta = (data as { chart?: { result?: { meta?: Record<string, unknown> }[] } })?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number" || !Number.isFinite(meta.regularMarketPrice) || meta.regularMarketPrice < 0 || typeof meta.regularMarketTime !== "number" || !Number.isFinite(meta.regularMarketTime) || typeof meta.currency !== "string") throw new Error("Invalid provider quote");
  const previous = meta.previousClose ?? meta.chartPreviousClose;
  const previousClose = typeof previous === "number" && Number.isFinite(previous) && previous > 0 ? previous : undefined;
  const subunit = meta.currency === "GBp" || meta.currency === "GBX" || meta.currency === "ZAc";
  const quoteCurrency = meta.currency === "GBp" || meta.currency === "GBX" ? "GBP" : meta.currency === "ZAc" ? "ZAR" : currency(meta.currency);
  const divisor = subunit ? 100 : 1;
  return { symbol, price: meta.regularMarketPrice / divisor, currency: quoteCurrency, previousClose: previousClose == null ? undefined : previousClose / divisor, changePct: previousClose ? (meta.regularMarketPrice - previousClose) / previousClose * 100 : undefined, asOf: new Date(meta.regularMarketTime * 1000).toISOString(), fetchedAt: new Date().toISOString(), source: "Yahoo Finance" };
}

export function parseYahooHistory(symbol:string,data:unknown):MarketHistorySeries{
  const result=(data as {chart?:{result?:Array<{meta?:{currency?:string},timestamp?:number[],events?:{splits?:Record<string,{date:number;numerator:number;denominator:number}>},indicators?:{adjclose?:Array<{adjclose?:(number|null)[]}>,quote?:Array<{close?:(number|null)[]}>}}>}})?.chart?.result?.[0];
  const rawCurrency=result?.meta?.currency;if(!result||!rawCurrency)throw new Error("Invalid historical provider response");
  const ccy=rawCurrency==="GBp"||rawCurrency==="GBX"?"GBP":rawCurrency==="ZAc"?"ZAR":currency(rawCurrency),divisor=rawCurrency==="GBp"||rawCurrency==="GBX"||rawCurrency==="ZAc"?100:1,ts=result.timestamp??[],raw=result.indicators?.quote?.[0]?.close??[],adjusted=result.indicators?.adjclose?.[0]?.adjclose??[],points:MarketHistoryPoint[]=[];
  const splits=Object.values(result.events?.splits??{}).map(s=>({date:new Date(s.date*1000).toISOString().slice(0,10),factor:s.numerator/s.denominator}));
  if(splits.some(s=>!Number.isFinite(s.factor)||s.factor<=0))throw new Error("Invalid provider split event");
  for(let i=0;i<Math.min(ts.length,raw.length);i++){const close=raw[i];if(typeof close!=="number"||!Number.isFinite(close)||close<0)continue;const date=new Date(ts[i]*1000).toISOString().slice(0,10);const factor=splits.filter(s=>s.date>date).reduce((n,s)=>n*s.factor,1);const restored=close/divisor*factor;if(!Number.isFinite(restored))throw new Error("Historical price exceeds supported range");const adj=adjusted[i];points.push({date,close:restored,...(typeof adj==="number"&&Number.isFinite(adj)&&adj>=0?{adjustedClose:adj/divisor}:{})});}
  if(!points.length)throw new Error("No historical prices");return{symbol,currency:ccy,points,source:"Yahoo Finance"};
}

export class YahooMarketDataProvider implements MarketDataProvider {
  readonly name="Yahoo Finance";
  async quote(symbol:string):Promise<Quote>{
    const cached=quoteCache.get(symbol);if(cached&&Date.now()-cached.at<60_000)return cached.quote;const existing=quotePending.get(symbol);if(existing)return existing;
    const request=(async()=>{try{const response=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,{cache:"no-store",signal:AbortSignal.timeout(5000),headers:{"User-Agent":"DPMDesk/1.0",Accept:"application/json"}});if(!response.ok)throw new Error(`Market provider returned ${response.status}`);const quote=parseYahooQuote(symbol,await response.json());if(quoteCache.size>=500){const first=quoteCache.keys().next().value;if(first)quoteCache.delete(first);}quoteCache.set(symbol,{quote,at:Date.now()});return quote;}catch(error){if(cached&&Date.now()-cached.at<24*60*60*1000)return{...cached.quote,stale:true};throw error;}finally{quotePending.delete(symbol);}})();quotePending.set(symbol,request);return request;
  }
  async history(symbol:string,start:number,end:number,interval:HistoryInterval){const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(start/1000)}&period2=${Math.floor(Math.max(end,Date.now())/1000)+86400}&interval=${interval}&events=div%2Csplits`;const res=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(8000),headers:{"User-Agent":"DPMDesk/1.0",Accept:"application/json"}});if(!res.ok)throw new Error(`Market provider returned ${res.status}`);const series=parseYahooHistory(symbol,await res.json());const endDay=new Date(end).toISOString().slice(0,10);return {...series,points:series.points.filter(p=>p.date<=endDay)};}
}

function validQuote(value:unknown,symbol:string,source:string):Quote{const q=value as Partial<Quote>;if(!q||typeof q.price!=="number"||!Number.isFinite(q.price)||q.price<0||typeof q.currency!=="string"||typeof q.asOf!=="string")throw new Error("Fallback provider returned invalid quote");return{symbol,price:q.price,currency:currency(q.currency),previousClose:typeof q.previousClose==="number"?q.previousClose:undefined,changePct:typeof q.changePct==="number"?q.changePct:undefined,asOf:q.asOf,fetchedAt:new Date().toISOString(),source:q.source||source,stale:Boolean(q.stale)};}
function validHistory(value:unknown,symbol:string,source:string):MarketHistorySeries{const s=value as Partial<MarketHistorySeries>;if(!s||typeof s.currency!=="string"||!Array.isArray(s.points))throw new Error("Fallback provider returned invalid history");const points=s.points.filter(p=>p&&typeof p.date==="string"&&typeof p.close==="number"&&Number.isFinite(p.close)&&p.close>=0).map(p=>({date:p.date,close:p.close,...(typeof p.adjustedClose==="number"&&Number.isFinite(p.adjustedClose)&&p.adjustedClose>=0?{adjustedClose:p.adjustedClose}:{})}));if(!points.length)throw new Error("Fallback provider returned no history");return{symbol,currency:currency(s.currency),points,source:s.source||source};}

export class HttpMarketDataProvider implements MarketDataProvider {
  readonly name="Secondary market data";constructor(private readonly baseUrl:string,private readonly token?:string){}
  private async get(path:string){const response=await fetch(`${this.baseUrl.replace(/\/$/,"")}${path}`,{cache:"no-store",signal:AbortSignal.timeout(8000),headers:{Accept:"application/json",...(this.token?{Authorization:`Bearer ${this.token}`}:{})}});if(!response.ok)throw new Error(`Secondary provider returned ${response.status}`);return response.json();}
  async quote(symbol:string){return validQuote(await this.get(`/quote?symbol=${encodeURIComponent(symbol)}`),symbol,this.name);}
  async history(symbol:string,start:number,end:number,interval:HistoryInterval){return validHistory(await this.get(`/history?symbol=${encodeURIComponent(symbol)}&start=${new Date(start).toISOString().slice(0,10)}&end=${new Date(end).toISOString().slice(0,10)}&interval=${interval}`),symbol,this.name);}
}

export class CascadingMarketDataProvider implements MarketDataProvider {
  readonly name="Cascading market data";constructor(private readonly providers:MarketDataProvider[]){}
  async quote(symbol:string){let stale:Quote|undefined,last:unknown;for(const provider of this.providers){try{const quote=await provider.quote(symbol);if(!quote.stale)return quote;stale??=quote;}catch(e){last=e;}}if(stale)return stale;throw last instanceof Error?last:new Error("All market-data providers failed");}
  async history(symbol:string,start:number,end:number,interval:HistoryInterval){let last:unknown;for(const provider of this.providers){try{return await provider.history(symbol,start,end,interval);}catch(e){last=e;}}throw last instanceof Error?last:new Error("All market-data providers failed");}
}

export function marketDataProvider():MarketDataProvider{const providers:MarketDataProvider[]=[new YahooMarketDataProvider()];const url=process.env.DPM_SECONDARY_MARKET_DATA_URL;if(url)providers.push(new HttpMarketDataProvider(url,process.env.DPM_SECONDARY_MARKET_DATA_TOKEN));return new CascadingMarketDataProvider(providers);}
