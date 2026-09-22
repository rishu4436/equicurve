import type { PublicKey } from "@solana/web3.js";

type MaybeWrappedPool = {
  poolState?: {
    config: PublicKey;
    baseMint: PublicKey;
    creator: PublicKey;
    [key: string]: unknown;
  };
  config?: PublicKey;
  baseMint?: PublicKey;
  creator?: PublicKey;
  [key: string]: unknown;
};

export type NormalizedPool = {
  config: PublicKey;
  baseMint: PublicKey;
  creator: PublicKey;
  raw: MaybeWrappedPool;
};

/** Normalize standard VirtualPool vs transfer-hook wrapper `{ poolState }`. */
export function normalizePoolAccount(account: MaybeWrappedPool): NormalizedPool {
  const inner =
    account.poolState && typeof account.poolState === "object"
      ? account.poolState
      : account;
  if (!inner.config || !inner.baseMint || !inner.creator) {
    throw new Error("Unexpected DBC pool account shape from SDK");
  }
  return {
    config: inner.config,
    baseMint: inner.baseMint,
    creator: inner.creator,
    raw: account,
  };
}
