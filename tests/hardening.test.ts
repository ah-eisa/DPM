import { describe, expect, it, vi } from "vitest";
import { POSITION_EPSILON } from "../lib/constants";
import { calculatePerformance, HistorySeries } from "../lib/performance";
import { buildPortfolio } from "../lib/portfolio";
import { DpmState } from "../lib/types";
import { currency, validateState } from "../lib/validation";

const baseState = (quantity: number, symbol = "X"): DpmState => ({
  version: 3,
  clients: [{ id: "c1", code: "C001", label: "Test", baseCurrency: "USD", benchmark: "SPY", riskProfile: "Balanced", initialCash: 1000 }],
  transactions: [{ id: "t1", sequence: 1, clientId: "c1", symbol, assetClass: "ETF", side: "BUY", quantity, price: 1, fees: 0, fxRate: 1, currency: "USD", tradeDate: "2026-01-02" }],
  cashMovements: [],
  corporateActions: [],
  targets: [{ clientId: "c1", assetClass: "Cash", targetPct: 100 }],
});

const history = (symbol: string, values: [string, number][]): HistorySeries => ({
  symbol,
  currency: "USD",
  points: values.map(([date, close]) => ({ date, close })),
});

describe("legacy currency validation", () => {
  it("uses the explicit fallback list when Intl.supportedValuesOf is unavailable", () => {
    const spy = vi.spyOn(Intl, "supportedValuesOf").mockImplementation((() => { throw new TypeError("legacy engine"); }) as typeof Intl.supportedValuesOf);
    try {
      expect(currency("aed")).toBe("AED");
      expect(currency("USD")).toBe("USD");
      expect(() => currency("ZZZ")).toThrow(/Unsupported currency/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("shared quantity dust threshold", () => {
  it("rejects trades below the same epsilon used by portfolio calculations", () => {
    expect(() => validateState(baseState(POSITION_EPSILON / 2))).toThrow(/quantity/);
  });

  it("keeps a position exactly at the supported epsilon", () => {
    const state = validateState(baseState(POSITION_EPSILON));
    const summary = buildPortfolio(state.clients[0], state, {});
    expect(summary.holdings).toHaveLength(1);
    expect(summary.holdings[0].quantity).toBe(POSITION_EPSILON);
  });
});

describe("defensive performance symbol normalization", () => {
  it("matches lowercase ledger symbols to uppercase market history", () => {
    const state = baseState(1, "x");
    state.transactions[0].price = 100;
    const series = [
      history("X", [["2026-01-02", 100], ["2026-01-05", 110]]),
      history("SPY", [["2026-01-02", 100], ["2026-01-05", 100]]),
    ];
    const result = calculatePerformance(state, state.clients[0], series, "2026-01-02", "2026-01-05");
    expect(result.twrPct).toBeCloseTo(1);
  });
});
