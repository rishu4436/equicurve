import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { describe, expect, it } from "vitest";
import { prepareLaunchTransaction } from "@/lib/dbc/create";
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
  ["SOL, no seed", {}, 1],
  ["SOL + seed buy", { seedBuyAmount: "0.1" }, 2],
  ["SOL + seed buy, Token-2022", { seedBuyAmount: "0.25", transferProfile: "token-2022" }, 2],
  ["USDC + seed buy", { seedBuyAmount: "25.5", quoteLabel: "USDC" }, 2],
];

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
    });
  });
});
