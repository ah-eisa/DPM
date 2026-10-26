import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const target = process.argv[2];
if (!target) throw Error("Pass a local WealthGate checkout path");
const directory = resolve(target, "lib/dpm");
mkdirSync(directory, { recursive: true });
writeFileSync(
  join(directory, "contract.ts"),
  readFileSync(new URL("../lib/portal-contract.ts", import.meta.url), "utf8"),
);
writeFileSync(
  join(directory, "signature.ts"),
  readFileSync(
    new URL("../lib/portal-envelope.ts", import.meta.url),
    "utf8",
  ).replace("./portal-contract.js", "./contract.js"),
);
console.log(
  "Synchronized the public contract and verifier only. No office book or keys copied.",
);
