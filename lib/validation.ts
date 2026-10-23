import { AssetClass, Client, DpmState, Transaction } from "./types";

export const STATE_VERSION = 2;
export const ASSET_CLASSES: AssetClass[] = ["US Equity", "UAE Equity", "ETF", "Bond/Sukuk", "Crypto", "Metal", "Cash", "Other"];
const fail = (message: string): never => { throw new Error(message); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail("Expected a record");
const str = (value: unknown, name: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 500 ? value.trim() : fail(`Invalid ${name}`);
const number = (value: unknown, name: string, min = 0) => typeof value === "number" && Number.isFinite(value) && value >= min ? value : fail(`Invalid ${name}`);
export function currency(value: unknown): string {
  const code = str(value, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !Intl.supportedValuesOf("currency").includes(code)) fail("Unsupported currency");
  return code;
}
export function orderedTrades(transactions: Transaction[]) {
  return transactions.slice().sort((a,b) => a.tradeDate.localeCompare(b.tradeDate) || (a.sequence ?? 0) - (b.sequence ?? 0));
}
export function validateLedger(client: Client, transactions: Transaction[]) {
  if (!Number.isFinite(client.initialCash) || client.initialCash < 0) fail("Invalid initial cash");
  let cash = client.initialCash;
  const positions = new Map<string, { quantity: number; assetClass: string; currency: string }>();
  for (const tx of orderedTrades(transactions.filter(t => t.clientId === client.id))) {
    if (![tx.quantity, tx.price, tx.fees, tx.fxRate].every(Number.isFinite) || tx.quantity <= 0 || tx.price < 0 || tx.fees < 0 || tx.fxRate <= 0 || !["BUY", "SELL"].includes(tx.side)) fail("Invalid trade numbers or side");
    const quoteCurrency = tx.currency ?? (tx.fxRate === 1 ? client.baseCurrency : "UNKNOWN");
    if (quoteCurrency === client.baseCurrency && tx.fxRate !== 1) fail("Same-currency execution requires FX rate 1");
    const p = positions.get(tx.symbol) ?? { quantity: 0, assetClass: tx.assetClass, currency: quoteCurrency };
    if (p.assetClass !== tx.assetClass || p.currency !== quoteCurrency) fail(`${tx.symbol}: inconsistent asset class or currency`);
    const gross = tx.quantity * tx.price * tx.fxRate;
    if (!Number.isFinite(gross)) fail("Trade value exceeds supported range");
    if (tx.side === "BUY") {
      if (!Number.isFinite((gross + tx.fees) / tx.quantity)) fail("Unit cost exceeds supported range");
      cash -= gross + tx.fees;
      p.quantity += tx.quantity;
      if (cash < -1e-7) fail(`${client.code}: insufficient cash on ${tx.tradeDate}`);
    } else {
      if (tx.quantity > p.quantity + 1e-10) fail(`${tx.symbol}: sale exceeds holdings on ${tx.tradeDate}`);
      p.quantity = Math.max(0, p.quantity - tx.quantity);
      cash += gross - tx.fees;
      if (cash < -1e-7) fail(`${client.code}: insufficient cash for fees`);
    }
    if (!Number.isFinite(cash)) fail("Cash exceeds supported range");
    if (!Number.isFinite(p.quantity)) fail("Position exceeds supported range");
    positions.set(tx.symbol, p);
  }
}
export function validateState(input: unknown): DpmState {
  const root = object(input);
  if (root.version !== undefined && root.version !== 1 && root.version !== STATE_VERSION) fail("Unsupported backup version");
  if (!Array.isArray(root.clients) || !root.clients.length || !Array.isArray(root.transactions) || !Array.isArray(root.targets)) fail("Invalid DPM backup file");
  const ids = new Set<string>(), codes = new Set<string>();
  const clients = (root.clients as unknown[]).map(item => {
    const r = object(item), id = str(r.id, "client ID"), code = str(r.code, "client code").toUpperCase();
    if (ids.has(id) || codes.has(code)) fail("Duplicate client ID or code");
    ids.add(id); codes.add(code);
    if (!["Conservative", "Balanced", "Growth", "Custom"].includes(String(r.riskProfile))) fail("Invalid risk profile");
    return { id, code, label: str(r.label, "mandate label"), baseCurrency: currency(r.baseCurrency), benchmark: str(r.benchmark, "benchmark"), riskProfile: r.riskProfile as Client["riskProfile"], initialCash: number(r.initialCash, "initial cash") };
  });
  const txIds = new Set<string>(), sequences = new Set<number>();
  const transactions = (root.transactions as unknown[]).map((item, index) => {
    const r = object(item), id = str(r.id, "transaction ID"), clientId = str(r.clientId, "client ID");
    if (txIds.has(id) || !ids.has(clientId)) fail("Duplicate transaction or unknown client");
    txIds.add(id);
    const sequence = r.sequence === undefined && root.version !== STATE_VERSION ? index + 1 : number(r.sequence, "execution sequence", 1);
    if (!Number.isSafeInteger(sequence) || sequences.has(sequence)) fail("Execution sequence must be unique");
    sequences.add(sequence);
    const tradeDate = str(r.tradeDate, "trade date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || !Number.isFinite(Date.parse(tradeDate)) || new Date(tradeDate).toISOString().slice(0,10) !== tradeDate) fail("Invalid trade date");
    if (r.side !== "BUY" && r.side !== "SELL") fail("Invalid trade side");
    if (!ASSET_CLASSES.includes(r.assetClass as AssetClass) || r.assetClass === "Cash") fail("Invalid trade asset class");
    const symbol = str(r.symbol, "symbol").toUpperCase();
    if (!/^[A-Z0-9^][A-Z0-9.^=\-]{0,39}$/.test(symbol)) fail("Invalid symbol");
    return { id, clientId, sequence, symbol, side: r.side, quantity: number(r.quantity, "quantity", Number.MIN_VALUE), price: number(r.price, "price"), fees: number(r.fees, "fees"), fxRate: number(r.fxRate, "FX rate", Number.MIN_VALUE), tradeDate, assetClass: r.assetClass, ...(r.currency ? { currency: currency(r.currency) } : {}), ...(r.name ? { name: str(r.name, "name") } : {}), ...(r.gtnRef ? { gtnRef: str(r.gtnRef, "GTN reference") } : {}), ...(r.notes ? { notes: str(r.notes, "notes") } : {}) } as Transaction;
  });
  const targetKeys = new Set<string>();
  const targets = (root.targets as unknown[]).map(item => {
    const r = object(item), clientId = str(r.clientId, "client ID"), assetClass = r.assetClass as AssetClass;
    const key = `${clientId}:${assetClass}`;
    if (!ids.has(clientId) || !ASSET_CLASSES.includes(assetClass) || targetKeys.has(key)) fail("Invalid or duplicate target");
    targetKeys.add(key);
    const targetPct = number(r.targetPct, "target percentage"), minPct = r.minPct == null ? undefined : number(r.minPct, "minimum"), maxPct = r.maxPct == null ? undefined : number(r.maxPct, "maximum");
    if (targetPct > 100 || (minPct != null && minPct > targetPct) || (maxPct != null && (maxPct < targetPct || maxPct > 100))) fail("Require 0 ≤ minimum ≤ target ≤ maximum ≤ 100");
    return { clientId, assetClass, targetPct, minPct, maxPct };
  });
  for (const client of clients) {
    const total = targets.filter(t => t.clientId === client.id).reduce((sum,t) => sum + t.targetPct, 0);
    if (Math.abs(total - 100) > 1e-6) fail(`${client.code}: targets must total 100%`);
    validateLedger(client, transactions);
  }
  return { version: STATE_VERSION, clients, transactions, targets };
}
