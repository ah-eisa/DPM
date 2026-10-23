import { AssetClass, CashMovement, Client, CorporateAction, DpmState, Transaction } from "./types";

export const STATE_VERSION = 3;
export const ASSET_CLASSES: AssetClass[] = ["US Equity", "UAE Equity", "ETF", "Bond/Sukuk", "Crypto", "Metal", "Cash", "Other"];
const CASH_KINDS = ["DEPOSIT", "WITHDRAWAL", "DIVIDEND", "COUPON", "INTEREST", "FEE", "TAX", "OTHER"] as const;
const ACTION_KINDS = ["SPLIT", "REVERSE_SPLIT", "STOCK_DIVIDEND"] as const;
const fail = (message: string): never => { throw new Error(message); };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail("Expected a record");
const str = (value: unknown, name: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 500 ? value.trim() : fail(`Invalid ${name}`);
const number = (value: unknown, name: string, min = 0) => typeof value === "number" && Number.isFinite(value) && value >= min ? value : fail(`Invalid ${name}`);
const date = (value: unknown, name: string) => {
  const d = str(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) fail(`Invalid ${name}`);
  return d;
};
const symbol = (value: unknown) => {
  const s = str(value, "symbol").toUpperCase();
  if (!/^[A-Z0-9^][A-Z0-9.^=\-]{0,39}$/.test(s)) fail("Invalid symbol");
  return s;
};

export function currency(value: unknown): string {
  const code = str(value, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || !Intl.supportedValuesOf("currency").includes(code)) fail("Unsupported currency");
  return code;
}

export function orderedTrades(transactions: Transaction[]) {
  return transactions.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || (a.sequence ?? 0) - (b.sequence ?? 0));
}

export type LedgerEvent =
  | { type: "trade"; date: string; sequence: number; item: Transaction }
  | { type: "cash"; date: string; sequence: number; item: CashMovement }
  | { type: "action"; date: string; sequence: number; item: CorporateAction };

