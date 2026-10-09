import type { Connection, PublicKey } from "@solana/web3.js";
import { parseUiAmount } from "@/lib/amounts";
import { WSOL_MINT } from "@/lib/constants";
import { EquiCurveError } from "@/lib/errors";
import { withReadConnection } from "@/lib/connection";

export const SOL_SWAP_FEE_RENT_BUFFER_ATOMS = 10_000_000n;
export const BALANCE_MAX_AGE_MS = 15_000;

export function tradeAmountError(value: string, decimals: number | null): string | null {
  const text = value.trim();
  if (!text) return "Enter an amount.";
  if (!/^\d+(?:\.\d+)?$/.test(text)) return "Enter a valid positive amount.";
  if (Number(text) <= 0) return "Amount must be greater than zero.";
  if (decimals == null) return null;
  try {
    if (parseUiAmount(text, decimals) <= 0n) return "Amount is below the supported minimum.";
  } catch (error) {
    return error instanceof Error ? error.message : "Enter a valid amount.";
  }
  return null;
}

export function tradeBalanceError(args: {
  direction: "buy" | "sell";
  requestedAtoms: bigint;
  availableAtoms: bigint | null;
  feeRentBufferAtoms?: bigint;
  readAt: number | null;
  now?: number;
}): string | null {
  const now = args.now ?? Date.now();
  if (args.availableAtoms == null || args.readAt == null) return "Wallet balance is unavailable. Refresh the quote before signing.";
  if (now - args.readAt > BALANCE_MAX_AGE_MS) return "Wallet balance is stale. Refresh the quote before signing.";
  const required = args.requestedAtoms + (args.feeRentBufferAtoms ?? 0n);
  if (required <= args.availableAtoms) return null;
  return args.direction === "sell"
    ? "Insufficient wallet token balance for this sell amount."
    : "Insufficient wallet quote balance for this buy plus the estimated fee/rent buffer.";
}

export type TradeFundingEvidence = {
  inputAtoms: bigint;
  inputReadAt: number;
  nativeSolAtoms: bigint;
  nativeSolReadAt: number;
  inputIsNativeSol: boolean;
};

export function tradeFundingError(args: {
  direction: "buy" | "sell";
  requestedAtoms: bigint;
  evidence: TradeFundingEvidence | null;
  now?: number;
}): string | null {
  const evidence = args.evidence;
  if (!evidence) return "Wallet balances are unavailable. Refresh the quote before signing.";
  const inputError = tradeBalanceError({
    direction: args.direction,
    requestedAtoms: args.requestedAtoms,
    availableAtoms: evidence.inputAtoms,
    feeRentBufferAtoms: evidence.inputIsNativeSol ? SOL_SWAP_FEE_RENT_BUFFER_ATOMS : 0n,
    readAt: evidence.inputReadAt,
    now: args.now,
  });
  if (inputError) return inputError;
  if (!evidence.inputIsNativeSol) {
    const nativeError = tradeBalanceError({
      direction: "buy",
      requestedAtoms: 0n,
      availableAtoms: evidence.nativeSolAtoms,
      feeRentBufferAtoms: SOL_SWAP_FEE_RENT_BUFFER_ATOMS,
      readAt: evidence.nativeSolReadAt,
      now: args.now,
    });
    if (nativeError) {
      return "Insufficient native SOL reserve for transaction fees and possible token-account rent. The reserve is conservative, not an exact fee prediction.";
    }
  }
  return null;
}

export async function readSwapInputBalance(args: {
  connection: Connection;
  owner: PublicKey;
  mint: PublicKey;
}): Promise<{ atoms: bigint; readAt: number }> {
  try {
    if (args.mint.equals(WSOL_MINT)) {
      return withReadConnection(args.connection, async (connection) => ({
        atoms: BigInt(await connection.getBalance(args.owner, "confirmed")),
        readAt: Date.now(),
      }));
    }
    const reads = [await withReadConnection(args.connection, (connection) =>
      connection.getParsedTokenAccountsByOwner(args.owner, { mint: args.mint }, "confirmed"),
    )];
    const seen = new Set<string>();
    let atoms = 0n;
    for (const result of reads) {
      if (!result) continue;
      for (const account of result.value) {
        const key = account.pubkey.toBase58();
        if (seen.has(key)) continue;
        seen.add(key);
        const amount = (account.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info?.tokenAmount?.amount;
        if (amount && /^\d+$/.test(amount)) atoms += BigInt(amount);
      }
    }
    return { atoms, readAt: Date.now() };
  } catch (error) {
    throw new EquiCurveError("Could not read the connected wallet balance. Try again when RPC is available.", "RPC_UNAVAILABLE", error);
  }
}

export async function readTradeFunding(args: {
  connection: Connection;
  owner: PublicKey;
  inputMint: PublicKey;
}): Promise<TradeFundingEvidence> {
  const input = await readSwapInputBalance({
    connection: args.connection,
    owner: args.owner,
    mint: args.inputMint,
  });
  if (args.inputMint.equals(WSOL_MINT)) {
    return {
      inputAtoms: input.atoms,
      inputReadAt: input.readAt,
      nativeSolAtoms: input.atoms,
      nativeSolReadAt: input.readAt,
      inputIsNativeSol: true,
    };
  }
  const native = await readSwapInputBalance({ ...args, mint: WSOL_MINT });
  return {
    inputAtoms: input.atoms,
    inputReadAt: input.readAt,
    nativeSolAtoms: native.atoms,
    nativeSolReadAt: native.readAt,
    inputIsNativeSol: false,
  };
}
