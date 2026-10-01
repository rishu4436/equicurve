import { deriveDbcPoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  Keypair,
  PublicKey,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  getOptionalPoolConfigKey,
  getUsdcMint,
  isPlaceholderMetadataUri,
  WSOL_MINT,
  type QuoteLabel,
} from "@/lib/constants";
import { AmountError, formatAtomsExact, parseUiAmountToBN } from "@/lib/amounts";
import { EquiCurveError } from "@/lib/errors";
import {
  firstIssue,
  lpLockSchema,
  nameSchema,
  pctSchema,
  presetIdSchema,
  symbolSchema,
  validateSeedBuy,
  walletSchema,
} from "@/lib/validation";
import { getDbcClient } from "./client";
import {
  buildPresetConfig,
  getPreset,
  launchPresetOverrides,
  MIN_LP_LOCK_PCT,
  presetMarketCaps,
  validateEquiCurveConfig,
} from "./presets";
import type { LaunchFormInput, PreparedLaunch } from "./types";
import {
  isTransferHookProfileAvailable,
  parseTransferProfile,
  requireTransferHookProgram,
  type TransferProfile,
} from "./transferHook";

export type LaunchKeypairs = {
  config: Keypair;
  baseMint: Keypair;
};

export type PreparedLaunchBundle = {
  prepared: PreparedLaunch;
  keypairs: LaunchKeypairs;
  /**
   * Ordered txs to sign+send (config first when split for first-buy).
   * Caller must set recentBlockhash + feePayer and partialSign(keypairs)
   * immediately before each send.
   */
  transactions: Transaction[];
  /** Which keypairs must partialSign each tx (same order as transactions). */
  signersPerTx: Keypair[][];
};

function assertValid<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: import("zod").ZodError } },
  value: unknown,
  label: string,
): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new EquiCurveError(`${label}: ${firstIssue(r.error)}`, "VALIDATION");
  }
  return r.data;
}

/**
 * The config Create will send. Review and the market simulator must call this
 * same builder (via launchPresetOverrides) so the signed curve is the simulated one.
 */
export function launchCurveConfig(args: {
  presetId: LaunchFormInput["presetId"];
  totalSupply: number;
  creatorTradingFeePercentage: number;
  lpLockPct: number;
  mintRenounce: boolean;
  antiSniper: boolean;
  quoteDecimals: 6 | 9;
  transferProfile: TransferProfile;
  marketCaps?: LaunchFormInput["marketCaps"];
}) {
  return buildPresetConfig(args.presetId, launchPresetOverrides(args));
}

/** Solana packet limit. web3.js rejects a serialized transaction above this. */
const SOLANA_PACKET_DATA_SIZE = 1232;

/**
 * Wire size, or "unencodable" when web3.js throws instead of returning a length.
 * Message.compile uses a 1232-byte instruction buffer, so an oversized create
 * throws RangeError ("encoding overruns Buffer" / offset 1232) before the
 * "Transaction too large: N > 1232" assert can report N.
 */
function transactionWireBytes(tx: Transaction, feePayer: PublicKey): number | "unencodable" {
  const measured = new Transaction({
    feePayer,
    recentBlockhash: PublicKey.default.toBase58(),
  });
  measured.add(...tx.instructions);
  try {
    return measured.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  } catch (e) {
    const overflow = packetOverflowBytes(e);
    if (overflow === undefined) throw e;
    return overflow ?? "unencodable";
  }
}

function packetOverflowBytes(e: unknown): number | null | undefined {
  if (!(e instanceof Error)) return undefined;
  const tooLarge = /Transaction too large: (\d+)/.exec(e.message);
  if (tooLarge) return Number(tooLarge[1]);
  if (e instanceof RangeError || /encoding overruns|out of range/i.test(e.message)) return null;
  return undefined;
}

function exceedsPacket(size: number | "unencodable"): boolean {
  return size === "unencodable" || size > SOLANA_PACKET_DATA_SIZE;
}

function packetLimitError(size: number | "unencodable"): EquiCurveError {
  const shown = size === "unencodable" ? `more than ${SOLANA_PACKET_DATA_SIZE}` : String(size);
  return new EquiCurveError(
    `Create transaction is ${shown} bytes. Solana accepts ${SOLANA_PACKET_DATA_SIZE}. Use a shorter https metadata URI.`,
    "VALIDATION",
  );
}

function sameInstruction(
  a: Transaction["instructions"][number],
  b: Transaction["instructions"][number],
): boolean {
  if (!a.programId.equals(b.programId) || a.data.length !== b.data.length || a.keys.length !== b.keys.length) {
    return false;
  }
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return a.keys.every(
    (k, i) =>
      k.pubkey.equals(b.keys[i].pubkey) &&
      k.isSigner === b.keys[i].isSigner &&
      k.isWritable === b.keys[i].isWritable,
  );
}

