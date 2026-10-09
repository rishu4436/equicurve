import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { signAndSendTransaction } from "@/lib/send";

describe("transaction send safety", () => {
  it("never replays an ambiguously failed signed send through fallback", async () => {
    const signer = Keypair.generate();
    const tx = new Transaction({
      feePayer: signer.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
    });
    tx.add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: signer.publicKey, lamports: 0 }));
    const sendRawTransaction = vi.fn(async () => {
      throw new Error("fetch failed after submission may have reached the RPC");
    });
    const wallet = {
      publicKey: signer.publicKey,
      signTransaction: async (unsigned: Transaction) => {
        unsigned.partialSign(signer);
        return unsigned;
      },
    };

    await expect(signAndSendTransaction({
      connection: { sendRawTransaction } as never,
      wallet: wallet as never,
      tx,
    })).rejects.toThrow();
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});
