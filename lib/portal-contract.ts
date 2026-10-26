/** Public account contract. Standalone: no book, storage, ledger or private key dependency. */
export type PortalHolding = {
  securityId?: string;
  symbol: string;
  name?: string;
  assetClass: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  marketPrice: number;
  marketValue: number;
  realisedPnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  weightPct: number;
  valuationStatus: "live" | "stale" | "cost";
  valuationNote?: string;
  priceSource?: string;
  priceAsOf?: string;
};
export type PortalSnapshot = {
  schema: "dpm.client-portal.snapshot";
  version: "1.0";
  snapshotId: string;
  publishedAt: string;
  bookRevision: number;
  clientCode: string;
  accountId: string;
  baseCurrency: string;
  benchmark: string;
  riskProfile: "Conservative" | "Balanced" | "Growth" | "Custom";
  nav: number;
  cash: number;
  investedValue: number;
  realisedPnl: number;
  incomePnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  dayPnl: number;
  dayPnlComplete: boolean;
  valuationComplete: boolean;
  allocation: Record<string, number>;
  holdings: PortalHolding[];
  drift: {
    assetClass: string;
    targetPct: number;
    minPct?: number;
    maxPct?: number;
    actualPct: number;
    driftPct: number;
    breach: boolean;
  }[];
  priceLineage: { securityId: string; selected: string; rejected: string[] }[];
  performance?: {
    startDate: string;
    endDate: string;
    twrPct: number;
    benchmarkPct?: number;
    excessPct?: number;
    startValue: number;
    endValue: number;
    externalFlows: number;
    benchmarkLabel: string;
    points: {
      date: string;
      value: number;
      portfolioIndex: number;
      benchmarkIndex?: number;
    }[];
  };
  warnings: string[];
};
export type PublicationEnvelope = {
  schema: "dpm.client-portal.publication";
  version: "2.0";
  algorithm: "Ed25519";
  sourceId: string;
  streamId: string;
  publicationSequence: number;
  keyId: string;
  contentDigest: string;
  payload: PortalSnapshot;
  signature: string;
};
type Obj = Record<string, unknown>;
function fail(message: string): never {
  throw new Error(`Invalid DPM publication: ${message}`);
}
function object(value: unknown, allowed: string[], required = allowed): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("object required");
  const o = value as Obj;
  if (
    Object.keys(o).some((k) => !allowed.includes(k)) ||
    required.some((k) => o[k] === undefined)
  )
    fail("unexpected or missing fields");
  return o;
}
function text(value: unknown, max = 1000): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail("invalid text");
}
function number(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail("finite number required");
}
function flag(value: unknown) {
  if (typeof value !== "boolean") fail("boolean required");
}
function list(value: unknown, max = 10000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail("array limit");
  return value;
}
function optional(o: Obj, keys: string[], check: (v: unknown) => void) {
  for (const k of keys) if (o[k] !== undefined) check(o[k]);
}
function timestamp(value: unknown) {
  text(value, 50);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
    fail("timestamp required");
}
function date(value: unknown) {
  text(value, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    fail("invalid date");
}
export function validatePortalSnapshot(value: unknown): PortalSnapshot {
  const required =
    "schema version snapshotId publishedAt bookRevision clientCode accountId baseCurrency benchmark riskProfile nav cash investedValue realisedPnl incomePnl unrealisedPnl totalPnl dayPnl dayPnlComplete valuationComplete allocation holdings drift priceLineage warnings".split(
      " ",
    );
  const o = object(value, [...required, "performance"], required);
  if (o.schema !== "dpm.client-portal.snapshot" || o.version !== "1.0")
    fail("unsupported snapshot version");
  for (const k of ["snapshotId", "accountId", "clientCode", "benchmark"])
    text(o[k], 200);
  text(o.baseCurrency, 3);
  if (!/^[A-Z]{3}$/.test(o.baseCurrency)) fail("invalid currency");
  if (
    !["Conservative", "Balanced", "Growth", "Custom"].includes(
      String(o.riskProfile),
    )
  )
    fail("risk profile");
  timestamp(o.publishedAt);
  number(o.bookRevision);
  if (!Number.isSafeInteger(o.bookRevision) || o.bookRevision < 0)
    fail("revision");
  for (const k of "nav cash investedValue realisedPnl incomePnl unrealisedPnl totalPnl dayPnl".split(
    " ",
  ))
    number(o[k]);
  flag(o.dayPnlComplete);
  flag(o.valuationComplete);
  for (const w of list(o.warnings, 10000)) text(w);
  const allocation = object(
    o.allocation,
    Object.keys((o.allocation ?? {}) as Obj),
  );
  if (Object.keys(allocation).length > 50) fail("allocation limit");
  for (const [k, v] of Object.entries(allocation)) {
    text(k, 100);
    number(v);
  }
  const ids = new Set<string>();
  for (const item of list(o.holdings)) {
    const req =
      "symbol assetClass quantity averageCost costBasis marketPrice marketValue realisedPnl unrealisedPnl totalPnl weightPct valuationStatus".split(
        " ",
      );
    const h = object(
      item,
      [
        ...req,
        "securityId",
        "name",
        "valuationNote",
        "priceSource",
        "priceAsOf",
      ],
      req,
    );
    text(h.symbol, 100);
    text(h.assetClass, 100);
    optional(h, ["securityId", "name", "valuationNote", "priceSource"], (v) =>
      text(v),
    );
    optional(h, ["priceAsOf"], timestamp);
    for (const k of "quantity averageCost costBasis marketPrice marketValue realisedPnl unrealisedPnl totalPnl weightPct".split(
      " ",
    ))
      number(h[k]);
    if (
      Number(h.quantity) < 0 ||
      Number(h.marketPrice) < 0 ||
      !["live", "stale", "cost"].includes(String(h.valuationStatus))
    )
      fail("holding policy");
    const id = String(h.securityId ?? h.symbol);
    if (ids.has(id)) fail("duplicate security");
    ids.add(id);
  }
  for (const item of list(o.drift, 50)) {
    const d = object(
      item,
      [
        "assetClass",
        "targetPct",
        "minPct",
        "maxPct",
        "actualPct",
        "driftPct",
        "breach",
      ],
      ["assetClass", "targetPct", "actualPct", "driftPct", "breach"],
    );
    text(d.assetClass, 100);
    for (const k of ["targetPct", "actualPct", "driftPct"]) number(d[k]);
    optional(d, ["minPct", "maxPct"], number);
    flag(d.breach);
  }
  for (const item of list(o.priceLineage)) {
    const p = object(item, ["securityId", "selected", "rejected"]);
    text(p.securityId, 200);
    text(p.selected);
    for (const r of list(p.rejected, 100)) text(r);
  }
  if (o.performance !== undefined) {
    const p = object(
      o.performance,
      [
        "startDate",
        "endDate",
        "twrPct",
        "benchmarkPct",
        "excessPct",
        "startValue",
        "endValue",
        "externalFlows",
        "benchmarkLabel",
        "points",
      ],
      [
        "startDate",
        "endDate",
        "twrPct",
        "startValue",
        "endValue",
        "externalFlows",
        "benchmarkLabel",
        "points",
      ],
    );
    date(p.startDate);
    date(p.endDate);
    if (
      String(p.startDate) > String(p.endDate) ||
      String(p.endDate) >
        new Date(String(o.publishedAt)).toISOString().slice(0, 10)
    )
      fail("performance cutoff");
    for (const k of ["twrPct", "startValue", "endValue", "externalFlows"])
      number(p[k]);
    optional(p, ["benchmarkPct", "excessPct"], number);
    text(p.benchmarkLabel);
    let previous = "";
    for (const item of list(p.points, 4000)) {
      const point = object(
        item,
        ["date", "value", "portfolioIndex", "benchmarkIndex"],
        ["date", "value", "portfolioIndex"],
      );
      date(point.date);
      number(point.value);
      number(point.portfolioIndex);
      optional(point, ["benchmarkIndex"], number);
      if (
        String(point.date) <= previous ||
        String(point.date) < String(p.startDate) ||
        String(point.date) > String(p.endDate)
      )
        fail("performance chronology");
      previous = String(point.date);
    }
  }
  const s = value as PortalSnapshot;
  const close = (a: number, b: number) =>
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <=
      Math.max(0.000001, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
  if (
    !close(s.nav, s.cash + s.investedValue) ||
    !close(
      s.investedValue,
      s.holdings.reduce((a, h) => a + h.marketValue, 0),
    )
  )
    fail("NAV reconciliation");
  if (!close(s.totalPnl, s.realisedPnl + s.incomePnl + s.unrealisedPnl))
    fail("P&L reconciliation");
  for (const h of s.holdings)
    if (
      !close(h.marketValue, h.quantity * h.marketPrice) ||
      !close(h.unrealisedPnl, h.marketValue - h.costBasis)
    )
      fail("holding reconciliation");
  return s;
}
export function validatePublication(value: unknown): PublicationEnvelope {
  const o = object(
    value,
    "schema version algorithm sourceId streamId publicationSequence keyId contentDigest payload signature".split(
      " ",
    ),
  );
  if (
    o.schema !== "dpm.client-portal.publication" ||
    o.version !== "2.0" ||
    o.algorithm !== "Ed25519"
  )
    fail("unsupported envelope");
  for (const k of ["sourceId", "streamId", "keyId"]) {
    text(o[k], 100);
    if (!/^[A-Za-z0-9_.:-]+$/.test(String(o[k]))) fail("invalid identifier");
  }
  number(o.publicationSequence);
  if (!Number.isSafeInteger(o.publicationSequence) || o.publicationSequence < 1)
    fail("publication sequence");
  text(o.contentDigest, 71);
  if (!/^sha256:[a-f0-9]{64}$/.test(o.contentDigest)) fail("digest");
  text(o.signature, 100);
  if (!/^[A-Za-z0-9_-]{86}$/.test(o.signature)) fail("signature encoding");
  validatePortalSnapshot(o.payload);
  return value as PublicationEnvelope;
}
export function canonicalPublicationJson(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, sorted(x)]),
          )
        : v;
  return JSON.stringify(sorted(value));
}