/**
 * Build real DBC createConfigAndPool (optionally with first buy).
 * Supports Open SPL, Token-2022 (no hook), and Token-2022 transfer-hook
 * via dedicated SDK builders when NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM is set.
 * A combined config+pool transaction that would exceed 1232 bytes is sent as
 * createConfig, then createPool. Both use the same curve config. A piece that
 * still does not fit is rejected before signing.
 */
export async function prepareLaunchTransaction(args: {
  connection: Connection;
  payer: PublicKey;
  input: LaunchFormInput;
  keypairs?: LaunchKeypairs;
}): Promise<PreparedLaunchBundle> {
  const { connection, payer, input } = args;
  if (!payer) {
    throw new EquiCurveError("Connect a wallet to launch.", "MISSING_WALLET");
  }

  const name = assertValid(nameSchema, input.name, "Name");
  const symbol = assertValid(symbolSchema, input.symbol.trim().toUpperCase(), "Ticker");
  assertValid(presetIdSchema, input.presetId, "Curve preset");
  let uri = input.uri.trim();
  if (!uri || isPlaceholderMetadataUri(uri)) {
    uri = `data:application/json,${encodeURIComponent(
      JSON.stringify({
        name,
        symbol,
        description: `${name} (${symbol}) — EquiCurve DBC offering`,
        image: "",
      }),
    )}`;
  } else if (!/^https:\/\//i.test(uri) && !uri.startsWith("data:application/json,") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/metadata\//.test(uri)) {
    throw new EquiCurveError("Metadata URI must be https:// (or app-hosted).", "VALIDATION");
  }

  const lpLockPct = assertValid(lpLockSchema, input.lpLockPct, `LP lock % (min ${MIN_LP_LOCK_PCT})`);
  const creatorTradingFeePercentage = assertValid(
    pctSchema,
    input.creatorTradingFeePercentage,
    "Creator fee share",
  );
  const mintRenounce = input.mintRenounce !== false;
  const antiSniper = !!input.antiSniper;

  const transferProfile: TransferProfile = parseTransferProfile(
    input.transferProfile,
  );
  const wantsTransferHook = transferProfile === "transfer-hook";
  if (wantsTransferHook && !isTransferHookProfileAvailable()) {
    throw new EquiCurveError(
      "Transfer-hook profile selected but NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM is not set to a valid program ID.",
      "VALIDATION",
    );
  }
  // Mint+update authority is only valid on transfer-hook configs (Meteora docs).
  const effectiveMintRenounce = wantsTransferHook ? mintRenounce : true;

  const quoteLabel: QuoteLabel = input.quoteLabel === "USDC" ? "USDC" : "SOL";
  let quoteMint = WSOL_MINT;
  let quoteDecimals = 9;
  if (quoteLabel === "USDC") {
    const usdc = getUsdcMint();
    if (!usdc) {
      throw new EquiCurveError(
        "USDC quote is not available on this cluster (no known mint).",
        "VALIDATION",
      );
    }
    quoteMint = usdc;
    quoteDecimals = 6;
  }

  let feeClaimer = payer;
  if (input.feeClaimer?.trim()) {
    const r = walletSchema.safeParse(input.feeClaimer.trim());
    if (!r.success) {
      throw new EquiCurveError(
        "Partner fee claimer must be a valid on-curve wallet address (it has to sign claims).",
        "VALIDATION",
      );
    }
    feeClaimer = new PublicKey(r.data);
  }

  // Exact seed-buy conversion (string → atoms), never float * 10**decimals.
  const seedRaw = (input.seedBuyAmount ?? "").trim();
  const seedErr = validateSeedBuy(seedRaw, quoteLabel);
  if (seedErr) throw new EquiCurveError(`Seed buy: ${seedErr}`, "VALIDATION");
  let seedBuyAtoms = new BN(0);
  if (seedRaw && !/^0*(\.0*)?$/.test(seedRaw)) {
    try {
      seedBuyAtoms = parseUiAmountToBN(seedRaw, quoteDecimals);
    } catch (e) {
      throw new EquiCurveError(
        `Seed buy: ${e instanceof AmountError ? e.message : "invalid amount"}`,
        "VALIDATION",
      );
    }
  }
  const hasSeedBuy = !seedBuyAtoms.isZero();

  const client = getDbcClient(connection);
  const existingConfig = getOptionalPoolConfigKey();
  const keypairs =
    args.keypairs ??
    ({
      config: Keypair.generate(),
      baseMint: Keypair.generate(),
    } satisfies LaunchKeypairs);

  const preset = getPreset(input.presetId);
  const caps = input.marketCaps ?? presetMarketCaps(input.presetId, quoteLabel);
  let thresholdAtoms = "";
  let mode: PreparedLaunch["mode"];
  let configPubkey: PublicKey;
  const transactions: Transaction[] = [];
  const signersPerTx: Keypair[][] = [];

  let transferHookProgramPk: PublicKey | undefined;
  if (wantsTransferHook) {
    transferHookProgramPk = await requireTransferHookProgram(connection);
  }

  if (existingConfig && input.marketCaps) {
    throw new EquiCurveError(
      "This launch has a searched market design. NEXT_PUBLIC_POOL_CONFIG_KEY would ignore those market caps, so the transaction was not built. Unset the shared config to deploy the simulated curve.",
      "VALIDATION",
    );
  }

  if (existingConfig) {
    mode = "pool-only";
    configPubkey = existingConfig;
    const createPoolParam = {
      name,
      symbol,
      uri,
      payer,
      poolCreator: payer,
      config: existingConfig,
      baseMint: keypairs.baseMint.publicKey,
      ...(transferHookProgramPk
        ? { transferHookProgram: transferHookProgramPk }
        : {}),
    };

    if (hasSeedBuy) {
      const buyAmount = seedBuyAtoms;
      const firstBuyParam = {
        buyer: payer,
        buyAmount,
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };
      const tx = wantsTransferHook
        ? await client.creator.createPoolWithFirstBuyWithTransferHook({
            createPoolParam: createPoolParam as never,
            firstBuyParam,
          })
        : await client.creator.createPoolWithFirstBuy({
            createPoolParam,
            firstBuyParam,
          });
      transactions.push(tx);
      signersPerTx.push([keypairs.baseMint]);
    } else {
      const tx = wantsTransferHook
        ? await client.creator.createPoolWithTransferHook(
            createPoolParam as never,
          )
        : await client.creator.createPool(createPoolParam);
      transactions.push(tx);
      signersPerTx.push([keypairs.baseMint]);
    }
  } else {
    mode = "config-and-pool";
    configPubkey = keypairs.config.publicKey;
    const curveConfig = launchCurveConfig({
      presetId: input.presetId,
      totalSupply: input.totalSupply,
      creatorTradingFeePercentage,
      lpLockPct,
      mintRenounce: effectiveMintRenounce,
      antiSniper,
      quoteDecimals: quoteDecimals as 6 | 9,
      transferProfile,
      marketCaps: input.marketCaps,
    });
    thresholdAtoms = String(
      (curveConfig as { migrationQuoteThreshold: { toString(): string } }).migrationQuoteThreshold.toString(),
    );
    const configErrors = validateEquiCurveConfig(curveConfig);
    if (configErrors.length) {
      throw new EquiCurveError(
        `Config violates Meteora DBC constraints: ${configErrors.join(" ")}`,
        "VALIDATION",
      );
    }

    const baseParams = {
      ...curveConfig,
      config: keypairs.config.publicKey,
      feeClaimer,
      leftoverReceiver: payer,
      quoteMint,
      payer,
      preCreatePoolParam: {
        name,
        symbol,
        uri,
        poolCreator: payer,
        baseMint: keypairs.baseMint.publicKey,
      },
      ...(transferHookProgramPk
        ? { transferHookProgram: transferHookProgramPk }
        : {}),
    };

    if (hasSeedBuy) {
      const buyAmount = seedBuyAtoms;
      const firstBuyParam = {
        buyer: payer,
        buyAmount,
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };
      if (wantsTransferHook) {
        const { createConfigTx, createPoolWithFirstBuyTx } =
          await client.partner.createConfigAndPoolWithFirstBuyWithTransferHook({
            ...baseParams,
            firstBuyParam,
          } as never);
        transactions.push(createConfigTx, createPoolWithFirstBuyTx);
      } else {
        const { createConfigTx, createPoolWithFirstBuyTx } =
          await client.partner.createConfigAndPoolWithFirstBuy({
            ...baseParams,
            firstBuyParam,
          });
        transactions.push(createConfigTx, createPoolWithFirstBuyTx);
      }
      // The pool+first-buy tx does NOT reference the config keypair as a
      // signer; partialSign() with it throws "unknown signer" — AFTER the
      // config tx already landed (proven on-chain in the devnet e2e run).
      signersPerTx.push([keypairs.config], [keypairs.baseMint]);
    } else if (wantsTransferHook) {
      // A zero buy uses the same config and pool builders as the combined
      // transaction and does not append a swap. creator.createPool would
      // instead read the config account, which does not exist yet.
      const zeroBuy = {
        buyer: payer,
        buyAmount: new BN(0),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };
      await addConfigAndPool(
        () => client.partner.createConfigAndPoolWithTransferHook(baseParams as never),
        async () => {
          const split = await client.partner.createConfigAndPoolWithFirstBuyWithTransferHook({
            ...baseParams,
            firstBuyParam: zeroBuy,
          } as never);
          return { configTx: split.createConfigTx, poolTx: split.createPoolWithFirstBuyTx };
        },
      );
    } else {
      const zeroBuy = {
        buyer: payer,
        buyAmount: new BN(0),
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      };
      await addConfigAndPool(
        () => client.partner.createConfigAndPool(baseParams),
        async () => {
          const split = await client.partner.createConfigAndPoolWithFirstBuy({
            ...baseParams,
            firstBuyParam: zeroBuy,
          });
          return { configTx: split.createConfigTx, poolTx: split.createPoolWithFirstBuyTx };
        },
      );
    }
  }

  for (const tx of transactions) {
    const bytes = transactionWireBytes(tx, payer);
    if (exceedsPacket(bytes)) throw packetLimitError(bytes);
  }

  async function addConfigAndPool(
    buildCombined: () => Promise<Transaction>,
    split: () => Promise<{ configTx: Transaction; poolTx: Transaction }>,
  ) {
    let combined: Transaction | undefined;
    try {
      combined = await buildCombined();
    } catch (e) {
      if (packetOverflowBytes(e) === undefined) throw e;
    }
    if (combined && !exceedsPacket(transactionWireBytes(combined, payer))) {
      transactions.push(combined);
      signersPerTx.push([keypairs.config, keypairs.baseMint]);
      return;
    }
    let parts: { configTx: Transaction; poolTx: Transaction };
    try {
      parts = await split();
    } catch (e) {
      const overflow = packetOverflowBytes(e);
      if (overflow === undefined) throw e;
      throw packetLimitError(overflow ?? "unencodable");
    }
    if (combined) {
      const merged = new Transaction().add(parts.configTx, parts.poolTx);
      const same =
        merged.instructions.length === combined.instructions.length &&
        merged.instructions.every((ix, i) => sameInstruction(ix, combined.instructions[i]));
      if (!same) {
        throw new EquiCurveError(
          "Could not split the create transaction without changing its instructions.",
          "VALIDATION",
        );
      }
    }
    transactions.push(parts.configTx, parts.poolTx);
    signersPerTx.push([keypairs.config], [keypairs.baseMint]);
  }

  const pool = deriveDbcPoolAddress(
    quoteMint,
    keypairs.baseMint.publicKey,
    configPubkey,
  );

  return {
    prepared: {
      mode,
      presetId: input.presetId,
      configPubkey: configPubkey.toBase58(),
      baseMintPubkey: keypairs.baseMint.publicKey.toBase58(),
      poolPubkey: pool.toBase58(),
      quoteMint: quoteMint.toBase58(),
      quoteLabel,
      lpLockPct,
      creatorTradingFeePercentage,
      mintRenounce: effectiveMintRenounce,
      seedBuyAtoms: seedBuyAtoms.toString(10),
      seedBuyDisplay: formatAtomsExact(seedBuyAtoms.toString(10), quoteDecimals),
      feeClaimer: feeClaimer.toBase58(),
      transferProfile,
      transferHookProgram: transferHookProgramPk?.toBase58(),
      summary: {
        name,
        symbol,
        uri,
        initialMarketCapQuote: caps.initial,
        migrationMarketCapQuote: caps.migration,
        migrationQuoteThresholdAtoms: thresholdAtoms,
        quoteDecimals,
        feeLabel: preset.feeLabel,
        migration: `DAMM v2 · partner LP lock ${lpLockPct}% · quote ${quoteLabel} · ${transferProfile}`,
      },
    },
    keypairs,
    transactions,
    signersPerTx,
  };
}

/**
 * Pre-compute pool / mint / config addresses before any tx is built, so the
 * creator can sign the registry + metadata payload that binds to them.
 * Mirrors the derivation in prepareLaunchTransaction.
 */
export function planLaunchAddresses(args: {
  quoteLabel: QuoteLabel;
  keypairs: LaunchKeypairs;
}): { pool: string; mint: string; config: string; quoteMint: string } {
  let quoteMint = WSOL_MINT;
  if (args.quoteLabel === "USDC") {
    const usdc = getUsdcMint();
    if (!usdc) {
      throw new EquiCurveError(
        "USDC quote is not available on this cluster (no known mint).",
        "VALIDATION",
      );
    }
    quoteMint = usdc;
  }
  const config = getOptionalPoolConfigKey() ?? args.keypairs.config.publicKey;
  const pool = deriveDbcPoolAddress(quoteMint, args.keypairs.baseMint.publicKey, config);
  return {
    pool: pool.toBase58(),
    mint: args.keypairs.baseMint.publicKey.toBase58(),
    config: config.toBase58(),
    quoteMint: quoteMint.toBase58(),
  };
}
