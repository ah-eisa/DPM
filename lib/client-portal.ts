import { calculatePerformance, HistorySeries, PerformanceResult } from "./performance";
import { buildPortfolio, driftForClient } from "./portfolio";
import { selectPrices } from "./price-policy";
import type {
  Account,
  AssetClass,
  Client,
  DpmState,
  Quote,
} from "./types";

export const CLIENT_PORTAL_SNAPSHOT_VERSION = "1.0" as const;

export type ClientPortalHoldingV1 = {
  securityId?: string;
  symbol: string;
  name?: string;
  assetClass: AssetClass;
  quantity: number;
  averageCost: number;
  costBasis: number;
  marketPrice: number;
  marketValue: number;
  realisedPnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  weightPct: number;
  valuationStatus: "live" | "stale" | "cost";
  valuationNote?: string;
  priceSource?: string;
  priceAsOf?: string;
};

export type ClientPortalDriftV1 = {
  assetClass: AssetClass;
  targetPct: number;
  minPct?: number;
  maxPct?: number;
  actualPct: number;
  driftPct: number;
  breach: boolean;
};

export type ClientPortalPerformanceV1 = {
  startDate: string;
  endDate: string;
  twrPct: number;
  benchmarkPct?: number;
  excessPct?: number;
  startValue: number;
  endValue: number;
  externalFlows: number;
  benchmarkLabel: string;
  points: {
    date: string;
    value: number;
    portfolioIndex: number;
    benchmarkIndex?: number;
  }[];
};

export type ClientPortalPriceLineageV1 = {
  securityId: string;
  selected: string;
  rejected: string[];
};

export interface ClientPortalSnapshotV1 {
  schema: "dpm.client-portal.snapshot";
  version: typeof CLIENT_PORTAL_SNAPSHOT_VERSION;
  snapshotId: string;
  publishedAt: string;
  bookRevision: number;
  clientCode: string;
  accountId: string;
  baseCurrency: string;
  benchmark: string;
  riskProfile: Client["riskProfile"];
  nav: number;
  cash: number;
  investedValue: number;
  realisedPnl: number;
  incomePnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  dayPnl: number;
  dayPnlComplete: boolean;
  valuationComplete: boolean;
  allocation: Record<string, number>;
  holdings: ClientPortalHoldingV1[];
  drift: ClientPortalDriftV1[];
  priceLineage: ClientPortalPriceLineageV1[];
  performance?: ClientPortalPerformanceV1;
  warnings: string[];
}

export type BuildClientPortalSnapshotInput = {
  state: DpmState;
  clientId: string;
  accountId: string;
  quotes: Record<string, Quote>;
  snapshotId: string;
  publishedAt: string;
  history?: HistorySeries[];
  performancePeriod?: { startDate: string; endDate: string };
};

function requireIso(value: string, field: string) {
  if (!value || !Number.isFinite(Date.parse(value)))
    throw new Error(`${field} must be a valid timestamp`);
}

function requireDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)))
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
}

function accountFor(state: DpmState, clientId: string, accountId: string) {
  const account = state.controls?.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error(`Unknown account ${accountId}`);
  if (account.clientId !== clientId)
    throw new Error(`Account ${accountId} does not belong to client ${clientId}`);
  return account;
}

function scopedClient(client: Client, account: Account): Client {
  return {
    ...client,
    baseCurrency: account.baseCurrency,
    initialCash: account.initialCash,
  };
}

function requireAccountBoundEvents(state: DpmState, clientId: string) {
  const unbound = [
    ...state.transactions.filter((x) => x.clientId === clientId && !x.accountId),
    ...state.cashMovements.filter((x) => x.clientId === clientId && !x.accountId),
    ...state.corporateActions.filter((x) => x.clientId === clientId && !x.accountId),
  ];
  if (unbound.length)
    throw new Error(
      "Client portal publishing requires every client ledger event to have an accountId",
    );
}

function snapshotDate(publishedAt: string) {
  return new Date(Date.parse(publishedAt)).toISOString().slice(0, 10);
}

function scopeStateToAccount(
  state: DpmState,
  client: Client,
  account: Account,
  asOfDate: string,
): DpmState {
  requireAccountBoundEvents(state, client.id);
  const transactions = state.transactions.filter(
    (x) =>
      x.clientId === client.id &&
      x.accountId === account.id &&
      x.tradeDate <= asOfDate,
  );
  const cashMovements = state.cashMovements.filter(
    (x) =>
      x.clientId === client.id &&
      x.accountId === account.id &&
      x.movementDate <= asOfDate,
  );
  const corporateActions = state.corporateActions.filter(
    (x) =>
      x.clientId === client.id &&
      x.accountId === account.id &&
      x.actionDate <= asOfDate,
  );
  const securityIds = new Set(
    [...transactions, ...cashMovements, ...corporateActions]
      .map((x) => x.securityId)
      .filter((x): x is string => !!x),
  );
  const controls = state.controls
    ? {
        ...state.controls,
        accounts: [account],
        // Keep the complete security master so ticker ambiguity is preserved.
        // Output is still account-scoped and lineage is filtered before publishing.
        securities: state.controls.securities,
        observations: state.controls.observations.filter(
          (x) => x.accountId === account.id && x.effectiveDate <= asOfDate,
        ),
        overrides: state.controls.overrides.filter((x) =>
          securityIds.has(x.securityId),
        ),
        households: [],
        views: [],
      }
    : undefined;
  return {
    ...state,
    clients: [scopedClient(client, account)],
    transactions,
    cashMovements,
    corporateActions,
    targets: state.targets.filter((x) => x.clientId === client.id),
    controls,
  };
}

