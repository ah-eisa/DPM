import { DpmState } from "./types";
import { STATE_VERSION, validateState } from "./validation";
import { queueResilienceBackup } from "./resilience";

const STORAGE_KEY = "dpm-desk-state-v1";
const RECOVERY_KEY = "dpm-desk-recovery-v1";

export const seedState: DpmState = {
  revision: 0,
  version: STATE_VERSION,
  clients: [
    { id: "c001", code: "C001", label: "Balanced Mandate", baseCurrency: "USD", benchmark: "60% SPY / 40% BND", riskProfile: "Balanced", initialCash: 500000 },
    { id: "c002", code: "C002", label: "Growth Mandate", baseCurrency: "USD", benchmark: "SPY", riskProfile: "Growth", initialCash: 750000 },
  ],
  transactions: [
    { id: "t1", sequence: 1, clientId: "c001", symbol: "AAPL", name: "Apple", assetClass: "US Equity", side: "BUY", quantity: 300, price: 220, fees: 15, fxRate: 1, currency: "USD", tradeDate: "2026-09-15" },
    { id: "t2", sequence: 2, clientId: "c001", symbol: "SPY", name: "SPDR S&P 500 ETF", assetClass: "ETF", side: "BUY", quantity: 250, price: 660, fees: 15, fxRate: 1, currency: "USD", tradeDate: "2026-09-15" },
    { id: "t3", sequence: 3, clientId: "c001", symbol: "BTC-USD", name: "Bitcoin", assetClass: "Crypto", side: "BUY", quantity: 0.4, price: 108000, fees: 20, fxRate: 1, currency: "USD", tradeDate: "2026-09-16" },
    { id: "t4", sequence: 4, clientId: "c002", symbol: "NVDA", name: "NVIDIA", assetClass: "US Equity", side: "BUY", quantity: 1200, price: 184, fees: 20, fxRate: 1, currency: "USD", tradeDate: "2026-09-10" },
    { id: "t5", sequence: 5, clientId: "c002", symbol: "QQQ", name: "Invesco QQQ", assetClass: "ETF", side: "BUY", quantity: 500, price: 590, fees: 20, fxRate: 1, currency: "USD", tradeDate: "2026-09-10" },
  ],
  cashMovements: [],
  corporateActions: [],
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
    return validateState(raw ? JSON.parse(raw) : seedState);
  } catch (error) {
    throw new Error(`Saved book could not be loaded. It has not been overwritten. ${error instanceof Error ? error.message : "Invalid data"}`);
  }
}

export async function saveState(state: DpmState, options: { expectedRevision?: number; recovery?: boolean } = {}): Promise<DpmState> {
  const candidate = validateState(state);
  if (typeof window === "undefined") return candidate;
  if (!navigator.locks) throw new Error("Safe book writes require Web Locks support. Open this app in an up-to-date browser on localhost or HTTPS.");
  return navigator.locks.request("dpm-desk-book-write-v1", async () => {
    const previous = localStorage.getItem(STORAGE_KEY);
    let currentRevision = 0;
    if (previous) {
      try { currentRevision = validateState(JSON.parse(previous)).revision ?? 0; }
      catch { if (!options.recovery) throw new Error("Saved book is invalid. Use recovery mode before writing."); }
    }
    if (currentRevision !== (options.expectedRevision ?? candidate.revision ?? 0)) throw new Error("This book changed in another tab. Reload before retrying; your changes have not been saved.");
    const valid = { ...candidate, revision: currentRevision + 1 };
    if (!Number.isSafeInteger(valid.revision)) throw new Error("Book revision limit reached");
    if (previous) localStorage.setItem(RECOVERY_KEY, previous);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    queueResilienceBackup(valid);
    return valid;
  });
}

export function exportState(state: DpmState) {
  const blob = new Blob([JSON.stringify(validateState(state), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dpm-desk-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importState(file: File): Promise<DpmState> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Backup exceeds 5 MB");
  const text = await file.text();
  return validateState(JSON.parse(text));
}

export async function resetState(expectedRevision: number) {
  return saveState(seedState, { expectedRevision });
}

export function recoverState(): DpmState {
  const raw = localStorage.getItem(RECOVERY_KEY);
  if (!raw) throw new Error("No previous saved book available");
  return validateState(JSON.parse(raw));
}

export function downloadSavedBook() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error("No saved book available");
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "dpm-original-recovery.json";
  a.click();
  URL.revokeObjectURL(url);
}
