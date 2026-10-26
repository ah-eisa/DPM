import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { fixture } from "./publication-fixture";
import { signPublication, verifyPublication } from "../lib/portal-envelope";
import { validatePortalSnapshot } from "../lib/portal-contract";

const keys = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const metadata = {
  sourceId: "synthetic-office",
  streamId: "stream-1",
  keyId: "key-1",
  publicationSequence: 1,
};
describe("WealthGate publication contract", () => {
  it("accepts a genuine account builder result and reconciles values", () => {
    const s = validatePortalSnapshot(fixture());
    expect(s.nav).toBe(1100);
    expect(s.cash).toBe(600);
    expect(s.holdings[0].marketValue).toBe(500);
    expect(JSON.stringify(s)).not.toContain("Private");
  });
  it("verifies a publication and signs the source, stream and publication sequence", () => {
    const e = signPublication(fixture(), metadata, keys.privateKey);
    expect(verifyPublication(e, keys.publicKey)).toBe(true);
    for (const update of [
      { sourceId: "other" },
      { streamId: "other" },
      { publicationSequence: 2 },
      { keyId: "other" },
    ])
      expect(verifyPublication({ ...e, ...update }, keys.publicKey)).toBe(
        false,
      );
  });
  it("permits price updates with unchanged book revision", () => {
    const p = fixture();
    const first = signPublication(p, metadata, keys.privateKey);
    const next = { ...p, snapshotId: "synthetic-snapshot-2" };
    const second = signPublication(
      next,
      { ...metadata, publicationSequence: 2 },
      keys.privateKey,
    );
    expect(second.payload.bookRevision).toBe(first.payload.bookRevision);
    expect(verifyPublication(second, keys.publicKey)).toBe(true);
  });
  it("fails closed for unknown fields, non-finite data and inconsistent NAV", () => {
    for (const p of [
      { ...fixture(), transactions: [] },
      { ...fixture(), nav: 999 },
      { ...fixture(), cash: NaN },
    ])
      expect(() => validatePortalSnapshot(p)).toThrow();
  });
  it("fails closed on malformed or tampered envelopes", () => {
    const e = signPublication(fixture(), metadata, keys.privateKey);
    expect(
      verifyPublication(
        { ...e, payload: { ...e.payload, clientCode: "somebody-else" } },
        keys.publicKey,
      ),
    ).toBe(false);
    expect(verifyPublication(null, keys.publicKey)).toBe(false);
    expect(verifyPublication(e, "invalid key")).toBe(false);
  });
});
