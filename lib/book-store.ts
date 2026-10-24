import type { BookChange, DpmState } from "./types";
import { validateState } from "./validation";
const DB = "dpm-book-v4";
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("book");
      r.result.createObjectStore("history", { keyPath: "id" });
      r.result.createObjectStore("meta");
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
      r = book.get("current");
    let saved: DpmState;
    let error: unknown;
    r.onsuccess = () => {
      try {
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
        const after = options.migration
          ? valid
          : { ...valid, revision: revision + 1 };
        if (!Number.isSafeInteger(after.revision))
          throw Error("Book revision limit reached");
        saved = after;
        book.put(after, "current");
        if (r.result !== undefined) meta.put(r.result, "previous");
        if (options.original !== undefined) {
          const original = meta.get("original-v3");
          original.onsuccess = () => {
            if (original.result === undefined)
              meta.put(options.original, "original-v3");
          };
        }
        const change: BookChange = {
          id: crypto.randomUUID(),
          revisionBefore: revision,
          revisionAfter: after.revision ?? 0,
          recordedAt: new Date().toISOString(),
          action:
            options.action ?? (options.migration ? "migration" : "book update"),
          actor: "Local operator (unverified)",
          before: previous,
          after,
        };
        tx.objectStore("history").add(change);
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
