import { Client, CorporateAction, DpmState, Transaction } from "./types";
import { orderedLedgerEvents } from "./validation";

export type HistoryPoint = { date: string; close: number; adjustedClose?: number };
export type HistorySeries = { symbol: string; currency: string; points: HistoryPoint[] };
export type PerformancePoint = { date: string; value: number; portfolioIndex: number; benchmarkIndex?: number; externalFlow: number };
export type PerformanceResult = { points: PerformancePoint[]; twrPct: number; benchmarkPct?: number; excessPct?: number; startValue: number; endValue: number; externalFlows: number; benchmarkLabel: string; flowConvention: "beginning-of-day" };

type Position = { quantity: number; currency: string };

const key = (symbol: string) => symbol.toUpperCase();

function latestAt(points: HistoryPoint[], date: string, adjusted = false) {
  let found: number | undefined;
  for (const p of points) {
    if (p.date > date) break;
    found = adjusted ? (p.adjustedClose ?? p.close) : p.close;
  }
  return found;
}

export function parseBenchmark(label: string): { symbol: string; weight: number }[] {
  const text = label.trim().toUpperCase();
  const weighted = [...text.matchAll(/(\d+(?:\.\d+)?)%\s*([A-Z0-9^.=\-]+)/g)].map(m => ({ symbol: m[2], weight: Number(m[1]) / 100 }));
  if (weighted.length) {
    const total = weighted.reduce((s, x) => s + x.weight, 0);
    if (total <= 0) return [];
    return weighted.map(x => ({ ...x, weight: x.weight / total }));
  }
  const simple = text.match(/[A-Z0-9^][A-Z0-9.^=\-]{0,39}/)?.[0];
  return simple ? [{ symbol: simple, weight: 1 }] : [];
}

function seriesMap(series: HistorySeries[]) { return new Map(series.map(s => [key(s.symbol), s])); }

function fxAt(currency: string, base: string, date: string, history: Map<string, HistorySeries>) {
  if (currency === base) return 1;
  const direct = history.get(`${currency}${base}=X`);
  const inverse = history.get(`${base}${currency}=X`);
  const d = direct ? latestAt(direct.points, date) : undefined;
  if (d && d > 0) return d;
  const i = inverse ? latestAt(inverse.points, date) : undefined;
  if (i && i > 0) return 1 / i;
  return undefined;
}

function benchmarkLevel(parts: { symbol: string; weight: number }[], base: string, date: string, history: Map<string, HistorySeries>, bases: Map<string, number>) {
  let total = 0;
  for (const part of parts) {
    const s = history.get(key(part.symbol));
    if (!s) return undefined;
    const close = latestAt(s.points, date, true);
    const fx = fxAt(s.currency, base, date, history);
    if (!close || !fx) return undefined;
    const value = close * fx;
    const initial = bases.get(part.symbol) ?? value;
    bases.set(part.symbol, initial);
    total += part.weight * (value / initial) * 100;
  }
  return total;
}

function isExternal(kind: string) {
  return !["DIVIDEND", "COUPON", "INTEREST", "FEE", "TAX"].includes(kind);
}

export function calculatePerformance(state: DpmState, client: Client, series: HistorySeries[], startDate: string, endDate: string): PerformanceResult {
  const history = seriesMap(series);
  const symbols = new Set(state.transactions.filter(t => t.clientId === client.id).map(t => key(t.symbol)));
  const benchmark = parseBenchmark(client.benchmark);
  const dates = new Set<string>();
  for (const symbol of [...symbols, ...benchmark.map(b => b.symbol)]) for (const p of history.get(symbol)?.points ?? []) if (p.date >= startDate && p.date <= endDate) dates.add(p.date);
  for (const e of orderedLedgerEvents(client.id, state.transactions, state.cashMovements, state.corporateActions)) if (e.date >= startDate && e.date <= endDate) dates.add(e.date);
  const orderedDates = [...dates].sort();
  if (!orderedDates.length) throw new Error("No historical market data for this period");

  let cash = client.initialCash;
  const positions = new Map<string, Position>();
  let eventIndex = 0;
  const events = orderedLedgerEvents(client.id, state.transactions, state.cashMovements, state.corporateActions);
  let previousValue: number | undefined;
  let portfolioIndex = 100;
  let totalFlows = 0;
  let pendingFlow = 0;
  let startValue: number | undefined;
  const benchBases = new Map<string, number>();
  const points: PerformancePoint[] = [];

  for (const date of orderedDates) {
    while (eventIndex < events.length && events[eventIndex].date <= date) {
      const e = events[eventIndex++];
      if (e.type === "trade") {
        const t: Transaction = e.item;
        const gross = t.quantity * t.price * t.fxRate;
        cash += t.side === "BUY" ? -(gross + t.fees) : gross - t.fees;
        const p = positions.get(t.symbol) ?? { quantity: 0, currency: t.currency ?? client.baseCurrency };
        p.quantity += t.side === "BUY" ? t.quantity : -t.quantity;
        positions.set(t.symbol, p);
      } else if (e.type === "cash") {
        const m = e.item;
        const amount = m.amount * m.fxRate;
        const negative = ["WITHDRAWAL", "FEE", "TAX"].includes(m.kind);
        const signed = negative ? -amount : amount;
        cash += signed;
        if (e.date >= startDate && isExternal(m.kind)) {
          pendingFlow += signed;
          totalFlows += signed;
        }
      } else {
        const a: CorporateAction = e.item;
        const p = positions.get(a.symbol);
        if (p) p.quantity *= a.factor;
      }
    }

    let value = cash;
    let complete = true;
    for (const [symbol, p] of positions) {
      if (p.quantity <= 1e-10) continue;
      const s = history.get(key(symbol));
      const close = s ? latestAt(s.points, date, false) : undefined;
      const fx = s ? fxAt(s.currency, client.baseCurrency, date, history) : undefined;
      if (!close || !fx) { complete = false; break; }
      value += p.quantity * close * fx;
    }
    if (!complete || !Number.isFinite(value) || value <= 0) continue;

    if (previousValue === undefined) {
      startValue = value - pendingFlow;
      previousValue = value;
    } else {
      const capitalAtRisk = previousValue + pendingFlow;
      if (capitalAtRisk <= 0) throw new Error("External flows reduce beginning capital to zero or below");
      portfolioIndex *= value / capitalAtRisk;
      previousValue = value;
    }

    const benchmarkIndex = benchmark.length ? benchmarkLevel(benchmark, client.baseCurrency, date, history, benchBases) : undefined;
    points.push({ date, value, portfolioIndex, benchmarkIndex, externalFlow: pendingFlow });
    pendingFlow = 0;
  }

  if (points.length < 2) throw new Error("Not enough complete historical observations");
  if (pendingFlow !== 0) throw new Error("Performance period ends before the final external flow can be valued");
  const twrPct = points.at(-1)!.portfolioIndex - 100;
  const benchmarkPct = points.at(-1)!.benchmarkIndex == null ? undefined : points.at(-1)!.benchmarkIndex! - 100;
  return {
    points,
    twrPct,
    benchmarkPct,
    excessPct: benchmarkPct == null ? undefined : twrPct - benchmarkPct,
    startValue: startValue ?? points[0].value,
    endValue: points.at(-1)!.value,
    externalFlows: totalFlows,
    benchmarkLabel: client.benchmark,
    flowConvention: "beginning-of-day"
  };
}
