import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { describe, expect, it } from "vitest";
import { EquiCurveError } from "@/lib/errors";
import { prepareLaunchTransaction } from "@/lib/dbc/create";
import { decodeTransactionSwaps, SEED_BUY_SLIPPAGE_BPS } from "@/lib/dbc/seedQuote";
import type { LaunchFormInput } from "@/lib/dbc/types";

/**
 * Regression (devnet e2e, pass 2): the seed-buy launch returned
 * signersPerTx = [[config], [config, baseMint]], but the pool+first-buy tx
 * does not list the config as a signer, so partialSign threw
 * "unknown signer" after the config tx had already landed.
 * Every keypair we partialSign with must be a required signer of that tx,
 * and every non-payer required signer must be covered.
 */
function offlineConnection(quoteMints: PublicKey[]): Connection {
  const conn = new Connection("http://127.0.0.1:9");
  (conn as unknown as { getAccountInfo: (k: PublicKey) => Promise<unknown> }).getAccountInfo = async (k: PublicKey) =>
    quoteMints.some((m) => m.equals(k))
      ? { owner: TOKEN_PROGRAM_ID, data: Buffer.alloc(82), executable: false, lamports: 1 }
      : null;
  return conn;
}

const base: LaunchFormInput = {
  name: "Signer Test Co",
  symbol: "SIGN",
  uri: "",
  presetId: "flat",
  totalSupply: 1_000_000_000,
  creatorTradingFeePercentage: 50,
  lpLockPct: 100,
  mintRenounce: true,
  seedBuyAmount: "",
  antiSniper: false,
};

const cases: [string, Partial<LaunchFormInput>, number][] = [
  ["SOL, short metadata URI, no seed", { uri: "https://example.com/sign.json" }, 1],
  ["SOL + seed buy", { seedBuyAmount: "0.1" }, 2],
  ["SOL + seed buy, Token-2022", { seedBuyAmount: "0.25", transferProfile: "token-2022" }, 2],
  ["USDC + seed buy", { seedBuyAmount: "25.5", quoteLabel: "USDC" }, 2],
];

function wireBytes(tx: Transaction, feePayer: PublicKey): number {
  const measured = new Transaction({ feePayer, recentBlockhash: PublicKey.default.toBase58() });
  measured.add(...tx.instructions);
  return measured.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
}

