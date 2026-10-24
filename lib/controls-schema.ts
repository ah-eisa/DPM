import type { BookControls, DpmState, Security } from "./types";

const record = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== "object" || Array.isArray(x))
    throw Error("Invalid control record");
  return x as Record<string, unknown>;
};
const text = (x: unknown): string => {
  if (typeof x !== "string" || !x.trim() || x.length > 500)
    throw Error("Invalid control text");
  return x.trim();
};
const numeric = (x: unknown): number => {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0)
    throw Error("Invalid control number");
  return x;
};
const day = (x: unknown): string => {
  const s = text(x);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw Error("Invalid effective date");
  return s;
};
const instant = (x: unknown): string => {
  const s = text(x);
  if (!Number.isFinite(Date.parse(s)) || !/(Z|[+-]\d\d:\d\d)$/.test(s))
    throw Error("Timestamp requires timezone");
  return new Date(s).toISOString();
};
function list<T>(x: unknown, parse: (r: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(x) || x.length > 20000)
    throw Error("Invalid control collection");
  return x.map((v) => parse(record(v)));
}
function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((x) => x.id)).size !== items.length)
    throw Error("Duplicate control ID");
  return items;
}
function isin(x: string) {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(x)) return false;
  const digits = [...x]
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  return (
    [...digits].reverse().reduce((sum, d, i) => {
      let n = Number(d) * (i % 2 ? 2 : 1);
      if (n > 9) n -= 9;
      return sum + n;
    }, 0) %
      10 ===
    0
  );
}
export const defaultAccountId = (clientId: string) => `account:${clientId}`;
const legacySecurityId = (
  symbol: string,
  currency: string,
  assetClass: string,
) => `security:${symbol}:${currency}:${assetClass}`;

