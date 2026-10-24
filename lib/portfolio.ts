import { selectPrices } from "./price-policy";
import { bookView } from "./book-view";
import { POSITION_EPSILON } from "./constants";
import { CashMovement, Client, DpmState, Holding, PortfolioSummary, Quote, Transaction } from "./types";
import { orderedLedgerEvents, validateLedger } from "./validation";

type Lot = { quantity: number; unitCost: number };
type SecurityMeta = { assetClass: Transaction["assetClass"]; name?: string; currency?: string };

function movementDelta(m: CashMovement) {
  const value = m.amount * m.fxRate;
  return ["WITHDRAWAL", "FEE", "TAX"].includes(m.kind) ? -value : value;
}

function buildPortfolioCore(
  client: Client,
  state: DpmState,
  quotes: Record<string, Quote>
): PortfolioSummary {
  const cashMovements = state.cashMovements ?? [];
  const corporateActions = state.corporateActions ?? [];
  validateLedger(client, state.transactions, cashMovements, corporateActions);

  let cash = client.initialCash;
  let incomePnl = 0;
  let externalCashFlow = 0;
  const lotsBySymbol = new Map<string, Lot[]>();
  const realisedBySymbol = new Map<string, number>();
  const metaBySymbol = new Map<string, SecurityMeta>();

  for (const event of orderedLedgerEvents(client.id, state.transactions, cashMovements, corporateActions)) {
    if (event.type === "cash") {
      const m = event.item;
      const delta = movementDelta(m);
      cash += delta;
      if (["DIVIDEND", "COUPON", "INTEREST"].includes(m.kind)) incomePnl += delta;
      else if (["FEE", "TAX"].includes(m.kind)) incomePnl += delta;
      else externalCashFlow += delta;
      continue;
    }

    if (event.type === "action") {
      const action = event.item;
      const lots = lotsBySymbol.get(action.symbol) ?? [];
      for (const lot of lots) {
        lot.quantity *= action.factor;
        lot.unitCost /= action.factor;
      }
      continue;
    }

    const tx = event.item;
    const symbol = tx.symbol.toUpperCase();
    const lots = lotsBySymbol.get(symbol) ?? [];
    if (!metaBySymbol.has(symbol)) metaBySymbol.set(symbol, { assetClass: tx.assetClass, name: tx.name, currency: tx.currency });
    else if (!metaBySymbol.get(symbol)?.name && tx.name) metaBySymbol.set(symbol, { ...metaBySymbol.get(symbol)!, name: tx.name });

    const gross = tx.quantity * tx.price * tx.fxRate;
    if (tx.side === "BUY") {
      const totalCost = gross + tx.fees;
      lots.push({ quantity: tx.quantity, unitCost: totalCost / tx.quantity });
      cash -= totalCost;
    } else {
      cash += gross - tx.fees;
      let remaining = tx.quantity;
      let costRemoved = 0;
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const used = Math.min(remaining, lot.quantity);
        costRemoved += used * lot.unitCost;
        lot.quantity -= used;
        remaining -= used;
        if (lot.quantity < POSITION_EPSILON) lots.shift();
      }
      realisedBySymbol.set(symbol, (realisedBySymbol.get(symbol) ?? 0) + gross - tx.fees - costRemoved);
    }
    lotsBySymbol.set(symbol, lots);
  }

  const rawHoldings: Omit<Holding, "marketValue" | "unrealisedPnl" | "totalPnl" | "weight">[] = [];
  for (const [symbol, lots] of lotsBySymbol) {
    const quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    if (quantity < POSITION_EPSILON) continue;
    const costBasis = lots.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0);
    const averageCost = costBasis / quantity;
    const meta = metaBySymbol.get(symbol)!;
    const quote = quotes[symbol];
    const quoteCurrency = quote?.currency?.toUpperCase();
    const fx = quoteCurrency === client.baseCurrency ? undefined : quotes[`${quoteCurrency}${client.baseCurrency}=X`];
    const currencyMatches = !meta.currency || meta.currency === quoteCurrency;
    const hasPrice = currencyMatches && !!quoteCurrency && Number.isFinite(quote?.price) && quote.price >= 0 && (quoteCurrency === client.baseCurrency || (!!fx && Number.isFinite(fx.price) && fx.price > 0)) && Number.isFinite(quantity * quote.price * (fx?.price ?? 1));
    const stale = quote?.stale || fx?.stale || [quote, fx].some(q => q && (!Number.isFinite(Date.parse(q.asOf)) || Date.now() - Date.parse(q.asOf) > 24 * 60 * 60 * 1000));
    rawHoldings.push({
      symbol,
      priceSource: hasPrice ? quote.source : undefined,
      priceAsOf: hasPrice ? quote.asOf : undefined,
      priceChangePct: hasPrice ? quote.changePct : undefined,
      name: meta.name,
      assetClass: meta.assetClass,
      quantity,
      averageCost,
      costBasis,
      realisedPnl: realisedBySymbol.get(symbol) ?? 0,
      marketPrice: hasPrice ? quote.price * (fx?.price ?? 1) : averageCost,
      valuationStatus: !hasPrice ? "cost" : stale ? "stale" : "live",
      valuationNote: !hasPrice ? "Indicative cost only: missing price, currency mismatch or FX rate" : stale ? "Latest available market quote is stale; review timestamp" : undefined,
    });
  }

  const realisedPnl = Array.from(realisedBySymbol.values()).reduce((sum, value) => sum + value, 0);
  const investedValue = rawHoldings.reduce((sum, h) => sum + h.quantity * h.marketPrice, 0);
  const marketValue = investedValue + cash;
  const holdings: Holding[] = rawHoldings.map((h) => {
    const mv = h.quantity * h.marketPrice;
    const unrealised = mv - h.costBasis;
    return {
      ...h,
      marketValue: mv,
      unrealisedPnl: unrealised,
      totalPnl: h.realisedPnl + unrealised,
      weight: marketValue !== 0 ? (mv / marketValue) * 100 : 0,
    };
  });

  const allocation: Record<string, number> = {};
  for (const h of holdings) allocation[h.assetClass] = (allocation[h.assetClass] ?? 0) + h.marketValue;
  allocation.Cash = cash;
  for (const key of Object.keys(allocation)) allocation[key] = marketValue !== 0 ? (allocation[key] / marketValue) * 100 : 0;

  const costBasis = holdings.reduce((sum, h) => sum + h.costBasis, 0);
  const unrealisedPnl = holdings.reduce((sum, h) => sum + h.unrealisedPnl, 0);
  const dayPnl = holdings.reduce((sum, h) => {
    const q = quotes[h.symbol];
    if (h.valuationStatus !== "live" || !q?.previousClose) return sum;
    if (q.currency === client.baseCurrency) return sum + h.quantity * (q.price - q.previousClose);
    const fx = quotes[`${q.currency}${client.baseCurrency}=X`];
    if (!fx?.previousClose) return sum;
    return sum + h.quantity * (q.price * fx.price - q.previousClose * fx.previousClose);
  }, 0);
  const dayPnlComplete = holdings.every(h => h.valuationStatus === "live" && !!quotes[h.symbol]?.previousClose && (quotes[h.symbol].currency === client.baseCurrency || !!quotes[`${quotes[h.symbol].currency}${client.baseCurrency}=X`]?.previousClose));

  return {
    dayPnlComplete,
    valuationComplete: holdings.every(h => h.valuationStatus === "live"),
    client,
    holdings,
    cash,
    investedValue,
    marketValue,
    costBasis,
    realisedPnl,
    incomePnl,
    externalCashFlow,
    unrealisedPnl,
    totalPnl: realisedPnl + incomePnl + unrealisedPnl,
    dayPnl,
    allocation,
  };
}