describe("prepareLaunchTransaction signersPerTx", () => {
  it.each(cases)("%s: partial signers match each tx's required signers", async (_label, patch, nTx) => {
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    const conn = offlineConnection([
      new PublicKey("So11111111111111111111111111111111111111112"),
      new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
    ]);
    const payer = Keypair.generate().publicKey;
    const r = await prepareLaunchTransaction({ connection: conn, payer, input: { ...base, ...patch } });
    expect(r.transactions).toHaveLength(nTx);
    expect(r.signersPerTx).toHaveLength(nTx);
    r.transactions.forEach((tx, i) => {
      const required = new Set(
        tx.instructions.flatMap((ix) => ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())),
      );
      required.delete(payer.toBase58());
      const partial = new Set(r.signersPerTx[i].map((k) => k.publicKey.toBase58()));
      expect([...partial].sort()).toEqual([...required].sort());
      expect(wireBytes(tx, payer)).toBeLessThanOrEqual(1232);
    });
    const swaps = r.transactions.flatMap((tx) => decodeTransactionSwaps(tx));
    const seed = (patch.seedBuyAmount ?? "").trim();
    const hasSeed = seed !== "" && !/^0*(\.0*)?$/.test(seed);
    if (hasSeed) {
      expect(swaps).toHaveLength(1);
      expect(swaps[0].kind).toBe("swap");
      expect(swaps[0].amountIn).toBe(BigInt(r.prepared.seedBuyAtoms));
      expect(swaps[0].minimumAmountOut > 0n).toBe(true);
      expect(swaps[0].minimumAmountOut.toString()).toBe(r.prepared.seedBuyMinimumOutAtoms);
      expect(r.prepared.seedBuyMinimumOutAtoms).toBe(r.prepared.seedBuyExpectedOutAtoms);
      expect(r.prepared.seedBuySlippageBps).toBe(SEED_BUY_SLIPPAGE_BPS);
    } else {
      expect(swaps).toHaveLength(0);
      expect(r.prepared.seedBuyMinimumOutAtoms).toBe("0");
      expect(r.prepared.seedBuyExpectedOutAtoms).toBe("0");
    }
  });

  it("splits a wizard-length inline metadata URI and keeps a short https URI in one transaction", async () => {
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    const conn = offlineConnection([new PublicKey("So11111111111111111111111111111111111111112")]);
    const payer = Keypair.generate().publicKey;
    const searched: LaunchFormInput = {
      ...base,
      name: "Journey",
      symbol: "JRNY",
      presetId: "exponential",
      creatorTradingFeePercentage: 70,
      lpLockPct: 100,
      antiSniper: true,
      marketCaps: { initial: 91.068, migration: 273.204 },
    };
    // Same shape resolveMetadataUri writes when the wallet does not host metadata.
    // A 140-character thesis is the wizard maximum and is enough to push the
    // combined Journey create past 1232 bytes. The short fallback still fits.
    const thesisUri = `data:application/json,${encodeURIComponent(
      JSON.stringify({
        name: "Journey",
        symbol: "JRNY",
        description: "a".repeat(140),
        image: "",
      }),
    )}`;
    const blank = await prepareLaunchTransaction({ connection: conn, payer, input: searched });
    const inline = await prepareLaunchTransaction({
      connection: conn,
      payer,
      input: { ...searched, uri: thesisUri },
    });
    const hosted = await prepareLaunchTransaction({
      connection: conn,
      payer,
      input: { ...searched, uri: "https://example.com/jrny.json" },
    });
    expect(blank.transactions).toHaveLength(1);
    expect(wireBytes(blank.transactions[0], payer)).toBeLessThanOrEqual(1232);
    expect(hosted.transactions).toHaveLength(1);
    expect(wireBytes(hosted.transactions[0], payer)).toBeLessThanOrEqual(1232);
    expect(inline.transactions).toHaveLength(2);
    expect(inline.prepared.summary.uri).toBe(thesisUri);
    expect(inline.prepared.summary.migrationQuoteThresholdAtoms).toBe("99999604415");
    expect(inline.prepared.summary.migrationQuoteThresholdAtoms).toBe(
      hosted.prepared.summary.migrationQuoteThresholdAtoms,
    );
    expect(blank.prepared.summary.migrationQuoteThresholdAtoms).toBe("99999604415");
    inline.transactions.forEach((tx, i) => {
      const required = new Set(
        tx.instructions.flatMap((ix) => ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())),
      );
      required.delete(payer.toBase58());
      const partial = new Set(inline.signersPerTx[i].map((k) => k.publicKey.toBase58()));
      expect([...partial].sort()).toEqual([...required].sort());
      expect(partial.size).toBe(1);
      expect(wireBytes(tx, payer)).toBeLessThanOrEqual(1232);
    });
    expect(inline.signersPerTx[0][0].publicKey.toBase58()).toBe(inline.keypairs.config.publicKey.toBase58());
    expect(inline.signersPerTx[1][0].publicKey.toBase58()).toBe(inline.keypairs.baseMint.publicKey.toBase58());
  });

  it("refuses a metadata URI that still exceeds 1232 bytes after the split", async () => {
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    const conn = offlineConnection([new PublicKey("So11111111111111111111111111111111111111112")]);
    const payer = Keypair.generate().publicKey;
    const huge = `https://example.com/${"a".repeat(900)}.json`;
    await expect(
      prepareLaunchTransaction({ connection: conn, payer, input: { ...base, uri: huge } }),
    ).rejects.toThrow(EquiCurveError);
    await expect(
      prepareLaunchTransaction({ connection: conn, payer, input: { ...base, uri: huge } }),
    ).rejects.toThrow(/1232/);
  });
});
