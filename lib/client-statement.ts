import type { SignedClientPortalSnapshotV1 } from "./portal-signing";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function pct(value: number | undefined) {
  return value == null ? "N/A" : `${value.toFixed(2)}%`;
}

export function renderClientStatementHtml(
  envelope: SignedClientPortalSnapshotV1,
) {
  const s = envelope.payload;
  const holdings = s.holdings
    .map(
      (h) => `<tr>
<td>${escapeHtml(h.symbol)}</td>
<td>${escapeHtml(h.assetClass)}</td>
<td class="num">${escapeHtml(h.quantity)}</td>
<td class="num">${money(h.marketPrice, s.baseCurrency)}</td>
<td class="num">${money(h.marketValue, s.baseCurrency)}</td>
<td class="num">${pct(h.weightPct)}</td>
<td>${escapeHtml(h.valuationStatus)}</td>
</tr>`,
    )
    .join("");
  const allocation = Object.entries(s.allocation)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([name, value]) =>
        `<tr><td>${escapeHtml(name)}</td><td class="num">${pct(value)}</td></tr>`,
    )
    .join("");
  const warnings = s.warnings.length
    ? `<section class="warnings"><h2>Valuation notes</h2><ul>${s.warnings
        .map((x) => `<li>${escapeHtml(x)}</li>`)
        .join("")}</ul></section>`
    : "";
  const performance = s.performance
    ? `<section><h2>Performance</h2><div class="metrics">
<div><span>Period return</span><strong>${pct(s.performance.twrPct)}</strong></div>
<div><span>Benchmark</span><strong>${pct(s.performance.benchmarkPct)}</strong></div>
<div><span>Excess</span><strong>${pct(s.performance.excessPct)}</strong></div>
<div><span>Period</span><strong>${escapeHtml(s.performance.startDate)} to ${escapeHtml(s.performance.endDate)}</strong></div>
</div></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>DPM Statement ${escapeHtml(s.clientCode)}</title>
<style>
:root{font-family:Inter,Arial,sans-serif;color:#14213d;background:#fff}body{margin:0;padding:32px;line-height:1.45}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #14213d;padding-bottom:18px;margin-bottom:24px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:26px 0 10px}.muted{color:#667085;font-size:12px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metrics div{border:1px solid #e4e7ec;border-radius:10px;padding:12px}.metrics span{display:block;color:#667085;font-size:11px}.metrics strong{display:block;margin-top:4px;font-size:16px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border-bottom:1px solid #eaecf0;text-align:left}th{background:#f8fafc}.num{text-align:right}.warnings{border:1px solid #f2c94c;background:#fffbea;padding:0 14px 10px;border-radius:10px}.signature{margin-top:28px;padding-top:12px;border-top:1px solid #eaecf0;word-break:break-all}@media print{body{padding:12mm}.no-print{display:none}}
</style>
</head>
<body>
<header>
<div><h1>Discretionary Portfolio Statement</h1><div class="muted">Client ${escapeHtml(s.clientCode)} · Account ${escapeHtml(s.accountId)}</div></div>
<div class="muted">Published ${escapeHtml(s.publishedAt)}<br/>Book revision ${escapeHtml(s.bookRevision)}</div>
</header>
<section><div class="metrics">
<div><span>Portfolio value</span><strong>${money(s.nav, s.baseCurrency)}</strong></div>
<div><span>Cash</span><strong>${money(s.cash, s.baseCurrency)}</strong></div>
<div><span>Total P&amp;L</span><strong>${money(s.totalPnl, s.baseCurrency)}</strong></div>
<div><span>Benchmark</span><strong>${escapeHtml(s.benchmark)}</strong></div>
</div></section>
${performance}
<section><h2>Asset allocation</h2><table><thead><tr><th>Asset class</th><th class="num">Weight</th></tr></thead><tbody>${allocation}</tbody></table></section>
<section><h2>Holdings</h2><table><thead><tr><th>Symbol</th><th>Asset class</th><th class="num">Quantity</th><th class="num">Price</th><th class="num">Market value</th><th class="num">Weight</th><th>Valuation</th></tr></thead><tbody>${holdings}</tbody></table></section>
${warnings}
<section class="signature muted"><strong>Integrity record</strong><br/>Key: ${escapeHtml(envelope.keyId)}<br/>Digest: ${escapeHtml(envelope.contentDigest)}<br/>Snapshot: ${escapeHtml(s.snapshotId)}</section>
</body>
</html>`;
}
