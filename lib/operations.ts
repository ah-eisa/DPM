import { AssetClass, DpmState, Side, Transaction } from "./types";
import { ASSET_CLASSES, validateState } from "./validation";

export function maxLedgerSequence(state: DpmState) {
  return Math.max(0, ...state.transactions.map(t => t.sequence ?? 0), ...state.cashMovements.map(m => m.sequence), ...state.corporateActions.map(a => a.sequence));
}

type MasterExecution = {
  symbol: string; name?: string; assetClass: AssetClass; side: Side; totalQuantity: number; price: number; fees: number;
  currency: string; fxRate: number; tradeDate: string; gtnRef?: string; notes?: string;
};

export function allocateMasterExecution(state: DpmState, master: MasterExecution, allocations: { clientId: string; quantity: number }[]): Transaction[] {
  if (!allocations.length) throw new Error("Add at least one client allocation");
  if (!Number.isFinite(master.totalQuantity) || master.totalQuantity <= 0) throw new Error("Master quantity must be positive");
  if (!Number.isFinite(master.price) || master.price < 0 || !Number.isFinite(master.fees) || master.fees < 0 || !Number.isFinite(master.fxRate) || master.fxRate <= 0) throw new Error("Invalid master execution numbers");
  const total = allocations.reduce((sum, a) => sum + a.quantity, 0);
  if (allocations.some(a => !Number.isFinite(a.quantity) || a.quantity <= 0)) throw new Error("Allocation quantities must be positive");
  if (Math.abs(total - master.totalQuantity) > Math.max(1e-8, master.totalQuantity * 1e-8)) throw new Error(`Allocated quantity ${total} must equal master quantity ${master.totalQuantity}`);
  const clients = new Map(state.clients.map(c => [c.id, c]));
  if (allocations.some(a => !clients.has(a.clientId))) throw new Error("Unknown client in allocation");
  if (new Set(allocations.map(a => a.clientId)).size !== allocations.length) throw new Error("Each client may appear only once in a master allocation");
  const bases = new Set(allocations.map(a => clients.get(a.clientId)!.baseCurrency));
  if (bases.size !== 1) throw new Error("One master allocation currently requires all selected clients to share the same base currency");
  const base = [...bases][0];
  if (master.currency.toUpperCase() === base && master.fxRate !== 1) throw new Error("Same-currency master execution requires FX rate 1");

  const start = maxLedgerSequence(state) + 1;
  const stamp = Date.now().toString(36);
  const transactions = allocations.map((a, index): Transaction => ({
    id: `bulk_${stamp}_${index + 1}`, sequence: start + index, clientId: a.clientId,
    symbol: master.symbol.trim().toUpperCase(), name: master.name?.trim() || undefined, assetClass: master.assetClass, side: master.side,
    quantity: a.quantity, price: master.price, fees: master.fees * (a.quantity / master.totalQuantity), currency: master.currency.toUpperCase(),
    fxRate: master.fxRate, tradeDate: master.tradeDate, gtnRef: master.gtnRef ? `${master.gtnRef}-${index + 1}` : undefined, notes: master.notes,
  }));
  validateState({ ...state, transactions: [...state.transactions, ...transactions] });
  return transactions;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell.trim()); cell = ""; if (row.some(Boolean)) rows.push(row); row = []; }
    else cell += ch;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases = {
  client: ["client", "clientcode", "account", "accountcode", "portfolio", "portfoliocode"], side: ["side", "buysell", "action"],
  symbol: ["symbol", "ticker", "security", "instrument"], quantity: ["quantity", "qty", "units", "shares"], price: ["price", "executionprice", "tradeprice"],
  fees: ["fees", "fee", "commission", "charges"], currency: ["currency", "ccy", "tradecurrency"], fxRate: ["fxrate", "fx", "exchangerate"],
  tradeDate: ["tradedate", "date", "executiondate"], gtnRef: ["gtnref", "traderef", "reference", "orderref", "executionref"],
  assetClass: ["assetclass", "class", "assettype"], name: ["name", "securityname", "instrumentname"],
} as const;
type CsvField = keyof typeof aliases;
function headerIndex(headers: string[], field: CsvField) { const wanted = new Set<string>(aliases[field]); return headers.findIndex(h => wanted.has(norm(h))); }
function parseNumber(value: string | undefined, label: string, fallback?: number) {
  if (value == null || value === "") { if (fallback !== undefined && Number.isFinite(fallback)) return fallback; throw new Error(`Missing ${label}`); }
  const n = Number(value.replace(/,/g, "")); if (!Number.isFinite(n)) throw new Error(`Invalid ${label}`); return n;
}
function parseAssetClass(value: string | undefined): AssetClass {
  if (!value) return "Other";
  const exact = ASSET_CLASSES.find(a => norm(a) === norm(value)); if (exact) return exact;
  const map: Record<string, AssetClass> = { equity:"US Equity",stock:"US Equity",equities:"US Equity",uaequity:"UAE Equity",sukuk:"Bond/Sukuk",bond:"Bond/Sukuk",fixedincome:"Bond/Sukuk",cryptocurrency:"Crypto",digitalasset:"Crypto",gold:"Metal",commodity:"Metal" };
  return map[norm(value)] ?? "Other";
}

