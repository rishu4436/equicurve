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
  MIN_LP_LOCK_PCT,
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
 * Build real DBC createConfigAndPool (optionally with first buy).
 * Supports Open SPL, Token-2022 (no hook), and Token-2022 transfer-hook
 * via dedicated SDK builders when NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM is set.
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
  let mode: PreparedLaunch["mode"];
  let configPubkey: PublicKey;
  const transactions: Transaction[] = [];
  const signersPerTx: Keypair[][] = [];

  let transferHookProgramPk: PublicKey | undefined;
  if (wantsTransferHook) {
    transferHookProgramPk = await requireTransferHookProgram(connection);
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
    const curveConfig = buildPresetConfig(input.presetId, {
      totalTokenSupply: input.totalSupply || 1_000_000_000,
      creatorTradingFeePercentage,
      lpLockPct,
      mintRenounce: effectiveMintRenounce,
      antiSniper,
      quoteDecimals: quoteDecimals as 6 | 9,
      tokenType: transferProfile === "open-spl" ? "spl" : "token-2022",
      allowMintAuthority: wantsTransferHook && !effectiveMintRenounce,
    });
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
      const tx = await client.partner.createConfigAndPoolWithTransferHook(
        baseParams as never,
      );
      transactions.push(tx);
      signersPerTx.push([keypairs.config, keypairs.baseMint]);
    } else {
      const tx = await client.partner.createConfigAndPool(baseParams);
      transactions.push(tx);
      signersPerTx.push([keypairs.config, keypairs.baseMint]);
    }
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
        initialMarketCapUsd: preset.initialMarketCap,
        migrationMarketCapUsd: preset.migrationMarketCap,
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
