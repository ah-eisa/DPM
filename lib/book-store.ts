import type { BookChange, DpmState } from "./types";
import { validateState } from "./validation";
const DB = "dpm-book-v4";
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("book"))
        r.result.createObjectStore("book");
      if (!r.result.objectStoreNames.contains("history"))
        r.result.createObjectStore("history", { keyPath: "id" });
      if (!r.result.objectStoreNames.contains("meta"))
        r.result.createObjectStore("meta");
      const history = r.transaction!.objectStore("history");
      if (!history.indexNames.contains("byRevision"))
        history.createIndex("byRevision", "revisionAfter");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(Error("Close older DPM tabs before upgrading storage"));
  });
}
export async function readRawBook() {
  const db = await open();
  return new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction("book", "readonly"),
      r = tx.objectStore("book").get("current");
    let value: unknown;
    r.onsuccess = () => {
      value = r.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function readBookMeta(key: string) {
  const db = await open();
  return new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction("meta", "readonly"),
      r = tx.objectStore("meta").get(key);
    let value: unknown;
    r.onsuccess = () => {
      value = r.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function bookHistory(): Promise<BookChange[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("history", "readonly"),
      r = tx.objectStore("history").getAll();
    tx.oncomplete = () => {
      db.close();
      resolve(
        (r.result as BookChange[]).sort(
          (a, b) =>
            b.revisionAfter - a.revisionAfter ||
            b.recordedAt.localeCompare(a.recordedAt),
        ),
      );
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function transactBook(
  candidate: DpmState,
  expected: number,
  options: {
    migration?: boolean;
    original?: string | null;
    recovery?: boolean;
    action?: string;
  } = {},
): Promise<DpmState> {
  const valid = validateState(candidate),
    db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["book", "history", "meta"], "readwrite"),
      book = tx.objectStore("book"),
      meta = tx.objectStore("meta"),
      latest = tx
        .objectStore("history")
        .index("byRevision")
        .openKeyCursor(null, "prev"),
      r = book.get("current");
    let latestRevision = 0,
      hasHistory = false;
    latest.onsuccess = () => {
      hasHistory = !!latest.result;
      latestRevision = Number(latest.result?.key ?? 0);
    };
    let saved: DpmState;
    let error: unknown;
    r.onsuccess = () => {
      try {
        if (r.result === undefined && hasHistory && !options.recovery)
          throw Error(
            "Primary book is missing but history remains. Restore a validated backup in recovery mode.",
          );
        if (options.migration && r.result !== undefined) {
          saved = validateState(r.result);
          return;
        }
        let previous: DpmState | null = null;
        if (r.result !== undefined) {
          try {
            previous = validateState(r.result);
          } catch (e) {
            if (!options.recovery) throw e;
          }
        }
        const revision = previous?.revision ?? 0;
        if (revision !== expected)
          throw Error(
            "This book changed in another tab. Reload before retrying; your changes have not been saved.",
          );
        const nextRevision = Math.max(revision, latestRevision) + 1;
        const after = options.migration
          ? valid
          : { ...valid, revision: nextRevision };
        if (!Number.isSafeInteger(after.revision))
          throw Error("Book revision limit reached");
        saved = after;
        const change: BookChange & { sizeBytes?: number } = {
          id: crypto.randomUUID(),
          revisionBefore: previous ? revision : latestRevision,
          revisionAfter: after.revision ?? 0,
          recordedAt: new Date().toISOString(),
          action:
            options.action ?? (options.migration ? "migration" : "book update"),
          actor: "Local operator (unverified)",
          before: previous,
          after,
        };
        change.sizeBytes = encodedSize(change);
        if (change.sizeBytes > HISTORY_MAX_BYTES)
          throw Error("Change event exceeds the local history byte budget");
        retainHistory(
          tx.objectStore("history"),
          HISTORY_MAX_ENTRIES - 1,
          HISTORY_MAX_BYTES - change.sizeBytes,
          (summary) => {
            recordRetention(meta, {
              ...summary,
              kept: summary.kept + 1,
              bytes: summary.bytes + change.sizeBytes!,
            });
            book.put(after, "current");
            if (r.result !== undefined) meta.put(r.result, "previous");
            if (options.original !== undefined) {
              const original = meta.get("original-v3");
              original.onsuccess = () => {
                if (original.result === undefined)
                  meta.put(options.original, "original-v3");
              };
            }
            tx.objectStore("history").add(change);
          },
          (e) => {
            error = e;
            tx.abort();
          },
        );
      } catch (e) {
        error = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(saved);
    };
    tx.onabort = () => {
      db.close();
      reject(
        error ??
          tx.error ??
          Error("Book transaction failed; no changes committed"),
      );
    };
    tx.onerror = () => {
      error ??= tx.error;
    };
  });
}

export const HISTORY_MAX_ENTRIES = 100;
export const HISTORY_MAX_BYTES = 20 * 1024 * 1024;
export type HistoryRetention = {
  removed: number;
  kept: number;
  bytes: number;
  throughRevision: number;
};
const encodedSize = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length + 64;
function retainHistory(
  store: IDBObjectStore,
  maxEntries: number,
  maxBytes: number,
  done: (s: HistoryRetention) => void,
  fail: (e: unknown) => void,
) {
  const summary: HistoryRetention = {
    removed: 0,
    kept: 0,
    bytes: 0,
    throughRevision: 0,
  };
  let exhausted = false;
  const cursor = store.index("byRevision").openCursor(null, "prev");
  cursor.onsuccess = () => {
    try {
      const c = cursor.result;
      if (!c) {
        done(summary);
        return;
      }
      const value = c.value as BookChange & { sizeBytes?: number };
      const size =
        Number.isSafeInteger(value.sizeBytes) && value.sizeBytes! > 0
          ? value.sizeBytes!
          : encodedSize(value);
      if (
        exhausted ||
        summary.kept >= maxEntries ||
        summary.bytes + size > maxBytes
      ) {
        exhausted = true;
        c.delete();
        summary.removed++;
        summary.throughRevision = Math.max(
          summary.throughRevision,
          value.revisionAfter,
        );
      } else {
        summary.kept++;
        summary.bytes += size;
      }
      c.continue();
    } catch (e) {
      fail(e);
    }
  };
}
function recordRetention(meta: IDBObjectStore, summary: HistoryRetention) {
  const r = meta.get("history-retention");
  r.onsuccess = () => {
    const old = r.result as
      | { prunedCount?: number; prunedThroughRevision?: number }
      | undefined;
    meta.put(
      {
        maxEntries: HISTORY_MAX_ENTRIES,
        maxBytes: HISTORY_MAX_BYTES,
        retainedCount: summary.kept,
        retainedBytes: summary.bytes,
        prunedCount: (old?.prunedCount ?? 0) + summary.removed,
        prunedThroughRevision: Math.max(
          old?.prunedThroughRevision ?? 0,
          summary.throughRevision,
        ),
        updatedAt: new Date().toISOString(),
      },
      "history-retention",
    );
  };
}
/** Caller must export a fresh history snapshot first; the revision lease prevents pruning unseen writes. */
export async function pruneBookHistory(
  expectedRevision: number,
): Promise<HistoryRetention> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["book", "history", "meta"], "readwrite"),
      r = tx.objectStore("book").get("current");
    let result: HistoryRetention;
    let error: unknown;
    const fail = (e: unknown) => {
      error = e;
      tx.abort();
    };
    r.onsuccess = () => {
      try {
        if (validateState(r.result).revision !== expectedRevision)
          throw Error(
            "Book changed after history export. Export again before pruning.",
          );
        retainHistory(
          tx.objectStore("history"),
          1,
          HISTORY_MAX_BYTES,
          (s) => {
            result = s;
            recordRetention(tx.objectStore("meta"), s);
          },
          fail,
        );
      } catch (e) {
        fail(e);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = () => {
      db.close();
      reject(
        error ??
          tx.error ??
          Error("History pruning failed; no changes committed"),
      );
    };
  });
}
