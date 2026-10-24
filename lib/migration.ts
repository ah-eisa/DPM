import type { DpmState } from "./types";
import { validateState } from "./validation";
import { buildPortfolio } from "./portfolio";
export function previewMigration(input: unknown) {
  const candidate = validateState(input);
  const legacy: DpmState = {
    ...candidate,
    controls: undefined,
    transactions: candidate.transactions.map((t) => ({
      ...t,
      accountId: undefined,
      securityId: undefined,
    })),
    cashMovements: candidate.cashMovements.map((t) => ({
      ...t,
      accountId: undefined,
    })),
    corporateActions: candidate.corporateActions.map((t) => ({
      ...t,
      accountId: undefined,
      securityId: undefined,
    })),
  };
  const comparisons = candidate.clients.map((c) => {
    const before = buildPortfolio(c, legacy, {}),
      after = buildPortfolio(c, candidate, {});
    const fields = [
      "cash",
      "costBasis",
      "realisedPnl",
      "unrealisedPnl",
      "totalPnl",
      "marketValue",
    ] as const;
    for (const field of fields)
      if (
        Math.abs(before[field] - after[field]) >
        Math.max(1e-7, Math.abs(before[field]) * 1e-12)
      )
        throw Error(`Migration changes ${field} for ${c.code}`);
    const quantities = (p: typeof before) =>
      p.holdings.map((h) => `${h.symbol}:${h.quantity}:${h.costBasis}`).sort();
    if (
      JSON.stringify(quantities(before)) !== JSON.stringify(quantities(after))
    )
      throw Error(`Migration changes holdings for ${c.code}`);
    return {
      clientId: c.id,
      cash: after.cash,
      costBasis: after.costBasis,
      totalPnl: after.totalPnl,
      holdings: after.holdings.length,
    };
  });
  return { candidate, comparisons };
}
