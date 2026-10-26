import { buildClientPortalSnapshot } from "../lib/client-portal";
import type { DpmState } from "../lib/types";
export function fixture(
  options: {
    accountId?: string;
    baseCurrency?: string;
    publishedAt?: string;
    performance?: boolean;
  } = {},
) {
  const accountId = options.accountId ?? "a",
    currency = options.baseCurrency ?? "USD",
    publishedAt = options.publishedAt ?? "2026-10-24T10:00:00Z";
  const state: DpmState = {
    version: 4,
    revision: 7,
    clients: [
      {
        id: "c",
        code: "SYNTHETIC-1",
        label: "Private office label",
        baseCurrency: currency,
        benchmark: "SPY",
        riskProfile: "Balanced",
        initialCash: 1000,
      },
    ],
    transactions: [
      {
        id: "t",
        clientId: "c",
        accountId,
        securityId: "sec",
        sequence: 1,
        symbol: "ACME",
        assetClass: "US Equity",
        side: "BUY",
        quantity: 2,
        price: 200,
        fees: 0,
        fxRate: 1,
        tradeDate: "2026-10-01",
        currency,
      },
    ],
    cashMovements: [],
    corporateActions: [],
    targets: [],
    controls: {
      accounts: [
        {
          id: accountId,
          clientId: "c",
          label: "Private account",
          custodian: "Private custodian",
          baseCurrency: currency,
          initialCash: 1000,
        },
      ],
      securities: [
        {
          id: "sec",
          symbol: "ACME",
          name: "Synthetic company",
          exchange: "TEST",
          currency,
          assetClass: "US Equity",
          priceMultiplier: 1,
          shariaStatus: "unknown",
        },
      ],
      observations: [],
      reviews: [],
      overrides: [],
      households: [],
      views: [],
    },
  };
  return buildClientPortalSnapshot({
    state,
    clientId: "c",
    accountId,
    snapshotId: "synthetic-snapshot-1",
    publishedAt,
    quotes: {
      sec: {
        symbol: "ACME",
        price: 250,
        previousClose: 240,
        currency,
        asOf: new Date(Date.parse(publishedAt) - 60000).toISOString(),
        source: "Synthetic test feed",
      },
    },
    ...(options.performance
      ? {
          performancePeriod: {
            startDate: "2026-10-01",
            endDate: publishedAt.slice(0, 10),
          },
          history: [
            {
              symbol: "sec",
              currency,
              points: [
                { date: "2026-09-30", close: 200 },
                { date: "2026-10-01", close: 200 },
                { date: publishedAt.slice(0, 10), close: 250 },
              ],
            },
            {
              symbol: "SPY",
              currency,
              points: [
                { date: "2026-09-30", close: 100 },
                { date: "2026-10-01", close: 100 },
                { date: publishedAt.slice(0, 10), close: 105 },
              ],
            },
          ],
        }
      : {}),
  });
}
