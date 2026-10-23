import { NextRequest, NextResponse } from "next/server";
import { guardMarketApi } from "@/lib/api-guard";
import { getQuote, parseSymbols } from "@/lib/quotes";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = guardMarketApi(request, "quotes", 120);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status, headers: guard.headers });

  let symbols: string[];
  try { symbols = parseSymbols(request.nextUrl.searchParams.get("symbols") ?? ""); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  const quotes: Record<string, unknown> = {}, errors: Record<string, string> = {};
  for (let i = 0; i < symbols.length; i += 5) {
    await Promise.all(symbols.slice(i, i + 5).map(async symbol => {
      try { const quote = await getQuote(symbol); quotes[symbol] = quote; if (quote.stale) errors[symbol] = "Provider unavailable: cached quote"; }
      catch (error) { errors[symbol] = error instanceof Error ? error.message : "Quote unavailable"; }
    }));
  }
  return NextResponse.json({ quotes, errors }, { headers: { "Cache-Control": "no-store" } });
}
