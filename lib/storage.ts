import { DpmState } from "./types";

const STORAGE_KEY = "dpm-desk-state-v1";

export const seedState: DpmState = {
  clients: [
    {
      id: "c001",
      code: "C001",
      label: "Balanced Mandate",
      baseCurrency: "USD",
      benchmark: "60% SPY / 40% BND",
      riskProfile: "Balanced",
      initialCash: 500000,
    },
    {
      id: "c002",
      code: "C002",
      label: "Growth Mandate",
      baseCurrency: "USD",
      benchmark: "SPY",
      riskProfile: "Growth",
      initialCash: 750000,
    },
  ],
  transactions: [
    { id: "t1", clientId: "c001", symbol: "AAPL", name: "Apple", assetClass: "US Equity", side: "BUY", quantity: 300, price: 220, fees: 15, fxRate: 1, tradeDate: "2026-09-15" },
    { id: "t2", clientId: "c001", symbol: "SPY", name: "SPDR S&P 500 ETF", assetClass: "ETF", side: "BUY", quantity: 250, price: 660, fees: 15, fxRate: 1, tradeDate: "2026-09-15" },
    { id: "t3", clientId: "c001", symbol: "BTC-USD", name: "Bitcoin", assetClass: "Crypto", side: "BUY", quantity: 0.4, price: 108000, fees: 20, fxRate: 1, tradeDate: "2026-09-16" },
    { id: "t4", clientId: "c002", symbol: "NVDA", name: "NVIDIA", assetClass: "US Equity", side: "BUY", quantity: 1200, price: 184, fees: 20, fxRate: 1, tradeDate: "2026-09-10" },
    { id: "t5", clientId: "c002", symbol: "QQQ", name: "Invesco QQQ", assetClass: "ETF", side: "BUY", quantity: 500, price: 590, fees: 20, fxRate: 1, tradeDate: "2026-09-10" },
  ],
  targets: [
    { clientId: "c001", assetClass: "US Equity", targetPct: 20, minPct: 10, maxPct: 30 },
    { clientId: "c001", assetClass: "ETF", targetPct: 35, minPct: 25, maxPct: 45 },
    { clientId: "c001", assetClass: "Bond/Sukuk", targetPct: 30, minPct: 20, maxPct: 40 },
    { clientId: "c001", assetClass: "Crypto", targetPct: 5, minPct: 0, maxPct: 10 },
    { clientId: "c001", assetClass: "Cash", targetPct: 10, minPct: 5, maxPct: 20 },
    { clientId: "c002", assetClass: "US Equity", targetPct: 45, minPct: 35, maxPct: 60 },
    { clientId: "c002", assetClass: "ETF", targetPct: 35, minPct: 25, maxPct: 45 },
    { clientId: "c002", assetClass: "Crypto", targetPct: 10, minPct: 5, maxPct: 20 },
    { clientId: "c002", assetClass: "Cash", targetPct: 10, minPct: 3, maxPct: 20 },
  ],
};

export function loadState(): DpmState {
  if (typeof window === "undefined") return seedState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DpmState) : seedState;
  } catch {
    return seedState;
  }
}

export function saveState(state: DpmState) {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function exportState(state: DpmState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dpm-desk-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importState(file: File): Promise<DpmState> {
  const text = await file.text();
  const parsed = JSON.parse(text) as DpmState;
  if (!Array.isArray(parsed.clients) || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.targets)) {
    throw new Error("Invalid DPM backup file");
  }
  return parsed;
}

export function resetState() {
  if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
}
