import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildClientPortalSnapshot } from "../lib/client-portal";
import {
  signClientPortalSnapshot,
  verifyClientPortalSnapshot,
} from "../lib/portal-signing";
import {
  issuePortalStatementAccessToken,
  verifyPortalStatementAccessToken,
} from "../lib/portal-access-token";
import { renderClientStatementHtml } from "../lib/client-statement";
import type { DpmState, Quote } from "../lib/types";

const publishedAt = "2026-10-24T10:00:00.000Z";
const quote = (symbol: string, price: number): Quote => ({
  symbol,
  price,
  previousClose: price - 10,
  currency: "USD",
  asOf: publishedAt,
  source: "Test feed",
});

function book(): DpmState {
  return {
    version: 4,
    revision: 12,
    clients: [
      {
        id: "c1",
        code: "C-0001",
        label: "Sensitive Client Name",
        baseCurrency: "USD",
        benchmark: "SPY",
        riskProfile: "Balanced",
        initialCash: 0,
      },
    ],
    transactions: [
      {
        id: "t1",
        accountId: "a1",
        securityId: "sx",
        clientId: "c1",
        symbol: "X",
        name: "X Corp",
        assetClass: "ETF",
        side: "BUY",
        quantity: 2,
        price: 100,
        fees: 0,
        fxRate: 1,
        currency: "USD",
        tradeDate: "2026-10-20",
        sequence: 1,
      },
      {
        id: "t2",
        accountId: "a2",
        securityId: "sy",
        clientId: "c1",
        symbol: "Y",
        name: "Y Corp",
        assetClass: "US Equity",
        side: "BUY",
        quantity: 3,
        price: 200,
        fees: 0,
        fxRate: 1,
        currency: "USD",
        tradeDate: "2026-10-20",
        sequence: 2,
      },
    ],
    cashMovements: [],
    corporateActions: [],
    targets: [
      { clientId: "c1", assetClass: "ETF", targetPct: 20 },
      { clientId: "c1", assetClass: "Cash", targetPct: 80 },
    ],
    controls: {
      accounts: [
        {
          id: "a1",
          clientId: "c1",
          label: "Private Account Label 1",
          custodian: "Custodian A",
          baseCurrency: "USD",
          initialCash: 1000,
        },
        {
          id: "a2",
          clientId: "c1",
          label: "Private Account Label 2",
          custodian: "Custodian B",
          baseCurrency: "USD",
          initialCash: 5000,
        },
      ],
      securities: [
        {
          id: "sx",
          symbol: "X",
          name: "X Corp",
          exchange: "NYSE",
          currency: "USD",
          assetClass: "ETF",
          priceMultiplier: 1,
          shariaStatus: "unknown",
        },
        {
          id: "sy",
          symbol: "Y",
          name: "Y Corp",
          exchange: "NASDAQ",
          currency: "USD",
          assetClass: "US Equity",
          priceMultiplier: 1,
          shariaStatus: "unknown",
        },
      ],
      observations: [],
      reviews: [],
      overrides: [],
      households: [],
      views: [],
    },
  };
}

function snapshot() {
  return buildClientPortalSnapshot({
    state: book(),
    clientId: "c1",
    accountId: "a1",
    quotes: { sx: quote("X", 120), sy: quote("Y", 220) },
    snapshotId: "snap-1",
    publishedAt,
  });
}

function signingKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("client portal publish layer", () => {
  it("publishes only the selected account and omits client/account labels", () => {
    const s = snapshot();
    expect(s.accountId).toBe("a1");
    expect(s.clientCode).toBe("C-0001");
    expect(s.nav).toBe(1040);
    expect(s.holdings).toHaveLength(1);
    expect(s.holdings[0]).toMatchObject({ symbol: "X", securityId: "sx", marketValue: 240 });
    const json = JSON.stringify(s);
    expect(json).not.toContain("Sensitive Client Name");
    expect(json).not.toContain("Private Account Label");
    expect(json).not.toContain("Custodian B");
    expect(json).not.toContain('"Y"');
  });

  it("retains current price lineage only for securities in the published account", () => {
    const s = snapshot();
    expect(s.priceLineage).toHaveLength(1);
    expect(s.priceLineage[0]).toMatchObject({ securityId: "sx" });
    expect(s.priceLineage[0].selected).toContain("Test feed");
  });

  it("preserves full security-master ticker ambiguity while publishing one account", () => {
    const state = book();
    state.controls!.securities.push({
      id: "sx-other",
      symbol: "X",
      name: "Different X instrument",
      exchange: "OTHER",
      currency: "USD",
      assetClass: "US Equity",
      priceMultiplier: 1,
      shariaStatus: "unknown",
    });
    const s = buildClientPortalSnapshot({
      state,
      clientId: "c1",
      accountId: "a1",
      quotes: { X: quote("X", 120) },
      snapshotId: "snap-ambiguous",
      publishedAt,
    });
    expect(s.nav).toBe(1000);
    expect(s.holdings[0]).toMatchObject({
      securityId: "sx",
      marketPrice: 100,
      valuationStatus: "cost",
    });
    expect(s.priceLineage).toEqual([
      expect.objectContaining({ securityId: "sx", selected: "unavailable" }),
    ]);
  });

  it("excludes future ledger events from a historical snapshot", () => {
    const state = book();
    state.cashMovements.push({
      id: "future-deposit",
      accountId: "a1",
      clientId: "c1",
      sequence: 3,
      kind: "DEPOSIT",
      amount: 500,
      currency: "USD",
      fxRate: 1,
      movementDate: "2026-11-01",
    });
    const s = buildClientPortalSnapshot({
      state,
      clientId: "c1",
      accountId: "a1",
      quotes: { sx: quote("X", 120) },
      snapshotId: "snap-cutoff",
      publishedAt,
    });
    expect(s.nav).toBe(1040);
    expect(s.cash).toBe(800);
  });

  it("uses publishedAt instead of wall-clock time for valuation staleness", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-24T10:00:00.000Z"));
      const first = snapshot();
      vi.setSystemTime(new Date("2026-10-30T10:00:00.000Z"));
      const second = snapshot();
      expect(first.holdings[0].valuationStatus).toBe("live");
      expect(second.holdings[0].valuationStatus).toBe("live");
      expect(second).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("excludes a quote after publishedAt from NAV instead of merely marking it stale", () => {
    const futureQuote = {
      ...quote("X", 900),
      asOf: "2026-10-25T10:00:00.000Z",
    };
    const s = buildClientPortalSnapshot({
      state: book(),
      clientId: "c1",
      accountId: "a1",
      quotes: { sx: futureQuote },
      snapshotId: "snap-future-quote",
      publishedAt,
    });
    expect(s.nav).toBe(1000);
    expect(s.holdings[0]).toMatchObject({
      marketPrice: 100,
      marketValue: 200,
      valuationStatus: "cost",
    });
    expect(s.valuationComplete).toBe(false);
  });

  it("treats equivalent timezone representations as the same override instant", () => {
    const state = book();
    state.controls!.overrides.push({
      id: "ov-same-instant",
      securityId: "sx",
      price: 999,
      currency: "USD",
      effectiveAt: "2026-10-24T10:00:00+02:00",
      expiresAt: "2026-10-24T14:00:00+02:00",
      recordedAt: "2026-10-24T07:59:00.000Z",
      source: "Ops test",
      reason: "Timezone normalization regression",
    });
    const buildAt = (at: string, id: string) =>
      buildClientPortalSnapshot({
        state,
        clientId: "c1",
        accountId: "a1",
        quotes: { sx: quote("X", 120) },
        snapshotId: id,
        publishedAt: at,
      });
    const utc = buildAt("2026-10-24T08:00:00.000Z", "snap-utc");
    const dubai = buildAt("2026-10-24T12:00:00+04:00", "snap-dubai");
    expect(utc.nav).toBe(2798);
    expect(dubai.nav).toBe(2798);
    expect(utc.holdings[0].marketPrice).toBe(999);
    expect(dubai.holdings[0].marketPrice).toBe(999);
  });

  it("refuses publishing if client ledger events are not bound to an account", () => {
    const state = book();
    state.transactions[0] = { ...state.transactions[0], accountId: undefined };
    expect(() =>
      buildClientPortalSnapshot({
        state,
        clientId: "c1",
        accountId: "a1",
        quotes: { sx: quote("X", 120) },
        snapshotId: "snap-2",
        publishedAt,
      }),
    ).toThrow(/every client ledger event/);
  });

  it("signs payload and key metadata with Ed25519 and detects tampering", () => {
    const { privatePem, publicPem } = signingKeys();
    const envelope = signClientPortalSnapshot(
      snapshot(),
      privatePem,
      "office-key-2026-01",
    );
    expect(verifyClientPortalSnapshot(envelope, publicPem)).toBe(true);
    const payloadTampered = {
      ...envelope,
      payload: { ...envelope.payload, nav: envelope.payload.nav + 1 },
    };
    expect(verifyClientPortalSnapshot(payloadTampered, publicPem)).toBe(false);
    const keyIdTampered = { ...envelope, keyId: "attacker-key" };
    expect(verifyClientPortalSnapshot(keyIdTampered, publicPem)).toBe(false);
  });

  it("issues short-lived statement access tokens and rejects expiry/tampering", () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const token = issuePortalStatementAccessToken(
      {
        snapshotId: "snap-1",
        accountId: "a1",
        clientCode: "C-0001",
        nonce: "n-1",
      },
      secret,
      900,
      1000,
    );
    expect(verifyPortalStatementAccessToken(token, secret, 1500)).toMatchObject({
      snapshotId: "snap-1",
      accountId: "a1",
    });
    expect(() => verifyPortalStatementAccessToken(token, secret, 1900)).toThrow(/expired/);
    expect(() => verifyPortalStatementAccessToken(`${token}x`, secret, 1500)).toThrow();
  });

  it("verifies the envelope before rendering a statement", () => {
    const { privatePem, publicPem } = signingKeys();
    const envelope = signClientPortalSnapshot(
      snapshot(),
      privatePem,
      "office-key-2026-01",
    );
    const html = renderClientStatementHtml(envelope, publicPem);
    expect(html).toContain("Discretionary Portfolio Statement");
    expect(html).toContain(envelope.contentDigest);
    expect(html).toContain("C-0001");
    expect(html).not.toContain("Sensitive Client Name");

    const tampered = {
      ...envelope,
      payload: { ...envelope.payload, nav: envelope.payload.nav + 999 },
    };
    expect(() => renderClientStatementHtml(tampered, publicPem)).toThrow(
      /valid signed portal snapshot/,
    );
  });
});
