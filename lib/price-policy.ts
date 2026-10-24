import type { DpmState, Quote } from "./types";
export function selectPrices(
  state: DpmState,
  quotes: Record<string, Quote>,
  asOf = new Date().toISOString(),
): {
  quotes: Record<string, Quote>;
  lineage: { securityId: string; selected: string; rejected: string[] }[];
} {
  const selected = { ...quotes };
  const lineage = [];
  for (const s of state.controls?.securities ?? []) {
    const alternatives = (state.controls?.overrides ?? []).filter(
      (o) => o.securityId === s.id,
    );
    const valid = alternatives
      .filter((o) => o.effectiveAt <= asOf && o.expiresAt > asOf)
      .sort(
        (a, b) =>
          b.effectiveAt.localeCompare(a.effectiveAt) ||
          b.recordedAt.localeCompare(a.recordedAt) ||
          b.id.localeCompare(a.id),
      );
    const chosen = valid[0];
    const q =
      quotes[s.id] ??
      (state.controls!.securities.filter((x) => x.symbol === s.symbol)
        .length === 1
        ? quotes[s.symbol]
        : undefined);
    if (chosen)
      selected[s.id] = {
        symbol: s.symbol,
        price: chosen.price,
        currency: chosen.currency,
        asOf: chosen.effectiveAt,
        fetchedAt: chosen.recordedAt,
        source: `Manual: ${chosen.source}`,
        stale: false,
      };
    else if (q) selected[s.id] = q;
    lineage.push({
      securityId: s.id,
      selected: chosen
        ? `override:${chosen.id}`
        : q
          ? `${q.source}:${q.asOf}`
          : "unavailable",
      rejected: [
        ...alternatives
          .filter((o) => o.id !== chosen?.id)
          .map(
            (o) =>
              `${o.id}: ${o.effectiveAt > asOf ? "not effective" : o.expiresAt <= asOf ? "expired" : "lower precedence"}`,
          ),
        ...(chosen && q ? [`${q.source}: active override policy`] : []),
      ],
    });
  }
  return { quotes: selected, lineage };
}
