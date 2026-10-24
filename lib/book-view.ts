import type { DpmState, Quote } from "./types";
import type { HistorySeries } from "./performance";
export function bookView(
  state: DpmState,
  quotes: Record<string, Quote> = {},
  history: HistorySeries[] = [],
) {
  if (!state.controls)
    return {
      state,
      quotes,
      history,
      labels: new Map<
        string,
        { symbol: string; name: string; securityId: string; accountId: string }
      >(),
    };
  const labels = new Map<
    string,
    { symbol: string; name: string; securityId: string; accountId: string }
  >();
  const nextQuotes = { ...quotes },
    nextHistory = [...history];
  const key = (
    accountId: string | undefined,
    securityId: string | undefined,
    symbol: string,
  ) => {
    const s = state.controls!.securities.find((s) => s.id === securityId);
    if (!s) return symbol;
    const id = `${accountId}|${securityId}`.toUpperCase();
    if (labels.has(id)) return id;
    labels.set(id, {
      symbol: s.symbol,
      name: s.name,
      securityId: s.id,
      accountId: accountId!,
    });
    const ambiguous =
      state.controls!.securities.filter((x) => x.symbol === s.symbol).length >
      1;
    const q = quotes[s.id] ?? (!ambiguous ? quotes[s.symbol] : undefined);
    if (q)
      nextQuotes[id] = {
        ...q,
        symbol: id,
        price: q.price * s.priceMultiplier,
        ...(q.previousClose !== undefined
          ? { previousClose: q.previousClose * s.priceMultiplier }
          : {}),
      };
    const h =
      history.find((h) => h.symbol === s.id) ??
      (!ambiguous ? history.find((h) => h.symbol === s.symbol) : undefined);
    if (h && h.currency === s.currency)
      nextHistory.push({
        ...h,
        symbol: id.toUpperCase(),
        points: h.points.map((p) => ({
          ...p,
          close: p.close * s.priceMultiplier,
          ...(p.adjustedClose !== undefined
            ? { adjustedClose: p.adjustedClose * s.priceMultiplier }
            : {}),
        })),
      });
    return id;
  };
  const transactions = state.transactions.map((t) => ({
    ...t,
    securityId: undefined,
    symbol: key(t.accountId, t.securityId, t.symbol),
    price:
      t.price *
      (state.controls!.securities.find((s) => s.id === t.securityId)
        ?.priceMultiplier ?? 1),
  }));
  const corporateActions = state.corporateActions.map((a) => ({
    ...a,
    securityId: undefined,
    symbol: key(a.accountId, a.securityId, a.symbol),
  }));
  return {
    state: { ...state, controls: undefined, transactions, corporateActions },
    quotes: nextQuotes,
    history: nextHistory,
    labels,
  };
}