export function importGtnCsv(text: string, state: DpmState): Transaction[] {
  if (text.length > 5 * 1024 * 1024) throw new Error("CSV exceeds 5 MB");
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one trade");
  const headers = rows[0];
  const idx = Object.fromEntries(Object.keys(aliases).map(k => [k, headerIndex(headers, k as CsvField)])) as Record<CsvField, number>;
  for (const required of ["client", "side", "symbol", "quantity", "price", "tradeDate"] as const) if (idx[required] < 0) throw new Error(`GTN CSV is missing ${required} column`);
  const clients = new Map(state.clients.map(c => [c.code.toUpperCase(), c]));
  const existingRefs = new Set(state.transactions.map(t => t.gtnRef).filter((x): x is string => !!x));
  let sequence = maxLedgerSequence(state); const stamp = Date.now().toString(36); const transactions: Transaction[] = [];

  rows.slice(1).forEach((row, rowIndex) => {
    const get = (key: CsvField) => idx[key] >= 0 ? row[idx[key]]?.trim() : undefined;
    const clientCode = (get("client") ?? "").toUpperCase(); const client = clients.get(clientCode);
    if (!client) throw new Error(`Row ${rowIndex + 2}: unknown client ${clientCode || "(blank)"}`);
    const rawSide = (get("side") ?? "").toUpperCase();
    const side: Side = rawSide === "B" || rawSide === "BUY" ? "BUY" : rawSide === "S" || rawSide === "SELL" ? "SELL" : (() => { throw new Error(`Row ${rowIndex + 2}: invalid side`); })();
    const ccy = (get("currency") || client.baseCurrency).toUpperCase();
    const fxRaw = get("fxRate");
    const fxRate = fxRaw ? parseNumber(fxRaw, `FX rate on row ${rowIndex + 2}`) : ccy === client.baseCurrency ? 1 : (() => { throw new Error(`Row ${rowIndex + 2}: foreign-currency trade requires FX rate`); })();
    const gtnRef = get("gtnRef") || undefined;
    if (gtnRef && existingRefs.has(gtnRef)) throw new Error(`Row ${rowIndex + 2}: duplicate GTN reference ${gtnRef}`);
    if (gtnRef) existingRefs.add(gtnRef);
    transactions.push({
      id:`gtn_${stamp}_${rowIndex+1}`,sequence:++sequence,clientId:client.id,symbol:(get("symbol")??"").toUpperCase(),name:get("name")||undefined,
      assetClass:parseAssetClass(get("assetClass")),side,quantity:parseNumber(get("quantity"),`quantity on row ${rowIndex+2}`),price:parseNumber(get("price"),`price on row ${rowIndex+2}`),
      fees:parseNumber(get("fees"),`fees on row ${rowIndex+2}`,0),currency:ccy,fxRate,tradeDate:get("tradeDate")??"",gtnRef,notes:"Imported from GTN CSV",
    });
  });
  validateState({ ...state, transactions: [...state.transactions, ...transactions] }); return transactions;
}
