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

type UnsignedClientPortalEnvelopeV1 = Omit<
  SignedClientPortalSnapshotV1,
  "signature"
>;

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

function signingBytes(envelope: UnsignedClientPortalEnvelopeV1) {
  return Buffer.from(canonicalPortalJson(envelope), "utf8");
}

function unsignedEnvelope(
  payload: ClientPortalSnapshotV1,
  keyId: string,
): UnsignedClientPortalEnvelopeV1 {
  return {
    schema: "dpm.client-portal.envelope",
    version: "1.0",
    algorithm: "Ed25519",
    keyId,
    contentDigest: digest(payload),
    payload,
  };
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
  const unsigned = unsignedEnvelope(payload, keyId);
  return {
    ...unsigned,
    signature: sign(null, signingBytes(unsigned), privateKey).toString("base64url"),
  };
}

export function verifyClientPortalSnapshot(
  envelope: SignedClientPortalSnapshotV1,
  publicKeyPem: string,
) {
  if (
    envelope.schema !== "dpm.client-portal.envelope" ||
    envelope.version !== "1.0" ||
    envelope.algorithm !== "Ed25519" ||
    !envelope.keyId?.trim()
  )
    return false;
  if (envelope.contentDigest !== digest(envelope.payload)) return false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    const unsigned: UnsignedClientPortalEnvelopeV1 = {
      schema: envelope.schema,
      version: envelope.version,
      algorithm: envelope.algorithm,
      keyId: envelope.keyId,
      contentDigest: envelope.contentDigest,
      payload: envelope.payload,
    };
    return verify(
      null,
      signingBytes(unsigned),
      publicKey,
      Buffer.from(envelope.signature, "base64url"),
    );
  } catch {
    return false;
  }
}