const eventPriority = (type: LedgerEvent["type"]) => type === "cash" ? 0 : type === "trade" ? 1 : 2;
export function orderedLedgerEvents(clientId: string, transactions: Transaction[], cashMovements: CashMovement[] = [], corporateActions: CorporateAction[] = []): LedgerEvent[] {
  return [
    ...transactions.filter(t => t.clientId === clientId).map(item => ({ type: "trade" as const, date: item.tradeDate, sequence: item.sequence ?? 0, item })),
    ...cashMovements.filter(c => c.clientId === clientId).map(item => ({ type: "cash" as const, date: item.movementDate, sequence: item.sequence, item })),
    ...corporateActions.filter(a => a.clientId === clientId).map(item => ({ type: "action" as const, date: item.actionDate, sequence: item.sequence, item })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence || eventPriority(a.type) - eventPriority(b.type));
}

function cashDelta(m: CashMovement) {
  const value = m.amount * m.fxRate;
  return ["WITHDRAWAL", "FEE", "TAX"].includes(m.kind) ? -value : value;
}

export function validateLedger(client: Client, transactions: Transaction[], cashMovements: CashMovement[] = [], corporateActions: CorporateAction[] = []) {
  if (!Number.isFinite(client.initialCash) || client.initialCash < 0) fail("Invalid initial cash");
  let cash = client.initialCash;
  const positions = new Map<string, { quantity: number; assetClass: string; currency: string }>();
  for (const event of orderedLedgerEvents(client.id, transactions, cashMovements, corporateActions)) {
    if (event.type === "cash") {
      const delta = cashDelta(event.item);
      if (!Number.isFinite(delta)) fail("Cash movement exceeds supported range");
      cash += delta;
      if (cash < -1e-7) fail(`${client.code}: insufficient cash on ${event.item.movementDate}`);
      continue;
    }
    if (event.type === "action") {
      const action = event.item;
      const p = positions.get(action.symbol);
      if (!p || p.quantity <= 1e-10) fail(`${action.symbol}: corporate action has no open holding on ${action.actionDate}`);
      p.quantity *= action.factor;
      if (!Number.isFinite(p.quantity) || p.quantity <= 0) fail("Corporate action creates invalid position");
      positions.set(action.symbol, p);
      continue;
    }
    const tx = event.item;
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
  if (root.version !== undefined && root.version !== 1 && root.version !== 2 && root.version !== STATE_VERSION) fail("Unsupported backup version");
  if (!Array.isArray(root.clients) || !root.clients.length || !Array.isArray(root.transactions) || !Array.isArray(root.targets)) fail("Invalid DPM backup file");
  const ids = new Set<string>(), codes = new Set<string>();
  const clients = (root.clients as unknown[]).map(item => {
    const r = object(item), id = str(r.id, "client ID"), code = str(r.code, "client code").toUpperCase();
    if (ids.has(id) || codes.has(code)) fail("Duplicate client ID or code");
    ids.add(id); codes.add(code);
    if (!["Conservative", "Balanced", "Growth", "Custom"].includes(String(r.riskProfile))) fail("Invalid risk profile");
    return { id, code, label: str(r.label, "mandate label"), baseCurrency: currency(r.baseCurrency), benchmark: str(r.benchmark, "benchmark"), riskProfile: r.riskProfile as Client["riskProfile"], initialCash: number(r.initialCash, "initial cash") };
  });

  const txIds = new Set<string>(), txSequences = new Set<number>();
  const transactions = (root.transactions as unknown[]).map((item, index) => {
    const r = object(item), id = str(r.id, "transaction ID"), clientId = str(r.clientId, "client ID");
    if (txIds.has(id) || !ids.has(clientId)) fail("Duplicate transaction or unknown client");
    txIds.add(id);
    const sequence = r.sequence === undefined && root.version !== STATE_VERSION ? index + 1 : number(r.sequence, "execution sequence", 1);
    if (!Number.isSafeInteger(sequence) || txSequences.has(sequence)) fail("Execution sequence must be unique");
    txSequences.add(sequence);
    if (r.side !== "BUY" && r.side !== "SELL") fail("Invalid trade side");
    if (!ASSET_CLASSES.includes(r.assetClass as AssetClass) || r.assetClass === "Cash") fail("Invalid trade asset class");
    return { id, clientId, sequence, symbol: symbol(r.symbol), side: r.side, quantity: number(r.quantity, "quantity", Number.MIN_VALUE), price: number(r.price, "price"), fees: number(r.fees, "fees"), fxRate: number(r.fxRate, "FX rate", Number.MIN_VALUE), tradeDate: date(r.tradeDate, "trade date"), assetClass: r.assetClass, ...(r.currency ? { currency: currency(r.currency) } : {}), ...(r.name ? { name: str(r.name, "name") } : {}), ...(r.gtnRef ? { gtnRef: str(r.gtnRef, "GTN reference") } : {}), ...(r.notes ? { notes: str(r.notes, "notes") } : {}) } as Transaction;
  });

  const rawCash = root.cashMovements === undefined && root.version !== STATE_VERSION ? [] : root.cashMovements;
  if (!Array.isArray(rawCash)) fail("Invalid cash movements");
  const cashIds = new Set<string>(), cashSequences = new Set<number>();
  const cashMovements = (rawCash as unknown[]).map(item => {
    const r = object(item), id = str(r.id, "cash movement ID"), clientId = str(r.clientId, "client ID");
    if (cashIds.has(id) || !ids.has(clientId)) fail("Duplicate cash movement or unknown client");
    cashIds.add(id);
    const sequence = number(r.sequence, "cash movement sequence", 1);
    if (!Number.isSafeInteger(sequence) || cashSequences.has(sequence)) fail("Cash movement sequence must be unique");
    cashSequences.add(sequence);
    if (!CASH_KINDS.includes(r.kind as typeof CASH_KINDS[number])) fail("Invalid cash movement kind");
    const ccy = currency(r.currency), fxRate = number(r.fxRate, "FX rate", Number.MIN_VALUE);
    const client = clients.find(c => c.id === clientId)!;
    if (ccy === client.baseCurrency && fxRate !== 1) fail("Same-currency cash movement requires FX rate 1");
    return { id, clientId, sequence, kind: r.kind, amount: number(r.amount, "cash amount", Number.MIN_VALUE), currency: ccy, fxRate, movementDate: date(r.movementDate, "movement date"), ...(r.symbol ? { symbol: symbol(r.symbol) } : {}), ...(r.reference ? { reference: str(r.reference, "reference") } : {}), ...(r.notes ? { notes: str(r.notes, "notes") } : {}) } as CashMovement;
  });

  const rawActions = root.corporateActions === undefined && root.version !== STATE_VERSION ? [] : root.corporateActions;
  if (!Array.isArray(rawActions)) fail("Invalid corporate actions");
  const actionIds = new Set<string>(), actionSequences = new Set<number>();
  const corporateActions = (rawActions as unknown[]).map(item => {
    const r = object(item), id = str(r.id, "corporate action ID"), clientId = str(r.clientId, "client ID");
    if (actionIds.has(id) || !ids.has(clientId)) fail("Duplicate corporate action or unknown client");
    actionIds.add(id);
    const sequence = number(r.sequence, "corporate action sequence", 1);
    if (!Number.isSafeInteger(sequence) || actionSequences.has(sequence)) fail("Corporate action sequence must be unique");
    actionSequences.add(sequence);
    if (!ACTION_KINDS.includes(r.kind as typeof ACTION_KINDS[number])) fail("Invalid corporate action kind");
    return { id, clientId, sequence, kind: r.kind, symbol: symbol(r.symbol), actionDate: date(r.actionDate, "action date"), factor: number(r.factor, "corporate action factor", Number.MIN_VALUE), ...(r.reference ? { reference: str(r.reference, "reference") } : {}), ...(r.notes ? { notes: str(r.notes, "notes") } : {}) } as CorporateAction;
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
    const total = targets.filter(t => t.clientId === client.id).reduce((sum, t) => sum + t.targetPct, 0);
    if (Math.abs(total - 100) > 1e-6) fail(`${client.code}: targets must total 100%`);
    validateLedger(client, transactions, cashMovements, corporateActions);
  }
  return { version: STATE_VERSION, clients, transactions, cashMovements, corporateActions, targets };
}
