import { timingSafeEqual } from "node:crypto";

type RequestLike = { headers: Headers };
type GuardFailure = { ok: false; status: number; error: string; headers?: Record<string, string> };
export type ApiGuardResult = { ok: true } | GuardFailure;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function tokenEqual(expected: string, supplied: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clientIp(request: RequestLike) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || "unknown";
}

function rateLimit(key: string, limit: number, now = Date.now()): GuardFailure | null {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  const retry = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return { ok: false, status: 429, error: "Market data request limit exceeded; retry shortly", headers: { "Retry-After": String(retry) } };
}

export function guardMarketApi(request: RequestLike, scope: string, limitPerMinute: number, options?: { token?: string; production?: boolean; now?: number }): ApiGuardResult {
  const expected = (options?.token ?? process.env.DPM_API_ACCESS_TOKEN ?? "").trim();
  const production = options?.production ?? process.env.NODE_ENV === "production";
  const now = options?.now ?? Date.now();
  const ip = clientIp(request);

  if (!expected) {
    if (production) return { ok: false, status: 503, error: "Market API access token is not configured" };
    return rateLimit(`${scope}:${ip}`, limitPerMinute, now) ?? { ok: true };
  }

  const auth = request.headers.get("authorization") ?? "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!supplied || !tokenEqual(expected, supplied)) {
    const blocked = rateLimit(`unauthorized:${ip}`, 20, now);
    if (blocked) return blocked;
    return { ok: false, status: 401, error: "Market API authentication required", headers: { "WWW-Authenticate": "Bearer" } };
  }

  return rateLimit(`${scope}:${ip}`, limitPerMinute, now) ?? { ok: true };
}

export function resetApiGuardForTests() { buckets.clear(); }
