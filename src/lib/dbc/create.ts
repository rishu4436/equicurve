import { deriveDbcPoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  Keypair,
  PublicKey,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import BN from "bn.js";
import { getOptionalPoolConfigKey, WSOL_MINT } from "@/lib/constants";
import { EquiCurveError } from "@/lib/errors";
import { getDbcClient } from "./client";
import { buildPresetConfig, getPreset, MIN_LP_LOCK_PCT } from "./presets";
import type { LaunchFormInput, PreparedLaunch } from "./types";

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
 * Quote is always WSOL — SOL-only MVP; USDC quote is not wired.
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
  const uri = input.uri.trim() || "https://equicurve.dev/metadata.json";
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
    };

    if (seedBuySol > 0) {
      const buyAmount = new BN(Math.round(seedBuySol * 1e9));
      const tx = await client.creator.createPoolWithFirstBuy({
        createPoolParam,
        firstBuyParam: {
          buyer: payer,
          buyAmount,
          minimumAmountOut: new BN(0),
          referralTokenAccount: null,
        },
      });
      transactions.push(tx);
      signersPerTx.push([keypairs.baseMint]);
    } else {
      const tx = await client.creator.createPool(createPoolParam);
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
      mintRenounce,
      antiSniper,
    });

    const baseParams = {
      ...curveConfig,
      config: keypairs.config.publicKey,
      feeClaimer: payer,
      leftoverReceiver: payer,
      quoteMint: WSOL_MINT,
      payer,
      preCreatePoolParam: {
        name,
        symbol,
        uri,
        poolCreator: payer,
        baseMint: keypairs.baseMint.publicKey,
      },
    };

    if (seedBuySol > 0) {
      const buyAmount = new BN(Math.round(seedBuySol * 1e9));
      const { createConfigTx, createPoolWithFirstBuyTx } =
        await client.partner.createConfigAndPoolWithFirstBuy({
          ...baseParams,
          firstBuyParam: {
            buyer: payer,
            buyAmount,
            minimumAmountOut: new BN(0),
            referralTokenAccount: null,
          },
        });

      transactions.push(createConfigTx, createPoolWithFirstBuyTx);
      signersPerTx.push(
        [keypairs.config],
        [keypairs.config, keypairs.baseMint],
      );
    } else {
      const tx = await client.partner.createConfigAndPool(baseParams);
      transactions.push(tx);
      signersPerTx.push([keypairs.config, keypairs.baseMint]);
    }
  }

  const pool = deriveDbcPoolAddress(
    WSOL_MINT,
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
      quoteMint: WSOL_MINT.toBase58(),
      quoteLabel: "SOL",
      lpLockPct,
      creatorTradingFeePercentage,
      mintRenounce,
      seedBuySol,
      summary: {
        name,
        symbol,
        uri,
        initialMarketCapUsd: preset.initialMarketCap,
        migrationMarketCapUsd: preset.migrationMarketCap,
        feeLabel: preset.feeLabel,
        migration: `DAMM v2 · partner LP lock ${lpLockPct}%`,
      },
    },
    keypairs,
    transactions,
    signersPerTx,
  };
}
