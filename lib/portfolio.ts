import { Client, DpmState, Holding, PortfolioSummary, Quote, Transaction } from "./types";

type Lot = { quantity: number; unitCost: number };

export function buildPortfolio(
  client: Client,
  state: DpmState,
  quotes: Record<string, Quote>
): PortfolioSummary {
  const txs = state.transactions
    .filter((t) => t.clientId === client.id)
    .slice()
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  const bySymbol = new Map<string, Transaction[]>();
  for (const tx of txs) {
    const key = tx.symbol.toUpperCase();
    const list = bySymbol.get(key) ?? [];
    list.push({ ...tx, symbol: key });
    bySymbol.set(key, list);
  }

  let cash = client.initialCash;
  let realisedPnl = 0;
  const rawHoldings: Omit<Holding, "marketValue" | "unrealisedPnl" | "totalPnl" | "weight">[] = [];

  for (const [symbol, items] of bySymbol) {
    const lots: Lot[] = [];
    let symbolRealised = 0;
    let assetClass = items[items.length - 1].assetClass;
    let name = items[items.length - 1].name;

    for (const tx of items) {
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
          if (lot.quantity <= 1e-10) lots.shift();
        }

        symbolRealised += gross - tx.fees - costRemoved;
      }
    }

    const quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const costBasis = lots.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0);
    const averageCost = quantity > 0 ? costBasis / quantity : 0;
    realisedPnl += symbolRealised;

    if (quantity > 1e-10) {
      rawHoldings.push({
        symbol,
        name,
        assetClass,
        quantity,
        averageCost,
        costBasis,
        realisedPnl: symbolRealised,
        marketPrice: quotes[symbol]?.price ?? averageCost,
      });
    }
  }

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
  for (const h of holdings) {
    allocation[h.assetClass] = (allocation[h.assetClass] ?? 0) + h.marketValue;
  }
  allocation.Cash = cash;
  for (const key of Object.keys(allocation)) {
    allocation[key] = marketValue !== 0 ? (allocation[key] / marketValue) * 100 : 0;
  }

  const costBasis = holdings.reduce((sum, h) => sum + h.costBasis, 0);
  const unrealisedPnl = holdings.reduce((sum, h) => sum + h.unrealisedPnl, 0);
  const dayPnl = holdings.reduce((sum, h) => {
    const q = quotes[h.symbol];
    if (!q?.previousClose) return sum;
    return sum + h.quantity * (q.price - q.previousClose);
  }, 0);

  return {
    client,
    holdings,
    cash,
    investedValue,
    marketValue,
    costBasis,
    realisedPnl,
    unrealisedPnl,
    totalPnl: realisedPnl + unrealisedPnl,
    dayPnl,
    allocation,
  };
}

export function driftForClient(state: DpmState, summary: PortfolioSummary) {
  return state.targets
    .filter((t) => t.clientId === summary.client.id)
    .map((t) => {
      const actualPct = summary.allocation[t.assetClass] ?? 0;
      const driftPct = actualPct - t.targetPct;
      const targetValue = summary.marketValue * (t.targetPct / 100);
      const actualValue = summary.marketValue * (actualPct / 100);
      const tradeValue = targetValue - actualValue;
      const breach =
        (t.minPct != null && actualPct < t.minPct) ||
        (t.maxPct != null && actualPct > t.maxPct);
      return { ...t, actualPct, driftPct, tradeValue, breach };
    });
}

export function aggregateAum(summaries: PortfolioSummary[]) {
  return summaries.reduce((sum, p) => sum + p.marketValue, 0);
}
