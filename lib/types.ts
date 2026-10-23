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

export interface DpmState {
  version?: number;
  clients: Client[];
  transactions: Transaction[];
  targets: TargetAllocation[];
}

export interface Holding {
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
  unrealisedPnl: number;
  totalPnl: number;
  dayPnl: number;
  allocation: Record<string, number>;
}
