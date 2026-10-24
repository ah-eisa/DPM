import type { DpmState, PriceOverride, Quote } from "./types";

function timestampMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function overrideTimes(override: PriceOverride) {
  const effectiveAt = timestampMs(override.effectiveAt);
  const expiresAt = timestampMs(override.expiresAt);
  const recordedAt = timestampMs(override.recordedAt);
  return effectiveAt == null || expiresAt == null || recordedAt == null
    ? undefined
    : { effectiveAt, expiresAt, recordedAt };
}

export function selectPrices(
  state: DpmState,
  quotes: Record<string, Quote>,
  asOf = new Date().toISOString(),
): {
  quotes: Record<string, Quote>;
  lineage: { securityId: string; selected: string; rejected: string[] }[];
} {
  const asOfMs = timestampMs(asOf);
  if (asOfMs == null) throw new Error("Price selection asOf must be a valid timestamp");

  const selected = { ...quotes };
  const lineage = [];
  for (const s of state.controls?.securities ?? []) {
    const alternatives = (state.controls?.overrides ?? []).filter(
      (o) => o.securityId === s.id,
    );
    const valid = alternatives
      .map((override) => ({ override, times: overrideTimes(override) }))
      .filter(
        (entry): entry is {
          override: PriceOverride;
          times: { effectiveAt: number; expiresAt: number; recordedAt: number };
        } =>
          !!entry.times &&
          entry.times.effectiveAt <= asOfMs &&
          entry.times.expiresAt > asOfMs,
      )
      .sort(
        (a, b) =>
          b.times.effectiveAt - a.times.effectiveAt ||
          b.times.recordedAt - a.times.recordedAt ||
          b.override.id.localeCompare(a.override.id),
      );
    const chosen = valid[0]?.override;
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
          .map((o) => {
            const times = overrideTimes(o);
            const reason = !times
              ? "invalid timestamp"
              : times.effectiveAt > asOfMs
                ? "not effective"
                : times.expiresAt <= asOfMs
                  ? "expired"
                  : "lower precedence";
            return `${o.id}: ${reason}`;
          }),
        ...(chosen && q ? [`${q.source}: active override policy`] : []),
      ],
    });
  }
  return { quotes: selected, lineage };
}
