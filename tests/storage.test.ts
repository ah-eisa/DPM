import { previewMigration } from "../lib/migration";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  loadState,
  saveState,
  recoverState,
  importState,
  seedState,
} from "../lib/storage";
import { bookHistory, readBookMeta } from "../lib/book-store";
let data: Map<string, string>;
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("window", {});
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("migrates v3 atomically without modifying its original", async () => {
  const original = JSON.stringify({ ...seedState, version: 3 });
  data.set("dpm-desk-state-v1", original);
  const s = await loadState();
  expect(s.version).toBe(4);
  expect(s.controls?.accounts).toHaveLength(2);
  expect(await readBookMeta("original-v3")).toBe(original);
  expect(data.get("dpm-desk-state-v1")).toBe(original);
  expect(await bookHistory()).toHaveLength(1);
});
it("does not overwrite corrupt legacy data", async () => {
  data.set("dpm-desk-state-v1", "broken");
  await expect(loadState()).rejects.toThrow(/not been overwritten/);
  expect(data.get("dpm-desk-state-v1")).toBe("broken");
});
it("rejects stale-tab writes and commits book/history together", async () => {
  const a = await loadState(),
    b = await loadState();
  const saved = await saveState({
    ...a,
    clients: a.clients.map((c) => ({ ...c, label: "Accepted" })),
  });
  await expect(saveState(b)).rejects.toThrow(/another tab/);
  expect((await loadState()).clients[0].label).toBe("Accepted");
  const history = await bookHistory();
  expect(history).toHaveLength(2);
  expect(history[0].after).toEqual(saved);
  expect(history[0].before).toEqual(a);
});
it("serializes simultaneous writers without Web Locks", async () => {
  const a = await loadState();
  const results = await Promise.allSettled([saveState(a), saveState(a)]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect((await loadState()).revision).toBe(1);
});
it("keeps previous revision recoverable", async () => {
  const a = await loadState();
  await saveState({
    ...a,
    clients: a.clients.map((c) => ({ ...c, label: "New" })),
  });
  expect(await recoverState()).toEqual(a);
});
it("rejects invalid changes without a history event", async () => {
  const a = await loadState();
  await expect(saveState({ ...a, targets: [] })).rejects.toThrow();
  expect(await loadState()).toEqual(a);
  expect(await bookHistory()).toHaveLength(1);
});
it("explicitly recovers a corrupt legacy book preserving original", async () => {
  data.set("dpm-desk-state-v1", "broken");
  await saveState(seedState, { expectedRevision: 0, recovery: true });
  expect(await readBookMeta("original-v3")).toBe("broken");
  expect((await loadState()).revision).toBe(1);
});
it("rejects oversized and invalid backup files", async () => {
  await expect(importState({ size: 6000000 } as File)).rejects.toThrow(/5 MB/);
  await expect(
    importState({ size: 1, text: async () => "{}" } as File),
  ).rejects.toThrow();
});

it("rolls back the book if its history write fails", async () => {
  const a = await loadState();
  const original = IDBObjectStore.prototype.add;
  vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore["add"]>
  ) {
    if (this.name === "history") throw Error("Simulated quota failure");
    return original.apply(this, args);
  });
  await expect(
    saveState({
      ...a,
      clients: a.clients.map((c) => ({ ...c, label: "Must not persist" })),
    }),
  ).rejects.toThrow(/quota/);
  expect(await loadState()).toEqual(a);
  expect(await bookHistory()).toHaveLength(1);
});
it("serializes two first-load migrations into one event", async () => {
  const [a, b] = await Promise.all([loadState(), loadState()]);
  expect(a).toEqual(b);
  expect(await bookHistory()).toHaveLength(1);
});

it("offers a deterministic migration preview without saving", async () => {
  const one = previewMigration(seedState),
    two = previewMigration(seedState);
  expect(one).toEqual(two);
  expect(one.comparisons).toHaveLength(2);
  expect(await readBookMeta("original-v3")).toBeUndefined();
});