function portalPerformance(
  result: PerformanceResult,
  period: { startDate: string; endDate: string },
): ClientPortalPerformanceV1 {
  return {
    ...period,
    twrPct: result.twrPct,
    benchmarkPct: result.benchmarkPct,
    excessPct: result.excessPct,
    startValue: result.startValue,
    endValue: result.endValue,
    externalFlows: result.externalFlows,
    benchmarkLabel: result.benchmarkLabel,
    points: result.points.map((p) => ({
      date: p.date,
      value: p.value,
      portfolioIndex: p.portfolioIndex,
      benchmarkIndex: p.benchmarkIndex,
    })),
  };
}

export function buildClientPortalSnapshot(
  input: BuildClientPortalSnapshotInput,
): ClientPortalSnapshotV1 {
  requireIso(input.publishedAt, "publishedAt");
  if (!input.snapshotId.trim()) throw new Error("snapshotId is required");
  if (!input.state.controls)
    throw new Error("Client portal publishing requires a v4 controlled book");

  const asOfDate = snapshotDate(input.publishedAt);
  const client = input.state.clients.find((x) => x.id === input.clientId);
  if (!client) throw new Error(`Unknown client ${input.clientId}`);
  const account = accountFor(input.state, input.clientId, input.accountId);
  const portalClient = scopedClient(client, account);
  const scoped = scopeStateToAccount(input.state, client, account, asOfDate);
  const selection = selectPrices(scoped, input.quotes, input.publishedAt);
  const summary = buildPortfolio(
    portalClient,
    scoped,
    input.quotes,
    input.publishedAt,
  );
  const drift = driftForClient(scoped, summary).map((row) => ({
    assetClass: row.assetClass,
    targetPct: row.targetPct,
    minPct: row.minPct,
    maxPct: row.maxPct,
    actualPct: row.actualPct,
    driftPct: row.driftPct,
    breach: row.breach,
  }));

  let performance: ClientPortalPerformanceV1 | undefined;
  if (input.performancePeriod) {
    if (!input.history)
      throw new Error("history is required when performancePeriod is requested");
    requireDate(input.performancePeriod.startDate, "performancePeriod.startDate");
    requireDate(input.performancePeriod.endDate, "performancePeriod.endDate");
    if (input.performancePeriod.startDate > input.performancePeriod.endDate)
      throw new Error("performancePeriod startDate must not be after endDate");
    if (input.performancePeriod.endDate > asOfDate)
      throw new Error("performancePeriod endDate cannot be after snapshot publishedAt date");
    performance = portalPerformance(
      calculatePerformance(
        scoped,
        portalClient,
        input.history,
        input.performancePeriod.startDate,
        input.performancePeriod.endDate,
      ),
      input.performancePeriod,
    );
  }

  const holdingSecurityIds = new Set(
    summary.holdings.map((x) => x.securityId).filter((x): x is string => !!x),
  );
  const warnings = summary.holdings
    .filter((x) => x.valuationStatus !== "live")
    .map(
      (x) =>
        `${x.symbol}: ${x.valuationNote ?? `valuation status ${x.valuationStatus}`}`,
    );
  if (!summary.dayPnlComplete)
    warnings.push("Daily P&L is incomplete because one or more baselines are unavailable");

  return {
    schema: "dpm.client-portal.snapshot",
    version: CLIENT_PORTAL_SNAPSHOT_VERSION,
    snapshotId: input.snapshotId,
    publishedAt: input.publishedAt,
    bookRevision: input.state.revision ?? 0,
    clientCode: client.code,
    accountId: account.id,
    baseCurrency: account.baseCurrency,
    benchmark: client.benchmark,
    riskProfile: client.riskProfile,
    nav: summary.marketValue,
    cash: summary.cash,
    investedValue: summary.investedValue,
    realisedPnl: summary.realisedPnl,
    incomePnl: summary.incomePnl,
    unrealisedPnl: summary.unrealisedPnl,
    totalPnl: summary.totalPnl,
    dayPnl: summary.dayPnl,
    dayPnlComplete: summary.dayPnlComplete,
    valuationComplete: summary.valuationComplete,
    allocation: { ...summary.allocation },
    holdings: summary.holdings.map((h) => ({
      securityId: h.securityId,
      symbol: h.symbol,
      name: h.name,
      assetClass: h.assetClass,
      quantity: h.quantity,
      averageCost: h.averageCost,
      costBasis: h.costBasis,
      marketPrice: h.marketPrice,
      marketValue: h.marketValue,
      realisedPnl: h.realisedPnl,
      unrealisedPnl: h.unrealisedPnl,
      totalPnl: h.totalPnl,
      weightPct: h.weight,
      valuationStatus: h.valuationStatus,
      valuationNote: h.valuationNote,
      priceSource: h.priceSource,
      priceAsOf: h.priceAsOf,
    })),
    drift,
    priceLineage: selection.lineage.filter((x) =>
      holdingSecurityIds.has(x.securityId),
    ),
    performance,
    warnings,
  };
}
