import { describe, it, expect } from "vitest";
import { validateState } from "../lib/validation";
import { seedState } from "../lib/storage";
import { buildPortfolio } from "../lib/portfolio";
import { calculatePerformance } from "../lib/performance";
import {
  addAccount,
  addOverride,
  previewObservation,
  reconcile,
  selectPrices,
  groupedAccountTotals,
  feeEstimate,
  reportCsv,
} from "../lib/controls";
import type { DpmState, CustodianObservation } from "../lib/types";
const migrated = () => validateState({ ...seedState, version: 3 });
const simple = () =>
  validateState({
    version: 3,
    clients: [
      {
        id: "c",
        code: "C",
        label: "Client",
        baseCurrency: "USD",
        benchmark: "SPY",
        riskProfile: "Balanced",
        initialCash: 10000,
      },
    ],
    transactions: [
      {
        id: "t",
        clientId: "c",
        symbol: "X",
        currency: "USD",
        assetClass: "ETF",
        side: "BUY",
        quantity: 10,
        price: 100,
        fees: 2,
        fxRate: 1,
        sequence: 1,
        tradeDate: "2026-01-02",
      },
    ],
    cashMovements: [],
    corporateActions: [],
    targets: [{ clientId: "c", assetClass: "Cash", targetPct: 100 }],
  });