export function normalizeControls(
  state: DpmState,
  input: unknown,
  ccy: (x: unknown) => string,
): DpmState {
  const root = input === undefined ? undefined : record(input);
  const accounts = unique(
    root
      ? list(root.accounts, (r) => ({
          id: text(r.id),
          clientId: text(r.clientId),
          label: text(r.label),
          custodian: text(r.custodian),
          baseCurrency: ccy(r.baseCurrency),
          initialCash: numeric(r.initialCash),
        }))
      : state.clients.map((c) => ({
          id: defaultAccountId(c.id),
          clientId: c.id,
          label: c.code,
          custodian: "Unspecified",
          baseCurrency: c.baseCurrency,
          initialCash: c.initialCash,
        })),
  );
  // A newly created mandate receives one explicit account without changing its opening cash.
  for (const c of state.clients)
    if (!accounts.some((a) => a.clientId === c.id))
      throw Error("Client requires an explicit account");
  unique(accounts);
  for (const a of accounts) {
    const c = state.clients.find((c) => c.id === a.clientId);
    if (!c || a.baseCurrency !== c.baseCurrency)
      throw Error("Account requires a known client and its base currency");
  }
  for (const c of state.clients)
    if (
      Math.abs(
        accounts
          .filter((a) => a.clientId === c.id)
          .reduce((s, a) => s + a.initialCash, 0) - c.initialCash,
      ) > 1e-8
    )
      throw Error(
        "Account opening cash must reconcile to mandate opening cash",
      );
  const securities: Security[] = unique(
    root
      ? list(root.securities, (r) => {
          const priceMultiplier = numeric(r.priceMultiplier);
          if (priceMultiplier <= 0)
            throw Error("Price multiplier must be positive");
          const assetClass = text(r.assetClass) as Security["assetClass"];
          if (
            ![
              "US Equity",
              "UAE Equity",
              "ETF",
              "Bond/Sukuk",
              "Crypto",
              "Metal",
              "Other",
            ].includes(assetClass)
          )
            throw Error("Invalid security asset class");
          const status = text(r.shariaStatus);
          if (!["unknown", "screened"].includes(status))
            throw Error("Invalid screening status");
          if (status === "screened" && (!r.shariaSource || !r.shariaDate))
            throw Error("Screening requires source and date");
          const code = r.isin ? text(r.isin).toUpperCase() : undefined;
          if (code && !isin(code)) throw Error("Invalid ISIN checksum");
          return {
            id: text(r.id),
            symbol: (() => {
              const alias = text(r.symbol).toUpperCase();
              if (!/^[A-Z0-9^][A-Z0-9.^=\-]{0,39}$/.test(alias))
                throw Error("Invalid pricing alias");
              return alias;
            })(),
            name: text(r.name),
            exchange: text(r.exchange),
            currency: ccy(r.currency),
            assetClass,
            priceMultiplier,
            shariaStatus: status as Security["shariaStatus"],
            ...(code ? { isin: code } : {}),
            ...(r.shariaSource ? { shariaSource: text(r.shariaSource) } : {}),
            ...(r.shariaDate ? { shariaDate: day(r.shariaDate) } : {}),
          };
        })
      : [],
  );
  const aliasKeys = new Set<string>();
  for (const s of securities) {
    const k = JSON.stringify([s.exchange, s.symbol, s.currency]);
    if (aliasKeys.has(k))
      throw Error("Duplicate exchange/currency pricing alias");
    aliasKeys.add(k);
  }
  const transactions = state.transactions.map((t) => {
    const account = accounts.find(
      (a) =>
        a.id ===
        (t.accountId ?? accounts.find((a) => a.clientId === t.clientId)?.id),
    );
    if (!account || account.clientId !== t.clientId)
      throw Error("Invalid trade account");
    let security = t.securityId
      ? securities.find((s) => s.id === t.securityId)
      : undefined;
    if (!t.securityId) {
      const candidates = securities.filter(
        (s) =>
          s.symbol === t.symbol &&
          s.currency === (t.currency ?? account.baseCurrency) &&
          s.assetClass === t.assetClass,
      );
      if (candidates.length > 1)
        throw Error("Ambiguous instrument: select a security ID");
      security = candidates[0];
      if (!security) {
        security = {
          id: legacySecurityId(
            t.symbol,
            t.currency ?? account.baseCurrency,
            t.assetClass,
          ),
          symbol: t.symbol,
          name: t.name ?? t.symbol,
          exchange: "UNRESOLVED",
          currency: t.currency ?? account.baseCurrency,
          assetClass: t.assetClass,
          priceMultiplier: 1,
          shariaStatus: "unknown",
        };
        securities.push(security);
      }
    }
    if (
      !security ||
      security.assetClass !== t.assetClass ||
      security.currency !== (t.currency ?? account.baseCurrency)
    )
      throw Error("Trade/security currency or classification mismatch");
    return { ...t, accountId: account.id, securityId: security.id };
  });
  const cashMovements = state.cashMovements.map((m) => {
    const a = accounts.find(
      (a) =>
        a.id ===
        (m.accountId ?? accounts.find((a) => a.clientId === m.clientId)?.id),
    );
    if (!a || a.clientId !== m.clientId) throw Error("Invalid cash account");
    return { ...m, accountId: a.id };
  });
  const corporateActions = state.corporateActions.map((a) => {
    const account = accounts.find(
      (x) =>
        x.id ===
        (a.accountId ?? accounts.find((x) => x.clientId === a.clientId)?.id),
    );
    if (!account || account.clientId !== a.clientId)
      throw Error("Invalid action account");
    const candidates = securities.filter((s) => s.symbol === a.symbol);
    const security = a.securityId
      ? securities.find((s) => s.id === a.securityId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!security)
      throw Error("Corporate action requires an unambiguous security ID");
    return { ...a, accountId: account.id, securityId: security.id };
  });
  const knownAccount = (v: unknown) => {
    const id = text(v);
    if (!accounts.some((a) => a.id === id)) throw Error("Unknown account");
    return id;
  };
  const knownSecurity = (v: unknown) => {
    const id = text(v);
    if (!securities.some((s) => s.id === id)) throw Error("Unknown security");
    return id;
  };
  const observations = unique(
    root
      ? list(root.observations, (r) => {
          const scope = text(r.scope);
          if (
            !["partial", "complete"].includes(scope) ||
            r.basis !== "trade-date"
          )
            throw Error("Unsupported statement scope or accounting basis");
          const rows = list(r.rows, (v) => ({
            ...(v.securityId
              ? { securityId: knownSecurity(v.securityId) }
              : {}),
            symbol: text(v.symbol),
            currency: ccy(v.currency),
            quantity: numeric(v.quantity),
            ...(v.price !== undefined ? { price: numeric(v.price) } : {}),
            ...(v.reportedValue !== undefined
              ? { reportedValue: numeric(v.reportedValue) }
              : {}),
            ...(v.unitMultiplier !== undefined
              ? { unitMultiplier: numeric(v.unitMultiplier) }
              : {}),
            ...(v.priceAsOf ? { priceAsOf: instant(v.priceAsOf) } : {}),
            ...(v.priceConvention
              ? {
                  priceConvention: (() => {
                    if (!["clean", "dirty"].includes(String(v.priceConvention)))
                      throw Error("Invalid price convention");
                    return v.priceConvention as "clean" | "dirty";
                  })(),
                }
              : {}),
          }));
          if (
            new Set(rows.map((x) => x.securityId ?? x.symbol)).size !==
            rows.length
          )
            throw Error("Duplicate statement position");
          for (const row of rows)
            if (
              row.securityId &&
              securities.find((s) => s.id === row.securityId)?.currency !==
                row.currency
            )
              throw Error("Statement security currency mismatch");
          const accountId = knownAccount(r.accountId);
          const cash = r.cash === undefined ? undefined : numeric(r.cash);
          const cashCurrency = r.cashCurrency ? ccy(r.cashCurrency) : undefined;
          if (cash !== undefined && !cashCurrency)
            throw Error("Cash currency is required");
          return {
            id: text(r.id),
            accountId,
            effectiveDate: day(r.effectiveDate),
            receivedAt: instant(r.receivedAt),
            source: text(r.source),
            sourceHash: text(r.sourceHash),
            scope: scope as "partial" | "complete",
            basis: "trade-date" as const,
            rows,
            ...(cash !== undefined ? { cash, cashCurrency } : {}),
            ...(r.supersedesId ? { supersedesId: text(r.supersedesId) } : {}),
          };
        })
      : [],
  );
  const hashes = new Set<string>();
  for (const o of observations) {
    const k = JSON.stringify([o.accountId, o.sourceHash]);
    if (hashes.has(k)) throw Error("Statement already imported");
    hashes.add(k);
    if (
      o.supersedesId &&
      !observations.some(
        (p) =>
          p.id === o.supersedesId &&
          p.accountId === o.accountId &&
          p.receivedAt < o.receivedAt,
      )
    )
      throw Error("Invalid superseded observation");
  }
  const reviews = unique(
    root
      ? list(root.reviews, (r) => {
          if (
            !observations.some((o) => o.id === r.observationId) ||
            !["accepted", "resolved"].includes(String(r.status))
          )
            throw Error("Invalid break review");
          return {
            id: text(r.id),
            observationId: text(r.observationId),
            key: text(r.key),
            status: r.status as "accepted" | "resolved",
            reason: text(r.reason),
            recordedAt: instant(r.recordedAt),
          };
        })
      : [],
  );
  const overrides = unique(
    root
      ? list(root.overrides, (r) => {
          const securityId = knownSecurity(r.securityId),
            currency = ccy(r.currency);
          if (
            securities.find((s) => s.id === securityId)?.currency !== currency
          )
            throw Error("Override currency mismatch");
          const effectiveAt = instant(r.effectiveAt),
            expiresAt = instant(r.expiresAt);
          if (expiresAt <= effectiveAt)
            throw Error("Override expiry must follow effective time");
          return {
            id: text(r.id),
            securityId,
            currency,
            price: numeric(r.price),
            effectiveAt,
            expiresAt,
            recordedAt: instant(r.recordedAt),
            source: text(r.source),
            reason: text(r.reason),
          };
        })
      : [],
  );
  const groups = (v: unknown) =>
    unique(
      list(v, (r) => {
        if (!Array.isArray(r.accountIds) || !r.accountIds.length)
          throw Error("Group requires accounts");
        const accountIds = r.accountIds.map(knownAccount);
        if (new Set(accountIds).size !== accountIds.length)
          throw Error("Duplicate group account");
        return { id: text(r.id), label: text(r.label), accountIds };
      }),
    );
  const controls: BookControls = {
    accounts,
    securities,
    observations,
    reviews,
    overrides,
    households: root ? groups(root.households) : [],
    views: root ? groups(root.views) : [],
  };
  return { ...state, transactions, cashMovements, corporateActions, controls };
}
