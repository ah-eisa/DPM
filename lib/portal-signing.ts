import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import type { ClientPortalSnapshotV1 } from "./client-portal";

export type SignedClientPortalSnapshotV1 = {
  schema: "dpm.client-portal.envelope";
  version: "1.0";
  algorithm: "Ed25519";
  keyId: string;
  contentDigest: string;
  payload: ClientPortalSnapshotV1;
  signature: string;
};

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sorted(item)]),
  );
}

export function canonicalPortalJson(value: unknown) {
  return JSON.stringify(sorted(value));
}

function payloadBytes(payload: ClientPortalSnapshotV1) {
  return Buffer.from(canonicalPortalJson(payload), "utf8");
}

function digest(payload: ClientPortalSnapshotV1) {
  return `sha256:${createHash("sha256").update(payloadBytes(payload)).digest("hex")}`;
}

export function signClientPortalSnapshot(
  payload: ClientPortalSnapshotV1,
  privateKeyPem: string,
  keyId: string,
): SignedClientPortalSnapshotV1 {
  if (!keyId.trim()) throw new Error("keyId is required");
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("Client portal signing key must be Ed25519");
  return {
    schema: "dpm.client-portal.envelope",
    version: "1.0",
    algorithm: "Ed25519",
    keyId,
    contentDigest: digest(payload),
    payload,
    signature: sign(null, payloadBytes(payload), privateKey).toString("base64url"),
  };
}

export function verifyClientPortalSnapshot(
  envelope: SignedClientPortalSnapshotV1,
  publicKeyPem: string,
) {
  if (
    envelope.schema !== "dpm.client-portal.envelope" ||
    envelope.version !== "1.0" ||
    envelope.algorithm !== "Ed25519"
  )
    return false;
  if (envelope.contentDigest !== digest(envelope.payload)) return false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    return verify(
      null,
      payloadBytes(envelope.payload),
      publicKey,
      Buffer.from(envelope.signature, "base64url"),
    );
  } catch {
    return false;
  }
}
