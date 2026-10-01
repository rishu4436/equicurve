/**
 * Public-devnet readiness check. Separate from the local journey.
 *
 *   npm run demo:devnet
 *
 * Confirms the Meteora programs on https://api.devnet.solana.com, then the
 * payer balance. A faucet 429 is recorded as FUNDING_BLOCKED and exit code 2.
 * That is an external funding dependency. It is not a local-demo failure.
 * A funded payer is simulated with the saved brief. The transaction is not sent,
 * so this script does not create a public pool. It never falls back to 127.0.0.1.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { expectMismatches, loadSavedBrief } from "./saved-brief";

const ROOT = process.cwd();
const RPC = "https://api.devnet.solana.com";
const OUT = resolve(ROOT, "demo-evidence", "public-devnet", "status.json");
const MIN_LAMPORTS = 200_000_000;
const PROGRAMS = [
  { name: "Meteora Dynamic Bonding Curve", id: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN" },
  { name: "Meteora DAMM v2", id: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" },
  { name: "Metaplex Token Metadata", id: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" },
] as const;

function writeStatus(status: unknown) {
  mkdirSync(resolve(ROOT, "demo-evidence", "public-devnet"), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUT}`);
}

function loadPayer(): Keypair {
  const path =
    process.env.DEMO_KEYPAIR?.trim() ||
    resolve(process.env.USERPROFILE ?? "", ".config", "solana", "unseal-devnet.json");
  const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  if (new URL(RPC).hostname === "127.0.0.1" || new URL(RPC).hostname === "localhost") {
    throw new Error("demo:devnet refuses a local RPC.");
  }
  process.env.NEXT_PUBLIC_RPC_URL = RPC;
  delete process.env.NEXT_PUBLIC_POOL_CONFIG_KEY;
  process.env.NEXT_PUBLIC_CLUSTER = "devnet";

  const saved = loadSavedBrief(ROOT);
  const { Connection } = await import("@solana/web3.js");
  const connection = new Connection(RPC, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const programs = [];
  for (const program of PROGRAMS) {
    const info = await connection.getAccountInfo(new PublicKey(program.id), "confirmed");
    programs.push({
      ...program,
      executable: info?.executable ?? false,
      owner: info?.owner.toBase58() ?? null,
      dataLength: info?.data.length ?? 0,
    });
  }
  const missing = programs.filter((item) => !item.executable);
  const payer = loadPayer();
  let balance = await connection.getBalance(payer.publicKey, "confirmed");
  let airdrop: { attempted: boolean; ok: boolean; error: string | null } = {
    attempted: false,
    ok: false,
    error: null,
  };
  if (balance < MIN_LAMPORTS) {
    airdrop = { attempted: true, ok: false, error: null };
    try {
      const signature = await connection.requestAirdrop(payer.publicKey, 1_000_000_000);
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction(
        { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        "confirmed",
      );
      airdrop = { attempted: true, ok: true, error: null };
      balance = await connection.getBalance(payer.publicKey, "confirmed");
    } catch (error) {
      airdrop = {
        attempted: true,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const base = {
    environment: "public-devnet",
    rpc: RPC,
    note: "This file is a public-devnet readiness check. It is not evidence about the local validator journey. A faucet 429 means funding is an external dependency.",
    payer: payer.publicKey.toBase58(),
    balanceLamports: balance,
    minimumLamports: MIN_LAMPORTS,
    airdrop,
    programs,
    savedExpect: saved.expect,
    simulation: null as unknown,
    readback: "not run — no public-devnet transaction was sent",
  };

  if (missing.length > 0) {
    writeStatus({ ...base, status: "PROGRAMS_MISSING", missing: missing.map((item) => item.name) });
    console.error(`Public devnet is missing executable programs: ${missing.map((item) => item.name).join(", ")}.`);
    process.exit(1);
  }
  if (balance < MIN_LAMPORTS) {
    writeStatus({
      ...base,
      status: "FUNDING_BLOCKED",
      detail:
        "The payer cannot pay for a public-devnet deployment. If the faucet returned 429, that rate limit is outside this repo. The local validator journey is a separate result.",
    });
    console.error(
      `FUNDING_BLOCKED on public devnet. Payer ${payer.publicKey.toBase58()} has ${balance} lamports. Airdrop: ${airdrop.error ?? "not attempted"}. This does not mean the local deployment failed.`,
    );
    process.exit(2);
  }

  const { designPolicy, materializeRecipe, parseBrief } = await import("@/lib/market");
  const { marketConfigFingerprint } = await import("@/lib/dbc/configFingerprint");
  const { launchCurveConfig, prepareLaunchTransaction } = await import("@/lib/dbc/create");
  const { setFreshBlockhash } = await import("@/lib/send");
  const policy = designPolicy(saved.brief);
  const mismatches = expectMismatches(policy, saved.expect);
  if (mismatches.length > 0) {
    writeStatus({ ...base, status: "BRIEF_MISMATCH", mismatches, simulation: "not run" });
    console.error(`Saved brief does not match the search. Nothing was simulated.\n${mismatches.join("\n")}`);
    process.exit(1);
  }
  const parsed = parseBrief(saved.brief);
  const fingerprint = marketConfigFingerprint(
    launchCurveConfig({
      presetId: policy.chosen.recipe.presetId,
      totalSupply: policy.chosen.recipe.totalSupply,
      creatorTradingFeePercentage: policy.chosen.recipe.creatorTradingFeePercentage,
      lpLockPct: policy.chosen.recipe.lpLockPct,
      mintRenounce: saved.launch.mintRenounce,
      antiSniper: policy.chosen.recipe.antiSniper,
      quoteDecimals: parsed.decimals,
      transferProfile: saved.launch.transferProfile,
      marketCaps: {
        initial: policy.chosen.recipe.initialMarketCap,
        migration: policy.chosen.recipe.migrationMarketCap,
      },
    }),
  );
  if (fingerprint !== policy.chosen.configFingerprint) {
    writeStatus({ ...base, status: "FINGERPRINT_MISMATCH", fingerprint, simulation: "not run" });
    console.error("Transaction builder fingerprint does not match the selected design. Nothing was simulated.");
    process.exit(1);
  }
  const builtConfig = materializeRecipe(policy.chosen.recipe);
  if (marketConfigFingerprint(builtConfig) !== fingerprint) {
    writeStatus({ ...base, status: "FINGERPRINT_MISMATCH", simulation: "not run" });
    console.error("Recipe fingerprint does not match the selected design. Nothing was simulated.");
    process.exit(1);
  }

  const bundle = await prepareLaunchTransaction({
    connection,
    payer: payer.publicKey,
    input: {
      name: saved.launch.name,
      symbol: saved.launch.symbol,
      uri: saved.launch.uri,
      presetId: policy.chosen.recipe.presetId,
      totalSupply: saved.brief.totalSupply,
      creatorTradingFeePercentage: policy.chosen.recipe.creatorTradingFeePercentage,
      lpLockPct: policy.chosen.recipe.lpLockPct,
      mintRenounce: saved.launch.mintRenounce,
      seedBuyAmount: saved.launch.seedBuyAmount,
      antiSniper: policy.chosen.recipe.antiSniper,
      quoteLabel: saved.brief.quote,
      transferProfile: saved.launch.transferProfile,
      marketCaps: {
        initial: policy.chosen.recipe.initialMarketCap,
        migration: policy.chosen.recipe.migrationMarketCap,
      },
    },
  });
  if (bundle.prepared.summary.uri !== saved.launch.uri) {
    writeStatus({ ...base, status: "URI_SUBSTITUTED", simulation: "not run" });
    console.error("prepareLaunchTransaction changed the saved metadata URI. Nothing was simulated.");
    process.exit(1);
  }
  const tx = bundle.transactions[0];
  const signers = bundle.signersPerTx[0] ?? [];
  await setFreshBlockhash(connection, tx, payer.publicKey);
  if (signers.length > 0) tx.partialSign(...signers);
  tx.partialSign(payer);
  const simulation = await connection.simulateTransaction(tx);
  writeStatus({
    ...base,
    status: simulation.value.err ? "SIMULATION_FAILED" : "SIMULATION_OK",
    simulation: {
      err: simulation.value.err,
      logs: simulation.value.logs,
      unitsConsumed: simulation.value.unitsConsumed,
      sent: false,
    },
    readback: "not run — the transaction was simulated and was not sent, so there is no public-devnet pool to read back",
    selectedFingerprint: fingerprint,
    pool: bundle.prepared.poolPubkey,
    config: bundle.prepared.configPubkey,
  });
  if (simulation.value.err) {
    console.error(`Public devnet simulation failed: ${JSON.stringify(simulation.value.err)}`);
    process.exit(1);
  }
  console.log("Public devnet simulation succeeded. The transaction was not sent.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  writeStatus({
    environment: "public-devnet",
    rpc: RPC,
    status: "ERROR",
    error: message,
    note: "This error is about the public-devnet check only. It does not change the local-validator result.",
  });
  console.error(message);
  process.exit(1);
});
