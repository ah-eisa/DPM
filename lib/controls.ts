import type {
  Account,
  CustodianObservation,
  DpmState,
  PriceOverride,
  Quote,
} from "./types";
import { buildPortfolio } from "./portfolio";
import { selectPrices } from "./price-policy";
import { validateState } from "./validation";
export function accountBook(
  state: DpmState,
  accountId: string,
  asOf = "9999-12-31",
) {
  const a = state.controls?.accounts.find((a) => a.id === accountId);
  if (!a) throw Error("Unknown account");
  const client = {
    ...state.clients.find((c) => c.id === a.clientId)!,
    initialCash: a.initialCash,
  };
  return {
    client,
    state: {
      ...state,
      controls: state.controls
        ? { ...state.controls, overrides: [] }
        : undefined,
      clients: [client],
      transactions: state.transactions.filter(
        (t) => t.accountId === a.id && t.tradeDate <= asOf,
      ),
      cashMovements: state.cashMovements.filter(
        (t) => t.accountId === a.id && t.movementDate <= asOf,
      ),
      corporateActions: state.corporateActions.filter(
        (t) => t.accountId === a.id && t.actionDate <= asOf,
      ),
    },
  };
}
export type ReconciliationBreak = {
  key: string;
  kind:
    | "matched"
    | "quantity mismatch"
    | "cash mismatch"
    | "missing internally"
    | "missing at custodian"
    | "unmapped"
    | "not comparable"
    | "price/value mismatch";
  note?: string;
  internal?: number;
  external?: number;
  tolerance: number;
};
export function reconcile(
  state: DpmState,
  o: CustodianObservation,
  absolute = 0.000001,
  relative = 0.000001,
): ReconciliationBreak[] {
  if (![absolute, relative].every((v) => Number.isFinite(v) && v >= 0))
    throw Error("Invalid tolerance");
  const view = accountBook(state, o.accountId, o.effectiveDate),
    portfolio = buildPortfolio(view.client, view.state, {});
  const result: ReconciliationBreak[] = [];
  const seen = new Set<string>();
  const prices = selectPrices(
    state,
    {},
    `${o.effectiveDate}T23:59:59.999Z`,
  ).quotes;
  for (const row of o.rows) {
    if (!row.securityId) {
      result.push({
        key: row.symbol,
        kind: "unmapped",
        external: row.quantity,
        tolerance: 0,
      });
      continue;
    }
    seen.add(row.securityId);
    const h = portfolio.holdings.find((h) => h.securityId === row.securityId),
      internal = h?.quantity ?? 0,
      tolerance = Math.max(
        absolute,
        relative * Math.max(Math.abs(internal), Math.abs(row.quantity)),
      );
    result.push({
      key: row.securityId,
      kind:
        Math.abs(internal - row.quantity) <= tolerance
          ? "matched"
          : !h
            ? "missing internally"
            : "quantity mismatch",
      internal,
      external: row.quantity,
      tolerance,
    });
    if (row.price !== undefined || row.reportedValue !== undefined) {
      const security = state.controls!.securities.find(
          (s) => s.id === row.securityId,
        )!,
        q = prices[row.securityId];
      if (
        !q ||
        q.currency !== row.currency ||
        q.asOf.slice(0, 10) !== o.effectiveDate ||
        row.priceAsOf?.slice(0, 10) !== o.effectiveDate ||
        row.unitMultiplier !== security.priceMultiplier ||
        row.priceConvention !== "clean"
      )
        result.push({
          key: `${row.securityId}:VALUE`,
          kind: "not comparable",
          note: "Requires same-date clean price, matching currency and explicit unit multiplier",
          tolerance: 0,
        });
      else {
        const nativeValue = internal * q.price * security.priceMultiplier,
          externalValue =
            row.reportedValue ??
            row.quantity * row.price! * security.priceMultiplier;
        const tol = Math.max(
          absolute,
          relative * Math.max(Math.abs(nativeValue), Math.abs(externalValue)),
        );
        const priceTol = Math.max(
          absolute,
          relative *
            Math.max(Math.abs(q.price), Math.abs(row.price ?? q.price)),
        );
        result.push({
          key: `${row.securityId}:VALUE`,
          kind:
            Math.abs(nativeValue - externalValue) <= tol &&
            (row.price === undefined ||
              Math.abs(q.price - row.price) <= priceTol)
              ? "matched"
              : "price/value mismatch",
          internal: nativeValue,
          external: externalValue,
          tolerance: tol,
        });
      }
    }
  }
  if (o.scope === "complete" && o.rows.every((r) => !!r.securityId))
    for (const h of portfolio.holdings)
      if (h.securityId && !seen.has(h.securityId))
        result.push({
          key: h.securityId,
          kind: "missing at custodian",
          internal: h.quantity,
          tolerance: absolute,
        });
  if (o.cash !== undefined) {
    const tolerance = Math.max(
      absolute,
      relative * Math.max(Math.abs(portfolio.cash), Math.abs(o.cash)),
    );
    result.push({
      key: "CASH",
      kind:
        o.cashCurrency !== view.client.baseCurrency
          ? "not comparable"
          : Math.abs(portfolio.cash - o.cash) <= tolerance
            ? "matched"
            : "cash mismatch",
      internal: portfolio.cash,
      external: o.cash,
      tolerance,
    });
  }
  return result;
}
export { selectPrices } from "./price-policy";
export function groupedAccountTotals(
  state: DpmState,
  accountIds: string[],
  quotes: Record<string, Quote> = {},
  asOf = "9999-12-31",
) {
  if (new Set(accountIds).size !== accountIds.length)
    throw Error("Duplicate account membership");
  const totals: Record<
    string,
    { value: number; complete: boolean; accounts: number }
  > = {};
  for (const id of accountIds) {
    const view = accountBook(state, id, asOf),
      p = buildPortfolio(view.client, view.state, quotes),
      ccy = view.client.baseCurrency;
    const t = totals[ccy] ?? { value: 0, complete: true, accounts: 0 };
    t.value += p.marketValue;
    t.complete &&= p.valuationComplete;
    t.accounts++;
    totals[ccy] = t;
  }
  return totals;
}
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!cell || quoted) quoted = !quoted;
      else throw Error("Malformed CSV quote");
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("Unclosed CSV quote");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export async function previewObservation(
  state: DpmState,
  content: string,
  options: {
    accountId: string;
    effectiveDate: string;
    source: string;
    scope: "partial" | "complete";
    cash?: number;
    cashCurrency?: string;
    supersedesId?: string;
  },
): Promise<CustodianObservation> {
  if (content.length > 5 * 1024 * 1024) throw Error("CSV exceeds 5 MB");
  const [header, ...rows] = csvRows(content.replace(/^\uFEFF/, ""));
  const required = ["security_id", "symbol", "currency", "quantity"],
    optional = [
      "price",
      "reported_value",
      "unit_multiplier",
      "price_as_of",
      "price_convention",
    ];
  if (
    !header ||
    header.slice(0, 4).join(",") !== required.join(",") ||
    new Set(header).size !== header.length ||
    header.some((h) => ![...required, ...optional].includes(h))
  )
    throw Error(
      "Use CSV header: security_id,symbol,currency,quantity plus optional price,reported_value,unit_multiplier,price_as_of,price_convention",
    );
  if (!rows.length || rows.length > 20000)
    throw Error("Statement needs 1–20000 positions");
  const bytes = new TextEncoder().encode(content);
  const sourceHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const observation: CustodianObservation = {
    id: crypto.randomUUID(),
    ...options,
    sourceHash,
    receivedAt: new Date().toISOString(),
    basis: "trade-date",
    rows: rows.map((r) => {
      if (r.length !== header.length || !r[3].trim())
        throw Error("Invalid CSV row");
      return {
        ...(r[0].trim() ? { securityId: r[0].trim() } : {}),
        symbol: r[1].trim(),
        currency: r[2].trim().toUpperCase(),
        quantity: Number(r[3]),
        ...Object.fromEntries(
          optional
            .filter((k) => header.includes(k) && r[header.indexOf(k)].trim())
            .map((k) => {
              const value = r[header.indexOf(k)].trim();
              return [
                (
                  {
                    reported_value: "reportedValue",
                    unit_multiplier: "unitMultiplier",
                    price_as_of: "priceAsOf",
                    price_convention: "priceConvention",
                  } as Record<string, string>
                )[k] ?? k,
                ["price", "reported_value", "unit_multiplier"].includes(k)
                  ? Number(value)
                  : value,
              ];
            }),
        ),
      };
    }),
  };
  const validated = validateState({
    ...state,
    controls: {
      ...state.controls!,
      observations: [...state.controls!.observations, observation],
    },
  });
  return validated.controls!.observations.find((o) => o.id === observation.id)!;
}
export function feeEstimate(
  value: number,
  annualBps: number,
  days: number,
  year = 365,
) {
  if (
    ![value, annualBps, days].every((v) => Number.isFinite(v) && v >= 0) ||
    annualBps > 10000 ||
    days > 3660 ||
    ![365, 366].includes(year)
  )
    throw Error("Invalid fee estimate inputs");
  return (((value * annualBps) / 10000) * days) / year;
}
export function reportCsv(
  state: DpmState,
  accountIds: string[],
  quotes: Record<string, Quote>,
  asOf: string,
) {
  const esc = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@\-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const rows: unknown[][] = [
    ["As of", "Account", "Client", "Currency", "Value", "Valuation"],
  ];
  for (const id of accountIds) {
    const v = accountBook(state, id, asOf),
      p = buildPortfolio(v.client, v.state, quotes);
    rows.push([
      asOf,
      id,
      v.client.code,
      v.client.baseCurrency,
      p.marketValue,
      p.valuationComplete ? "priced" : "indicative cost / incomplete",
    ]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}
export function addAccount(
  state: DpmState,
  input: Pick<Account, "clientId" | "label" | "custodian">,
): DpmState {
  const c = state.clients.find((c) => c.id === input.clientId);
  if (!c) throw Error("Unknown client");
  return validateState({
    ...state,
    controls: {
      ...state.controls!,
      accounts: [
        ...state.controls!.accounts,
        {
          ...input,
          id: crypto.randomUUID(),
          baseCurrency: c.baseCurrency,
          initialCash: 0,
        },
      ],
    },
  });
}
export function addOverride(
  state: DpmState,
  input: Omit<PriceOverride, "id" | "recordedAt">,
): DpmState {
  return validateState({
    ...state,
    controls: {
      ...state.controls!,
      overrides: [
        ...state.controls!.overrides,
        {
          ...input,
          id: crypto.randomUUID(),
          recordedAt: new Date().toISOString(),
        },
      ],
    },
  });
}
