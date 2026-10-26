import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  signPublication,
  publicationDigest,
} from "../dist-publisher/portal-envelope.js";
import {
  validatePortalSnapshot,
  validatePublication,
} from "../dist-publisher/portal-contract.js";

const [command, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(
  rest
    .map((v, i) => (v.startsWith("--") ? [v.slice(2), rest[i + 1]] : null))
    .filter(Boolean),
);
const required = (name) => {
  if (!args[name]) throw Error(`--${name} is required`);
  return args[name];
};
try {
  if (command === "keygen") {
    const dir = resolve(required("dir"));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (
      existsSync(join(dir, "private.pem")) ||
      existsSync(join(dir, "public.pem"))
    )
      throw Error("Key files already exist; use a new directory to rotate");
    const keys = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    writeFileSync(join(dir, "private.pem"), keys.privateKey, {
      flag: "wx",
      mode: 0o600,
    });
    writeFileSync(join(dir, "public.pem"), keys.publicKey, {
      flag: "wx",
      mode: 0o644,
    });
    console.log(
      "Created signing keys. Keep private.pem in the trusted publishing environment only.",
    );
  } else if (command === "sign") {
    const payload = validatePortalSnapshot(
      JSON.parse(readFileSync(required("in"), "utf8")),
    );
    const metadata = {
      sourceId: required("source"),
      streamId: required("stream"),
      keyId: required("key-id"),
    };
    const outbox = resolve(required("outbox"));
    mkdirSync(outbox, { recursive: true, mode: 0o700 });
    const scope = createHash("sha256")
      .update(
        JSON.stringify([
          metadata.sourceId,
          metadata.streamId,
          payload.accountId,
        ]),
      )
      .digest("hex");
    const dir = join(outbox, scope);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const lock = join(dir, ".lock");
    mkdirSync(lock); // Fail closed on a concurrent signer or an unresolved crash.
    try {
      const previous = readdirSync(dir)
        .filter((f) => /^\d+\.json$/.test(f))
        .map((f) =>
          validatePublication(JSON.parse(readFileSync(join(dir, f), "utf8"))),
        );
      const existing = previous.find(
        (x) => x.payload.snapshotId === payload.snapshotId,
      );
      if (existing && existing.contentDigest !== publicationDigest(payload))
        throw Error("Snapshot ID already signed with a different digest");
      const envelope =
        existing ??
        signPublication(
          payload,
          {
            ...metadata,
            publicationSequence:
              Math.max(0, ...previous.map((x) => x.publicationSequence)) + 1,
          },
          readFileSync(required("key"), "utf8"),
        );
      const content = JSON.stringify(envelope, null, 2);
      if (!existing) {
        const pending = join(dir, "pending.json");
        writeFileSync(pending, content, { mode: 0o600 });
        renameSync(pending, join(dir, `${envelope.publicationSequence}.json`));
      }
      writeFileSync(required("out"), content, { mode: 0o600 });
      console.log(
        JSON.stringify({
          snapshotId: payload.snapshotId,
          publicationSequence: envelope.publicationSequence,
          digest: envelope.contentDigest,
          reused: !!existing,
        }),
      );
    } finally {
      rmdirSync(lock);
    }
  } else if (command === "send") {
    const envelope = validatePublication(
      JSON.parse(readFileSync(required("in"), "utf8")),
    );
    const url = new URL(required("url"));
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw Error("HTTPS required outside loopback");
    const token = process.env.DPM_PUBLISH_TOKEN;
    if (!token || token.length < 32)
      throw Error("DPM_PUBLISH_TOKEN must be at least 32 characters");
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(30000),
    });
    const receipt = await response.json();
    if (!response.ok)
      throw Error(
        `Publish failed (${response.status}): ${receipt.error?.message ?? "request rejected"}`,
      );
    console.log(JSON.stringify(receipt));
  } else
    throw Error(
      "Commands: keygen --dir <secure-dir>; sign --in snapshot.json --out envelope.json --source <id> --stream <id> --key-id <id> --key private.pem --outbox <dir>; send --in envelope.json --url <ingest-url>",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
