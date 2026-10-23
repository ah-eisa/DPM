import { marketDataProvider, parseYahooQuote } from "./market-data";

const provider = marketDataProvider();

export function parseSymbols(raw: string) {
  if (raw.length > 2200) throw new Error("Symbol query too long");
  const symbols = Array.from(new Set(raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)));
  if (symbols.length > 50) throw new Error("Maximum 50 symbols per request");
  if (symbols.some(s => !/^[A-Z0-9^][A-Z0-9.^=\-]{0,39}$/.test(s))) throw new Error("Invalid market symbol");
  return symbols;
}

export const parseYahoo = parseYahooQuote;
export async function getQuote(symbol: string) { return provider.quote(symbol); }
