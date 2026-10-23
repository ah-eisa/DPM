import { NextRequest, NextResponse } from "next/server";
import { guardMarketLoginAttempt, MARKET_API_COOKIE, marketApiSessionValue, verifyMarketAccessToken } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const limited = guardMarketLoginAttempt(request);
  if (!limited.ok) return NextResponse.json({ error: limited.error }, { status: limited.status, headers: limited.headers });

  const configured = process.env.DPM_API_ACCESS_TOKEN?.trim() ?? "";
  if (!configured) return NextResponse.json({ error: "Market API access token is not configured on the server" }, { status: 503 });

  let supplied = "";
  try {
    const body = await request.json() as { token?: unknown };
    supplied = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid access request" }, { status: 400 });
  }

  if (!verifyMarketAccessToken(supplied, configured)) return NextResponse.json({ error: "Invalid market-data access token" }, { status: 401 });

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: MARKET_API_COOKIE,
    value: marketApiSessionValue(configured),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: MARKET_API_COOKIE, value: "", httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
