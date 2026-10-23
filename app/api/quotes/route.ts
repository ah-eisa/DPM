import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function fetchYahooChart(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 DPMDesk/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") throw new Error("No quote");
  const price = meta.regularMarketPrice as number;
  const previousClose =
    typeof meta.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : typeof meta.previousClose === "number"
        ? meta.previousClose
        : undefined;
  return {
    symbol: symbol.toUpperCase(),
    price,
    previousClose,
    changePct: previousClose ? ((price - previousClose) / previousClose) * 100 : undefined,
    currency: meta.currency as string | undefined,
    asOf: new Date().toISOString(),
    source: "Yahoo Finance",
  };
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 50)
    )
  );

  if (!symbols.length) return NextResponse.json({ quotes: {}, errors: {} });

  const settled = await Promise.allSettled(symbols.map(fetchYahooChart));
  const quotes: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  settled.forEach((item, index) => {
    const symbol = symbols[index];
    if (item.status === "fulfilled") quotes[symbol] = item.value;
    else errors[symbol] = item.reason instanceof Error ? item.reason.message : "Quote unavailable";
  });

  return NextResponse.json({ quotes, errors }, { headers: { "Cache-Control": "no-store" } });
}