const observation = (
  s: DpmState,
  extra: Partial<CustodianObservation> = {},
): CustodianObservation => ({
  id: "o",
  accountId: s.controls!.accounts[0].id,
  effectiveDate: "2026-01-03",
  receivedAt: "2026-01-04T00:00:00.000Z",
  source: "Test",
  sourceHash: "hash",
  scope: "complete",
  basis: "trade-date",
  rows: [
    {
      securityId: s.controls!.securities[0].id,
      symbol: "X",
      currency: "USD",
      quantity: 10,
    },
  ],
  ...extra,
});
describe("v4 normalized book", () => {
  it("preserves fixed-price cash, cost and P&L on migration", () => {
    const legacy = { ...seedState, version: 3 },
      s = validateState(legacy);
    for (const c of s.clients) {
      const before = buildPortfolio(c, legacy, {}),
        after = buildPortfolio(c, s, {});
      for (const k of [
        "cash",
        "marketValue",
        "costBasis",
        "realisedPnl",
        "totalPnl",
      ] as const)
        expect(after[k]).toBe(before[k]);
      expect(after.holdings.map((h) => h.quantity)).toEqual(
        before.holdings.map((h) => h.quantity),
      );
    }
    expect(s.transactions.map((t) => t.sequence)).toEqual(
      legacy.transactions.map((t) => t.sequence),
    );
  });
  it("round trips every control extension", () => {
    const s = simple();
    s.controls!.observations.push(observation(s));
    s.controls!.households.push({
      id: "h",
      label: "Home",
      accountIds: [s.controls!.accounts[0].id],
    });
    expect(validateState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it("does not use another account's cash", () => {
    let s = addAccount(simple(), {
      clientId: "c",
      label: "Empty",
      custodian: "B",
    });
    s.transactions.push({
      ...s.transactions[0],
      id: "t2",
      sequence: 2,
      accountId: s.controls!.accounts[1].id,
    });
    expect(() => validateState(s)).toThrow(/insufficient cash/);
  });
  it("does not sell another account's holdings", () => {
    const s = addAccount(simple(), {
      clientId: "c",
      label: "Empty",
      custodian: "B",
    });
    s.transactions.push({
      ...s.transactions[0],
      id: "sell",
      side: "SELL",
      sequence: 2,
      accountId: s.controls!.accounts[1].id,
    });
    expect(() => validateState(s)).toThrow(/exceeds|holdings|insufficient/i);
  });
  it("scopes split actions and FIFO to account", () => {
    let s = addAccount(simple(), {
      clientId: "c",
      label: "Second",
      custodian: "B",
    });
    const a = s.controls!.accounts[1];
    s.cashMovements.push({
      id: "fund",
      clientId: "c",
      accountId: a.id,
      sequence: 2,
      kind: "DEPOSIT",
      amount: 1000,
      currency: "USD",
      fxRate: 1,
      movementDate: "2026-01-02",
    });
    s.transactions.push({
      ...s.transactions[0],
      id: "other",
      sequence: 3,
      accountId: a.id,
      quantity: 2,
    });
    s.corporateActions.push({
      id: "split",
      clientId: "c",
      accountId: s.controls!.accounts[0].id,
      securityId: s.controls!.securities[0].id,
      sequence: 4,
      symbol: "X",
      kind: "SPLIT",
      factor: 2,
      actionDate: "2026-01-03",
    });
    s = validateState(s);
    const p = buildPortfolio(s.clients[0], s, {});
    expect(p.holdings.map((h) => h.quantity)).toEqual([20, 2]);
    expect(p.costBasis).toBe(1204);
  });
  it("keeps same ticker on two exchanges distinct and rejects ambiguous automatic mapping", () => {
    const s = simple(),
      first = s.controls!.securities[0];
    s.controls!.securities.push({ ...first, id: "other", exchange: "OTHER" });
    expect(validateState(s).controls!.securities).toHaveLength(2);
    const t = {
      ...s.transactions[0],
      id: "othertrade",
      sequence: 2,
      securityId: "other",
    };
    s.transactions.push(t);
    const v = validateState(s);
    const p = buildPortfolio(v.clients[0], v, {
      X: {
        symbol: "X",
        price: 500,
        currency: "USD",
        asOf: new Date().toISOString(),
        source: "Test",
      },
    });
    expect(p.holdings).toHaveLength(2);
    expect(p.valuationComplete).toBe(false);
    delete s.transactions[1].securityId;
    expect(() => validateState(s)).toThrow(/Ambiguous/);
  });
  it("prices a percentage-of-par instrument using an explicit multiplier", () => {
    const s = simple();
    s.controls!.securities[0].priceMultiplier = 0.01;
    const v = validateState(s),
      p = buildPortfolio(v.clients[0], v, {
        X: {
          symbol: "X",
          price: 110,
          currency: "USD",
          asOf: new Date().toISOString(),
          source: "Test",
        },
      });
    expect(p.costBasis).toBe(12);
    expect(p.investedValue).toBe(11);
    expect(p.cash).toBe(9988);
  });
  it("rejects duplicate IDs, aliases and invalid ISIN checksums", () => {
    const s = simple();
    s.controls!.securities.push({ ...s.controls!.securities[0] });
    expect(() => validateState(s)).toThrow(/Duplicate/);
    const t = simple();
    t.controls!.securities[0].isin = "US0378331004";
    expect(() => validateState(t)).toThrow(/ISIN/);
    t.controls!.securities[0].isin = "US0378331005";
    expect(() => validateState(t)).not.toThrow();
  });
  it("requires dated sources for screened status", () => {
    const s = simple();
    s.controls!.securities[0].shariaStatus = "screened";
    expect(() => validateState(s)).toThrow(/source/);
  });
  it("rejects cross-client account references and opening-cash drift", () => {
    const s = migrated();
    s.transactions[0].accountId = s.controls!.accounts[1].id;
    expect(() => validateState(s)).toThrow(/account/);
    const t = simple();
    t.controls!.accounts[0].initialCash++;
    expect(() => validateState(t)).toThrow(/reconcile/);
  });
});
describe("historical reconciliation", () => {
  it("compares positions as of the statement date", () => {
    const s = simple();
    expect(reconcile(s, observation(s))[0].kind).toBe("matched");
    expect(
      reconcile(s, observation(s, { effectiveDate: "2026-01-01" }))[0].kind,
    ).toBe("missing internally");
  });
  it("does not infer missing positions from a partial or unmapped statement", () => {
    const s = simple();
    expect(
      reconcile(s, observation(s, { scope: "partial", rows: [] })),
    ).toHaveLength(0);
    expect(
      reconcile(
        s,
        observation(s, {
          rows: [{ symbol: "?", currency: "USD", quantity: 1 }],
        }),
      ),
    ).toMatchObject([{ kind: "unmapped" }]);
  });
  it("displays quantity/cash differences and applied tolerances", () => {
    const s = simple(),
      o = observation(s, {
        cash: 9000,
        cashCurrency: "USD",
        rows: [{ ...observation(s).rows[0], quantity: 10.01 }],
      });
    expect(reconcile(s, o, 0.02, 0)).toMatchObject([
      { kind: "matched", tolerance: 0.02 },
      { kind: "cash mismatch" },
    ]);
  });
  it("treats foreign currency cash as not comparable", () => {
    const s = simple();
    expect(
      reconcile(s, observation(s, { cash: 8998, cashCurrency: "EUR" })).at(-1)
        ?.kind,
    ).toBe("not comparable");
    expect(() =>
      validateState({
        ...s,
        controls: {
          ...s.controls!,
          observations: [observation(s, { cash: 1, cashCurrency: "EUR" })],
        },
      }),
    ).not.toThrow();
  });
  it("previews CSV and blocks a duplicate source without touching the ledger", async () => {
    const s = simple(),
      csv = `security_id,symbol,currency,quantity\n${s.controls!.securities[0].id},X,USD,10`;
    const p = await previewObservation(s, csv, {
      accountId: s.controls!.accounts[0].id,
      effectiveDate: "2026-01-03",
      scope: "complete",
      source: "Custodian",
    });
    expect(p.sourceHash).toHaveLength(64);
    s.controls!.observations.push(p);
    await expect(
      previewObservation(s, csv, {
        accountId: p.accountId,
        effectiveDate: p.effectiveDate,
        scope: p.scope,
        source: p.source,
      }),
    ).rejects.toThrow(/already imported/);
    expect(s.transactions).toHaveLength(1);
  });
  it("rejects malformed, duplicate-position and blank-quantity CSV", async () => {
    const s = simple(),
      options = {
        accountId: s.controls!.accounts[0].id,
        effectiveDate: "2026-01-03",
        scope: "complete" as const,
        source: "Test",
      };
    for (const csv of [
      "bad,header",
      "security_id,symbol,currency,quantity\n,X,USD,",
      "security_id,symbol,currency,quantity\n,X,USD,2\n,X,USD,3",
    ])
      await expect(previewObservation(s, csv, options)).rejects.toThrow();
  });
});
describe("price lineage and reporting", () => {
  it("retains expired alternatives and uses only active overrides including zero", () => {
    const s = simple(),
      id = s.controls!.securities[0].id;
    let v = addOverride(s, {
      securityId: id,
      price: 0,
      currency: "USD",
      effectiveAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-03T00:00:00Z",
      source: "Test",
      reason: "Write down",
    });
    expect(selectPrices(v, {}, "2026-01-02T00:00:00Z").quotes[id].price).toBe(
      0,
    );
    const expired = selectPrices(v, {}, "2026-01-04T00:00:00Z");
    expect(expired.quotes[id]).toBeUndefined();
    expect(expired.lineage[0].rejected[0]).toMatch(/expired/);
  });
  it("falls back to market quotes after expiry and records selection reason", () => {
    const s = simple(),
      id = s.controls!.securities[0].id;
    const v = addOverride(s, {
      securityId: id,
      price: 120,
      currency: "USD",
      effectiveAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-03T00:00:00Z",
      source: "Test",
      reason: "Test",
    });
    const q = {
      X: {
        symbol: "X",
        price: 130,
        currency: "USD",
        asOf: "2026-01-04T00:00:00Z",
        source: "Provider",
      },
    };
    expect(selectPrices(v, q, "2026-01-04T00:00:00Z").quotes[id].price).toBe(
      130,
    );
  });
  it("rejects currency mismatch and backwards expiry", () => {
    const s = simple();
    expect(() =>
      addOverride(s, {
        securityId: s.controls!.securities[0].id,
        price: 1,
        currency: "EUR",
        effectiveAt: "2026-01-01T00:00:00Z",
        expiresAt: "2026-01-02T00:00:00Z",
        source: "x",
        reason: "x",
      }),
    ).toThrow(/currency/);
  });
  it("does not double count group membership or sum mixed currencies", () => {
    const s = migrated();
    s.clients[1].baseCurrency = "AED";
    s.controls!.accounts[1].baseCurrency = "AED";
    s.transactions = s.transactions.filter(
      (t) => t.clientId !== s.clients[1].id,
    );
    const ids = s.controls!.accounts.map((a) => a.id);
    expect(Object.keys(groupedAccountTotals(s, ids)).sort()).toEqual([
      "AED",
      "USD",
    ]);
    expect(() => groupedAccountTotals(s, [ids[0], ids[0]])).toThrow(
      /Duplicate/,
    );
    s.controls!.households.push({
      id: "h",
      label: "Group",
      accountIds: [ids[0], ids[0]],
    });
    expect(() => validateState(s)).toThrow(/Duplicate/);
  });
  it("exports an explicit as-of valuation status and prevents formula injection", () => {
    const s = simple();
    s.clients[0].code = "=CMD";
    const csv = reportCsv(s, [s.controls!.accounts[0].id], {}, "2026-01-03");
    expect(csv).toContain("indicative cost / incomplete");
    expect(csv).toContain("'=CMD");
  });
  it("calculates a bounded Actual/365 estimate without ledger mutation", () => {
    expect(feeEstimate(100000, 100, 365)).toBe(1000);
    expect(() => feeEstimate(1, 10001, 1)).toThrow();
  });
  it("keeps migrated performance identical with split records", () => {
    const s = simple(),
      id = s.controls!.securities[0].id;
    s.corporateActions.push({
      id: "split",
      clientId: "c",
      accountId: s.controls!.accounts[0].id,
      securityId: id,
      sequence: 2,
      symbol: "X",
      actionDate: "2026-01-03",
      kind: "SPLIT",
      factor: 2,
    });
    const v = validateState(s),
      h = [
        {
          symbol: "X",
          currency: "USD",
          points: [
            { date: "2026-01-01", close: 100 },
            { date: "2026-01-02", close: 100 },
            { date: "2026-01-03", close: 50 },
            { date: "2026-01-04", close: 55 },
          ],
        },
      ];
    expect(
      calculatePerformance(v, v.clients[0], h, "2026-01-02", "2026-01-04")
        .endValue,
    ).toBe(10098);
  });
});

describe("valuation compatibility gates", () => {
  it("compares clean values only with explicit compatible units and dates", () => {
    const s = simple(),
      id = s.controls!.securities[0].id;
    const v = addOverride(s, {
      securityId: id,
      price: 100,
      currency: "USD",
      effectiveAt: "2026-01-03T12:00:00Z",
      expiresAt: "2026-01-04T12:00:00Z",
      source: "Test",
      reason: "Price validation",
    });
    const o = observation(v);
    o.rows[0] = {
      ...o.rows[0],
      price: 100,
      reportedValue: 1000,
      unitMultiplier: 1,
      priceAsOf: "2026-01-03T12:00:00.000Z",
      priceConvention: "clean",
    };
    expect(reconcile(v, o)[1].kind).toBe("matched");
    o.rows[0].reportedValue = 1100;
    expect(reconcile(v, o)[1].kind).toBe("price/value mismatch");
    o.rows[0].priceConvention = "dirty";
    expect(reconcile(v, o)[1].kind).toBe("not comparable");
  });
  it("fails closed for incomplete v4 controls", () => {
    expect(() => validateState({ ...seedState, version: 4 })).toThrow(
      /control/,
    );
  });
  it("does not change security IDs or original ledger symbols when pricing mapping changes", () => {
    const s = simple(),
      id = s.transactions[0].securityId;
    s.controls!.securities[0].exchange = "XLON";
    s.controls!.securities[0].symbol = "X.L";
    const v = validateState(s);
    expect(v.transactions[0].symbol).toBe("X");
    expect(v.transactions[0].securityId).toBe(id);
    expect(
      buildPortfolio(v.clients[0], v, {
        "X.L": {
          symbol: "X.L",
          currency: "USD",
          price: 105,
          asOf: new Date().toISOString(),
          source: "Test",
        },
      }).investedValue,
    ).toBe(1050);
  });
});