export function driftForClient(state: DpmState, summary: PortfolioSummary) {
  const targets = state.targets.filter(t => t.clientId === summary.client.id);
  const classes = new Set([...targets.map(t => t.assetClass), ...summary.holdings.map(h => h.assetClass), "Cash" as const]);
  return Array.from(classes).map(assetClass => targets.find(t => t.assetClass === assetClass) ?? { clientId: summary.client.id, assetClass, targetPct: 0, minPct: 0, maxPct: 0 })
    .map((t) => {
      const actualPct = summary.allocation[t.assetClass] ?? 0;
      const driftPct = actualPct - t.targetPct;
      const targetValue = summary.marketValue * (t.targetPct / 100);
      const actualValue = summary.marketValue * (actualPct / 100);
      const tradeValue = targetValue - actualValue;
      const breach = (t.minPct != null && actualPct < t.minPct) || (t.maxPct != null && actualPct > t.maxPct);
      return { ...t, actualPct, driftPct, tradeValue, breach };
    });
}

export function aggregateAum(summaries: PortfolioSummary[]) {
  if (new Set(summaries.map(p => p.client.baseCurrency)).size > 1) throw new Error("Cannot aggregate different base currencies");
  return summaries.reduce((sum, p) => sum + p.marketValue, 0);
}

export function buildPortfolio(client:Client,state:DpmState,quotes:Record<string,Quote>):PortfolioSummary {
  const view=bookView(state,selectPrices(state,quotes).quotes);const result=buildPortfolioCore(client,view.state,view.quotes);
  return {...result,holdings:result.holdings.map(h=>({...h,...view.labels.get(h.symbol)}))};
}
