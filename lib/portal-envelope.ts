import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import {
  canonicalPublicationJson,
  validatePortalSnapshot,
  validatePublication,
  type PortalSnapshot,
  type PublicationEnvelope,
} from "./portal-contract.js";
export const publicationDigest = (payload: PortalSnapshot) =>
  `sha256:${createHash("sha256").update(canonicalPublicationJson(payload)).digest("hex")}`;
export function signPublication(
  payload: PortalSnapshot,
  metadata: Pick<
    PublicationEnvelope,
    "sourceId" | "streamId" | "publicationSequence" | "keyId"
  >,
  privateKeyPem: string,
): PublicationEnvelope {
  validatePortalSnapshot(payload);
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") throw Error("Ed25519 key required");
  const unsigned = {
    schema: "dpm.client-portal.publication" as const,
    version: "2.0" as const,
    algorithm: "Ed25519" as const,
    ...metadata,
    contentDigest: publicationDigest(payload),
    payload,
  };
  const envelope = {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(canonicalPublicationJson(unsigned)),
      key,
    ).toString("base64url"),
  };
  return validatePublication(envelope);
}
export function verifyPublication(
  value: unknown,
  publicKeyPem: string,
): value is PublicationEnvelope {
  try {
    const envelope = validatePublication(value);
    if (envelope.contentDigest !== publicationDigest(envelope.payload))
      return false;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return false;
    const { signature, ...unsigned } = envelope;
    return verify(
      null,
      Buffer.from(canonicalPublicationJson(unsigned)),
      key,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}
