import type { LegacySequenceMigration } from "./types";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Repair only valid per-type legacy counters; v4 remains strictly unique. */
export function prepareLegacySequences(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const root = input as Record<string, unknown>;
  if (root.version !== undefined && ![1, 2, 3].includes(root.version as number))
    return input;
  const groups = [
    { field: "cashMovements", type: "cash", date: "movementDate", priority: 0 },
    { field: "transactions", type: "trade", date: "tradeDate", priority: 1 },
    {
      field: "corporateActions",
      type: "action",
      date: "actionDate",
      priority: 2,
    },
  ] as const;
  const events: {
    field: (typeof groups)[number]["field"];
    type: (typeof groups)[number]["type"];
    date: string;
    priority: number;
    id: string;
    sequence: number;
    index: number;
  }[] = [];
  const global = new Set<number>();
  let collision = false;
  for (const g of groups) {
    const items = root[g.field];
    if (items === undefined && g.field !== "transactions") continue;
    if (!Array.isArray(items)) return input;
    const local = new Set<number>();
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      if (!r || typeof r !== "object" || Array.isArray(r)) return input;
      const item = r as Record<string, unknown>;
      const seq =
        item.sequence === undefined && g.type === "trade" && root.version !== 3
          ? i + 1
          : item.sequence;
      if (
        typeof seq !== "number" ||
        !Number.isSafeInteger(seq) ||
        seq < 1 ||
        typeof item.id !== "string" ||
        typeof item[g.date] !== "string"
      )
        return input;
      if (local.has(seq))
        throw Error(
          `Legacy ${g.type} sequence must be unique within its ledger`,
        );
      local.add(seq);
      if (global.has(seq)) collision = true;
      global.add(seq);
      events.push({
        field: g.field,
        type: g.type,
        date: (item[g.date] as string).trim(),
        priority: g.priority,
        id: item.id.trim(),
        sequence: seq,
        index: i,
      });
    }
  }
  if (!collision) return input;
  events.sort(
    (a, b) =>
      compare(a.date, b.date) ||
      a.sequence - b.sequence ||
      a.priority - b.priority ||
      compare(a.id, b.id),
  );
  const updated: Record<string, unknown> = { ...root };
  for (const g of groups)
    if (Array.isArray(root[g.field]))
      updated[g.field] = (root[g.field] as Record<string, unknown>[]).map(
        (r) => ({ ...r }),
      );
  const mapping = events.map((e, i) => {
    (updated[e.field] as Record<string, unknown>[])[e.index].sequence = i + 1;
    return {
      type: e.type,
      id: e.id,
      oldSequence: e.sequence,
      newSequence: i + 1,
    };
  });
  const migration: LegacySequenceMigration = {
    sourceVersion: (root.version ?? 1) as 1 | 2 | 3,
    rule: "date/old-sequence/event-priority/stable-id",
    mapping,
  };
  updated.sequenceMigration = migration;
  return updated;
}
