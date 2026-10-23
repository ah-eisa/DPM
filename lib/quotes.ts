import { Quote } from "./types";
import { currency } from "./validation";
const cache = new Map<string, { quote: Quote; at: number }>();
const pending = new Map<string, Promise<Quote>>();
export function parseSymbols(raw: string) {
  if (raw.length > 2200) throw new Error("Symbol query too long");
  const symbols = Array.from(new Set(raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)));
  if (symbols.length > 50) throw new Error("Maximum 50 symbols per request");
  if (symbols.some(s => !/^[A-Z0-9^][A-Z0-9.^=\-]{0,39}$/.test(s))) throw new Error("Invalid market symbol");
  return symbols;
}
export function parseYahoo(symbol: string, data: unknown): Quote {
  const meta = (data as { chart?: { result?: { meta?: Record<string, unknown> }[] } })?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number" || !Number.isFinite(meta.regularMarketPrice) || meta.regularMarketPrice < 0 || typeof meta.regularMarketTime !== "number" || !Number.isFinite(meta.regularMarketTime) || typeof meta.currency !== "string") throw new Error("Invalid provider quote");
  // With range=1d chartPreviousClose is a daily baseline, not a five-day baseline.
  const previous = meta.previousClose ?? meta.chartPreviousClose;
  const previousClose = typeof previous === "number" && Number.isFinite(previous) && previous > 0 ? previous : undefined;
  const subunit = meta.currency === "GBp" || meta.currency === "GBX" || meta.currency === "ZAc";
  const quoteCurrency = meta.currency === "GBp" || meta.currency === "GBX" ? "GBP" : meta.currency === "ZAc" ? "ZAR" : currency(meta.currency);
  const divisor = subunit ? 100 : 1;
  return { symbol, price: meta.regularMarketPrice / divisor, currency: quoteCurrency, previousClose: previousClose == null ? undefined : previousClose / divisor, changePct: previousClose ? (meta.regularMarketPrice - previousClose) / previousClose * 100 : undefined, asOf: new Date(meta.regularMarketTime * 1000).toISOString(), fetchedAt: new Date().toISOString(), source: "Yahoo Finance" };
}
export async function getQuote(symbol: string): Promise<Quote> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < 60_000) return cached.quote;
  const existing = pending.get(symbol); if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`, { cache: "no-store", signal: AbortSignal.timeout(5000), headers: { "User-Agent": "DPMDesk/1.0", Accept: "application/json" } });
      if (!response.ok) throw new Error(`Market provider returned ${response.status}`);
      const quote = parseYahoo(symbol, await response.json());
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(symbol, { quote, at: Date.now() }); return quote;
    } catch (error) {
      if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return { ...cached.quote, stale: true };
      throw error;
    } finally { pending.delete(symbol); }
  })();
  pending.set(symbol, request); return request;
}
