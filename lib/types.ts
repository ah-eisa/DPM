export type AssetClass =
  | "US Equity"
  | "UAE Equity"
  | "ETF"
  | "Bond/Sukuk"
  | "Crypto"
  | "Metal"
  | "Cash"
  | "Other";

export type Side = "BUY" | "SELL";
export type CashMovementKind = "DEPOSIT" | "WITHDRAWAL" | "DIVIDEND" | "COUPON" | "INTEREST" | "FEE" | "TAX" | "OTHER";
export type CorporateActionKind = "SPLIT" | "REVERSE_SPLIT" | "STOCK_DIVIDEND";

export interface Client {
  id: string;
  code: string;
  label: string;
  baseCurrency: string;
  benchmark: string;
  riskProfile: "Conservative" | "Balanced" | "Growth" | "Custom";
  initialCash: number;
}

export interface Transaction {
  sequence?: number;
  currency?: string;
  id: string;
  accountId?: string;
  securityId?: string;
  clientId: string;
  symbol: string;
  name?: string;
  assetClass: AssetClass;
  side: Side;
  quantity: number;
  price: number;
  fees: number;
  fxRate: number;
  tradeDate: string;
  gtnRef?: string;
  notes?: string;
}

export interface CashMovement {
  id: string;
  accountId?: string;
  securityId?: string;
  clientId: string;
  sequence: number;
  kind: CashMovementKind;
  amount: number;
  currency: string;
  fxRate: number;
  movementDate: string;
  symbol?: string;
  reference?: string;
  notes?: string;
}

export interface CorporateAction {
  id: string;
  accountId?: string;
  securityId?: string;
  clientId: string;
  sequence: number;
  kind: CorporateActionKind;
  symbol: string;
  actionDate: string;
  factor: number;
  reference?: string;
  notes?: string;
}

export interface TargetAllocation {
  clientId: string;
  assetClass: AssetClass;
  targetPct: number;
  minPct?: number;
  maxPct?: number;
}

export interface Quote {
  stale?: boolean;
  fetchedAt?: string;
  symbol: string;
  price: number;
  currency?: string;
  previousClose?: number;
  changePct?: number;
  asOf: string;
  source: string;
}

export interface Account {
  id: string; clientId: string; label: string; custodian: string; baseCurrency: string; initialCash: number;
}
export interface Security {
  id: string; symbol: string; name: string; exchange: string; currency: string; assetClass: AssetClass;
  isin?: string; priceMultiplier: number; shariaStatus: "unknown" | "screened"; shariaSource?: string; shariaDate?: string;
}
export interface CustodianObservation {
  id: string; accountId: string; effectiveDate: string; receivedAt: string; source: string; sourceHash: string;
  scope: "partial" | "complete"; basis: "trade-date"; rows: { securityId?: string; symbol: string; currency: string; quantity: number; price?: number; reportedValue?: number; unitMultiplier?: number; priceAsOf?: string; priceConvention?: "clean" | "dirty" }[];
  cash?: number; cashCurrency?: string; supersedesId?: string;
}
export interface BreakReview { id: string; observationId: string; key: string; status: "accepted" | "resolved"; reason: string; recordedAt: string; }
export interface PriceOverride { id: string; securityId: string; price: number; currency: string; effectiveAt: string; expiresAt: string; recordedAt: string; source: string; reason: string; }
export interface Household { id: string; label: string; accountIds: string[]; }
export interface SavedView { id: string; label: string; accountIds: string[]; }
export interface BookControls { accounts: Account[]; securities: Security[]; observations: CustodianObservation[]; reviews: BreakReview[]; overrides: PriceOverride[]; households: Household[]; views: SavedView[]; }
export interface BookChange { id: string; revisionBefore: number; revisionAfter: number; recordedAt: string; action: string; actor: "Local operator (unverified)"; before: DpmState | null; after: DpmState; }

export interface LegacySequenceMigration {
  sourceVersion: 1 | 2 | 3;
  rule: "date/old-sequence/event-priority/stable-id";
  mapping: {type:"trade"|"cash"|"action";id:string;oldSequence:number;newSequence:number}[];
}
export interface DpmState {
  sequenceMigration?: LegacySequenceMigration;
  controls?: BookControls;
  revision?: number;
  version?: number;
  clients: Client[];
  transactions: Transaction[];
  cashMovements: CashMovement[];
  corporateActions: CorporateAction[];
  targets: TargetAllocation[];
}

export interface Holding {
  priceSource?: string;
  priceAsOf?: string;
  priceChangePct?: number;
  securityId?: string;
  accountId?: string;
  valuationStatus: "live" | "stale" | "cost";
  valuationNote?: string;
  symbol: string;
  name?: string;
  assetClass: AssetClass;
  quantity: number;
  averageCost: number;
  costBasis: number;
  realisedPnl: number;
  marketPrice: number;
  marketValue: number;
  unrealisedPnl: number;
  totalPnl: number;
  weight: number;
}

export interface PortfolioSummary {
  dayPnlComplete: boolean;
  valuationComplete: boolean;
  client: Client;
  holdings: Holding[];
  cash: number;
  investedValue: number;
  marketValue: number;
  costBasis: number;
  realisedPnl: number;
  incomePnl: number;
  externalCashFlow: number;
  unrealisedPnl: number;
  totalPnl: number;
  dayPnl: number;
  allocation: Record<string, number>;
}
