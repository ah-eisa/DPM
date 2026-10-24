import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore, IDBCursor } from "fake-indexeddb";
import { validateState } from "../lib/validation";
import { previewMigration } from "../lib/migration";
import { importState, loadState, seedState } from "../lib/storage";
import {
  bookHistory,
  readBookMeta,
  readRawBook,
  transactBook,
  pruneBookHistory,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_BYTES,
} from "../lib/book-store";
import { decryptState } from "../lib/resilience";
import type { DpmState } from "../lib/types";
const legacy = () => ({
  version: 3,
  clients: [
    {
      id: "c",
      code: "C",
      label: "Legacy",
      baseCurrency: "USD",
      benchmark: "SPY",
      riskProfile: "Balanced",
      initialCash: 0,
    },
  ],
  transactions: [
    {
      id: "buy",
      clientId: "c",
      sequence: 1,
      symbol: "X",
      currency: "USD",
      assetClass: "ETF",
      side: "BUY",
      quantity: 10,
      price: 100,
      fees: 0,
      fxRate: 1,
      tradeDate: "2026-01-02",
    },
  ],
  cashMovements: [
    {
      id: "fund",
      clientId: "c",
      sequence: 1,
      kind: "DEPOSIT",
      amount: 1000,
      currency: "USD",
      fxRate: 1,
      movementDate: "2026-01-02",
    },
  ],
  corporateActions: [
    {
      id: "split",
      clientId: "c",
      sequence: 1,
      kind: "SPLIT",
      symbol: "X",
      factor: 2,
      actionDate: "2026-01-02",
    },
  ],
  targets: [{ clientId: "c", assetClass: "Cash", targetPct: 100 }],
});
let local: Map<string, string>;
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", {});
  local = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => local.set(k, v),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("legacy sequence collisions", () => {
  it("resequences funding, trade and split deterministically before validation", () => {
    const raw = legacy(),
      original = JSON.stringify(raw);
    const a = previewMigration(raw),
      b = previewMigration(raw);
    expect(a).toEqual(b);
    expect(JSON.stringify(raw)).toBe(original);
    expect(a.candidate.sequenceMigration?.mapping).toEqual([
      { type: "cash", id: "fund", oldSequence: 1, newSequence: 1 },
      { type: "trade", id: "buy", oldSequence: 1, newSequence: 2 },
      { type: "action", id: "split", oldSequence: 1, newSequence: 3 },
    ]);
    expect(a.comparisons).toMatchObject([
      { cash: 0, costBasis: 1000, holdings: 1, totalPnl: 0 },
    ]);
    expect(validateState(JSON.parse(JSON.stringify(a.candidate)))).toEqual(
      a.candidate,
    );
  });
  it("sorts date before the old sequence and preserves all economic fields", () => {
    const raw = legacy();
    raw.cashMovements.push({
      ...raw.cashMovements[0],
      id: "early",
      sequence: 2,
      amount: 100,
      movementDate: "2026-01-01",
    });
    const s = validateState(raw);
    expect(s.sequenceMigration?.mapping.map((m) => m.id)).toEqual([
      "early",
      "fund",
      "buy",
      "split",
    ]);
    expect(s.transactions[0]).toMatchObject({
      ...raw.transactions[0],
      sequence: 3,
    });
    expect(s.cashMovements.find((c) => c.id === "early")?.sequence).toBe(1);
  });
  it("does not resequence a collision-free legacy book", () => {
    const s = validateState(seedState);
    expect(s.sequenceMigration).toBeUndefined();
    expect(s.transactions.map((t) => t.sequence)).toEqual(
      seedState.transactions.map((t) => t.sequence),
    );
  });
  it("keeps v4 uniqueness strict and does not repair invalid within-type counters", () => {
    const s = validateState(legacy());
    s.transactions[0].sequence = s.cashMovements[0].sequence;
    expect(() => validateState(s)).toThrow(/globally unique/);
    const raw = legacy();
    raw.transactions.push({ ...raw.transactions[0], id: "another" });
    expect(() => validateState(raw)).toThrow(/Legacy trade sequence/);
  });
  it("preserves deterministic mapping regardless of input array order", () => {
    const raw = legacy();
    raw.transactions.push({
      ...raw.transactions[0],
      id: "later",
      sequence: 2,
      side: "SELL",
      quantity: 1,
      tradeDate: "2026-01-03",
    });
    const one = validateState(raw);
    raw.transactions.reverse();
    expect(validateState(raw).sequenceMigration).toEqual(one.sequenceMigration);
  });
  it("migrates legacy imports and encrypted legacy envelopes too", async () => {
    const raw = JSON.stringify(legacy()),
      s = await importState({
        size: raw.length,
        text: async () => raw,
      } as File);
    expect(s.sequenceMigration?.mapping).toHaveLength(3);
    const key = new Uint8Array(32).fill(9),
      iv = new Uint8Array(12).fill(1),
      cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
        "encrypt",
      ]),
      encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        new TextEncoder().encode(raw),
      );
    const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    expect(
      await decryptState(
        {
          type: "dpm-desk-encrypted-backup",
          version: 1,
          algorithm: "AES-GCM",
          iv: b64(iv),
          ciphertext: b64(new Uint8Array(encrypted)),
          createdAt: "2026-01-03T00:00:00Z",
        },
        key,
      ),
    ).toEqual(s);
  });
  it("stores the untouched original and the mapping in the migration change event", async () => {
    const raw = JSON.stringify(legacy());
    local.set("dpm-desk-state-v1", raw);
    const saved = await loadState();
    expect(await readBookMeta("original-v3")).toBe(raw);
    expect(local.get("dpm-desk-state-v1")).toBe(raw);
    expect((await bookHistory())[0].after.sequenceMigration).toEqual(
      saved.sequenceMigration,
    );
  });
  it("rolls back failed migration without saving a repaired partial book", async () => {
    const raw = JSON.stringify(legacy());
    local.set("dpm-desk-state-v1", raw);
    const original = IDBObjectStore.prototype.add;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "add")
      .mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore["add"]>
      ) {
        if (this.name === "history") throw Error("Migration quota failure");
        return original.apply(this, args);
      });
    await expect(loadState()).rejects.toThrow(/not been overwritten/);
    expect(await readRawBook()).toBeUndefined();
    expect(await readBookMeta("original-v3")).toBeUndefined();
    expect(local.get("dpm-desk-state-v1")).toBe(raw);
    spy.mockRestore();
    expect((await loadState()).sequenceMigration?.mapping).toHaveLength(3);
  });
});
describe("bounded atomic history", () => {
  async function write(s: DpmState) {
    return transactBook(
      {
        ...s,
        clients: s.clients.map((c) => ({
          ...c,
          label: `Revision ${(s.revision ?? 0) + 1}`,
        })),
      },
      s.revision ?? 0,
    );
  }
  it("retains the newest 100 entries while preserving current/previous book", async () => {
    let s = await loadState();
    for (let i = 0; i < 105; i++) s = await write(s);
    const history = await bookHistory();
    expect(history).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(history[0].revisionAfter).toBe(105);
    expect(history.at(-1)?.revisionAfter).toBe(6);
    expect(await loadState()).toEqual(s);
    expect(((await readBookMeta("previous")) as DpmState).revision).toBe(104);
    expect(await readBookMeta("history-retention")).toMatchObject({
      prunedCount: 6,
      retainedCount: 100,
    });
  });
  it("also enforces the byte budget for large books", async () => {
    let s = await loadState();
    s = {
      ...s,
      controls: {
        ...s.controls!,
        securities: [
          ...s.controls!.securities,
          ...Array.from({ length: 4500 }, (_, i) => ({
            id: `extra-${i}`,
            symbol: `XX${i}`,
            name: "N".repeat(450),
            exchange: "TEST",
            currency: "USD",
            assetClass: "Other" as const,
            priceMultiplier: 1,
            shariaStatus: "unknown" as const,
          })),
        ],
      },
    };
    for (let i = 0; i < 5; i++) s = await write(s);
    const history = await bookHistory();
    expect(history.length).toBeLessThan(5);
    expect(history[0].revisionAfter).toBe(5);
    const metadata = (await readBookMeta("history-retention")) as {
      retainedBytes: number;
    };
    expect(metadata.retainedBytes).toBeLessThanOrEqual(HISTORY_MAX_BYTES);
    expect(
      new TextEncoder().encode(JSON.stringify(history)).length,
    ).toBeLessThan(HISTORY_MAX_BYTES);
    expect(await loadState()).toEqual(s);
  }, 20000);
  it("exports a snapshot before manual pruning and leaves the book unchanged", async () => {
    let s = await loadState();
    s = await write(s);
    s = await write(s);
    const exported = await bookHistory();
    expect(exported).toHaveLength(3);
    const result = await pruneBookHistory(exported[0].revisionAfter);
    expect(result).toMatchObject({ removed: 2, kept: 1 });
    expect(await loadState()).toEqual(s);
    expect(await bookHistory()).toEqual([exported[0]]);
  });
  it("rejects pruning when a write follows the exported revision", async () => {
    let s = await loadState();
    const exported = await bookHistory();
    s = await write(s);
    const history = await bookHistory();
    await expect(pruneBookHistory(exported[0].revisionAfter)).rejects.toThrow(
      /changed after history export/,
    );
    expect(await bookHistory()).toEqual(history);
    expect(await loadState()).toEqual(s);
  });
  it("restores pruned rows if the new change event fails", async () => {
    let s = await loadState();
    for (let i = 0; i < 99; i++) s = await write(s);
    const history = await bookHistory();
    const original = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["add"]>
    ) {
      if (this.name === "history") throw Error("Simulated quota failure");
      return original.apply(this, args);
    });
    await expect(write(s)).rejects.toThrow(/quota/);
    expect(await bookHistory()).toEqual(history);
    expect(await loadState()).toEqual(s);
  });
  it("rolls back a failed manual pruning transaction", async () => {
    let s = await loadState();
    s = await write(s);
    const history = await bookHistory();
    vi.spyOn(IDBCursor.prototype, "delete").mockImplementation(() => {
      throw Error("Simulated deletion failure");
    });
    await expect(pruneBookHistory(s.revision!)).rejects.toThrow(
      /deletion failure/,
    );
    expect(await bookHistory()).toEqual(history);
    expect(await loadState()).toEqual(s);
  });
  it("upgrades existing v1 IDB history without requiring prior size metadata", async () => {
    const s = validateState(seedState);
    s.revision = 7;
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("dpm-book-v4", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("book");
        r.result.createObjectStore("meta");
        r.result.createObjectStore("history", { keyPath: "id" });
      };
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction(["book", "history"], "readwrite");
        tx.objectStore("book").put(s, "current");
        tx.objectStore("history").add({
          id: "legacy",
          revisionBefore: 6,
          revisionAfter: 7,
          recordedAt: "2026-01-01T00:00:00.000Z",
          action: "book update",
          actor: "Local operator (unverified)",
          before: s,
          after: s,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
    expect((await loadState()).revision).toBe(7);
    await write(s);
    expect(await bookHistory()).toHaveLength(2);
    expect(
      ((await readBookMeta("history-retention")) as { retainedBytes: number })
        .retainedBytes,
    ).toBeGreaterThan(0);
  });
});

describe("history ordering during recovery", () => {
  async function mutatePrimary(value: unknown) {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("dpm-book-v4", 2);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("book", "readwrite");
        if (value === undefined) tx.objectStore("book").delete("current");
        else tx.objectStore("book").put(value, "current");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
  }
  it("continues beyond retained revisions after recovering a corrupt primary", async () => {
    let s = await loadState();
    s = await transactBook(s, 0);
    await mutatePrimary({ broken: true });
    const restored = await transactBook(validateState(seedState), 0, {
      recovery: true,
    });
    expect(restored.revision).toBe(2);
    expect((await bookHistory())[0].revisionAfter).toBe(2);
    expect(await loadState()).toEqual(restored);
  });
  it("does not silently re-migrate a missing primary over existing history", async () => {
    let s = await loadState();
    s = await transactBook(s, 0);
    await mutatePrimary(undefined);
    await expect(loadState()).rejects.toThrow(/Primary book is missing/);
    expect(await readRawBook()).toBeUndefined();
    const restored = await transactBook(validateState(seedState), 0, {
      recovery: true,
    });
    expect(restored.revision).toBe(2);
    expect((await bookHistory())[0].revisionAfter).toBe(2);
  });
});
