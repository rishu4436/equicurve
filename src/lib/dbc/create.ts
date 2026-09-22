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
import { EquiCurveError } from "@/lib/errors";
import { getDbcClient } from "./client";
import { buildPresetConfig, getPreset, MIN_LP_LOCK_PCT } from "./presets";
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

function clampLock(pct: number): number {
  return Math.min(100, Math.max(MIN_LP_LOCK_PCT, Math.round(pct)));
}

function clampCreatorFee(pct: number): number {
  return Math.min(100, Math.max(0, Math.round(pct)));
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

  const name = input.name.trim();
  const symbol = input.symbol.trim().toUpperCase();
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
  }
  if (name.length < 2 || symbol.length < 1) {
    throw new EquiCurveError("Name and symbol are required.", "VALIDATION");
  }

  const lpLockPct = clampLock(input.lpLockPct);
  const creatorTradingFeePercentage = clampCreatorFee(
    input.creatorTradingFeePercentage,
  );
  const mintRenounce = input.mintRenounce !== false;
  const seedBuySol = Math.max(0, Number(input.seedBuySol) || 0);
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
    try {
      feeClaimer = new PublicKey(input.feeClaimer.trim());
    } catch {
      throw new EquiCurveError(
        "Partner fee claimer is not a valid Solana address.",
        "VALIDATION",
      );
    }
  }

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

    if (seedBuySol > 0) {
      const buyAmount = new BN(Math.round(seedBuySol * 10 ** quoteDecimals));
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

    if (seedBuySol > 0) {
      const buyAmount = new BN(Math.round(seedBuySol * 10 ** quoteDecimals));
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
      signersPerTx.push(
        [keypairs.config],
        [keypairs.config, keypairs.baseMint],
      );
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
      seedBuySol,
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
