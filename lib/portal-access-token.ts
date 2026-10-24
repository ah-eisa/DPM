import { createHmac, timingSafeEqual } from "node:crypto";

export type PortalStatementAccessClaimsV1 = {
  version: 1;
  snapshotId: string;
  accountId: string;
  clientCode: string;
  resource: "statement";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function requireSecret(secret: string) {
  if (Buffer.byteLength(secret, "utf8") < 32)
    throw new Error("Portal access secret must be at least 32 bytes");
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issuePortalStatementAccessToken(
  input: Omit<
    PortalStatementAccessClaimsV1,
    "version" | "resource" | "issuedAt" | "expiresAt"
  >,
  secret: string,
  ttlSeconds = 900,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
) {
  requireSecret(secret);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600)
    throw new Error("Portal statement token TTL must be between 60 and 3600 seconds");
  const claims: PortalStatementAccessClaimsV1 = {
    version: 1,
    snapshotId: input.snapshotId,
    accountId: input.accountId,
    clientCode: input.clientCode,
    resource: "statement",
    issuedAt: nowEpochSeconds,
    expiresAt: nowEpochSeconds + ttlSeconds,
    nonce: input.nonce,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyPortalStatementAccessToken(
  token: string,
  secret: string,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): PortalStatementAccessClaimsV1 {
  requireSecret(secret);
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra) throw new Error("Malformed portal access token");
  const expected = signature(payload, secret);
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  )
    throw new Error("Invalid portal access token signature");

  let claims: PortalStatementAccessClaimsV1;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid portal access token payload");
  }
  if (
    claims.version !== 1 ||
    claims.resource !== "statement" ||
    !claims.snapshotId ||
    !claims.accountId ||
    !claims.clientCode ||
    !claims.nonce ||
    !Number.isSafeInteger(claims.issuedAt) ||
    !Number.isSafeInteger(claims.expiresAt) ||
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt > 3600
  )
    throw new Error("Invalid portal access token claims");
  if (claims.issuedAt > nowEpochSeconds + 60)
    throw new Error("Portal access token is not valid yet");
  if (claims.expiresAt <= nowEpochSeconds)
    throw new Error("Portal access token has expired");
  return claims;
}
