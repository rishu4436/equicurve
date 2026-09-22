import { deriveDbcPoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  Keypair,
  PublicKey,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { getOptionalPoolConfigKey, WSOL_MINT } from "@/lib/constants";
import { EquiCurveError } from "@/lib/errors";
import { getDbcClient } from "./client";
import { buildPresetConfig, getPreset } from "./presets";
import type { LaunchFormInput, PreparedLaunch } from "./types";

export type LaunchKeypairs = {
  config: Keypair;
  baseMint: Keypair;
};

export async function prepareLaunchTransaction(args: {
  connection: Connection;
  payer: PublicKey;
  input: LaunchFormInput;
  keypairs?: LaunchKeypairs;
}): Promise<{
  prepared: PreparedLaunch;
  keypairs: LaunchKeypairs;
  tx: Transaction;
}> {
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

  const client = getDbcClient(connection);
  const existingConfig = getOptionalPoolConfigKey();
  const keypairs =
    args.keypairs ??
    ({
      config: Keypair.generate(),
      baseMint: Keypair.generate(),
    } satisfies LaunchKeypairs);

  const preset = getPreset(input.presetId);
  let tx: Transaction;
  let mode: PreparedLaunch["mode"];
  let configPubkey: PublicKey;

  if (existingConfig) {
    mode = "pool-only";
    configPubkey = existingConfig;
    tx = await client.creator.createPool({
      name,
      symbol,
      uri,
      payer,
      poolCreator: payer,
      config: existingConfig,
      baseMint: keypairs.baseMint.publicKey,
    });
  } else {
    mode = "config-and-pool";
    configPubkey = keypairs.config.publicKey;
    const curveConfig = buildPresetConfig(input.presetId, {
      totalTokenSupply: input.totalSupply || 1_000_000_000,
    });

    tx = await client.partner.createConfigAndPool({
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
    });
  }

  const pool = deriveDbcPoolAddress(
    WSOL_MINT,
    keypairs.baseMint.publicKey,
    configPubkey,
  );

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;

  if (mode === "config-and-pool") {
    tx.partialSign(keypairs.config, keypairs.baseMint);
  } else {
    tx.partialSign(keypairs.baseMint);
  }

  return {
    prepared: {
      mode,
      presetId: input.presetId,
      configPubkey: configPubkey.toBase58(),
      baseMintPubkey: keypairs.baseMint.publicKey.toBase58(),
      poolPubkey: pool.toBase58(),
      summary: {
        name,
        symbol,
        uri,
        initialMarketCapUsd: preset.initialMarketCap,
        migrationMarketCapUsd: preset.migrationMarketCap,
        feeLabel: preset.feeLabel,
        migration: "DAMM v2 @ 100 bps fee config",
      },
    },
    keypairs,
    tx,
  };
}
