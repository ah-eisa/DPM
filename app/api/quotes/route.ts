import { NextRequest, NextResponse } from "next/server";
import { getQuote, parseSymbols } from "@/lib/quotes";
export const dynamic = "force-dynamic";
let requests = { count: 0, until: 0 };
export async function GET(request: NextRequest) {
  let symbols: string[];
  try { symbols = parseSymbols(request.nextUrl.searchParams.get("symbols") ?? ""); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  if (requests.until < Date.now()) requests = { count: 0, until: Date.now() + 60_000 };
  if (++requests.count > 120) return NextResponse.json({ error: "Quote service busy; retry shortly" }, { status: 429, headers: { "Retry-After": "60" } });
  const quotes: Record<string, unknown> = {}, errors: Record<string, string> = {};
  for (let i = 0; i < symbols.length; i += 5) {
    await Promise.all(symbols.slice(i, i + 5).map(async symbol => {
      try { const quote = await getQuote(symbol); quotes[symbol] = quote; if (quote.stale) errors[symbol] = "Provider unavailable: cached quote"; }
      catch (error) { errors[symbol] = error instanceof Error ? error.message : "Quote unavailable"; }
    }));
  }
  return NextResponse.json({ quotes, errors }, { headers: { "Cache-Control": "no-store" } });
}
