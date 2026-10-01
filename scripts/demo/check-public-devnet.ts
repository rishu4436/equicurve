/**
 * Public-devnet readiness check. Separate from the local journey.
 *
 *   npm run demo:devnet
 *
 * Confirms the Meteora programs on https://api.devnet.solana.com, then the
 * payer balance. A faucet 429 is recorded as FUNDING_BLOCKED and exit code 2.
 * That is an external funding dependency. It is not a local-demo failure.
 * A funded payer is simulated with the saved brief. Pass --send to submit that
 * same transaction on public devnet and read the pool back. Without --send,
 * nothing is submitted. This script never falls back to 127.0.0.1.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Sector } from "@/lib/demo/offerings";
import type { ExpectedMarketConfig } from "@/lib/dbc/deploymentReadback";
import type { PresetId } from "@/lib/dbc/types";
import { expectMismatches, loadBriefAt, loadSavedBrief } from "./saved-brief";

const ROOT = process.cwd();
const RPC = "https://api.devnet.solana.com";
let evidenceDir = resolve(ROOT, "demo-evidence", "public-devnet");
const MIN_LAMPORTS = 200_000_000;
const PROGRAMS = [
  { name: "Meteora Dynamic Bonding Curve", id: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN" },
  { name: "Meteora DAMM v2", id: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" },
  { name: "Metaplex Token Metadata", id: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" },
] as const;

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function writeStatus(status: unknown) {
  mkdirSync(evidenceDir, { recursive: true });
  const path = resolve(evidenceDir, "status.json");
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path}`);
}

const sendRequested = process.argv.includes("--send");
let inflight: Record<string, unknown> | null = null;

type Check = { name: string; expected: string; actual: string; ok: boolean };

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return String(value);
  if (typeof value === "object" && "toString" in value) {
    const rendered = (value as { toString(radix?: number): string }).toString(10);
    if (rendered !== "[object Object]") return rendered;
  }
  return String(value);
}

function flag(value: unknown): string {
  const rendered = text(value).toLowerCase();
  if (rendered === "true" || rendered === "1") return "1";
  if (rendered === "false" || rendered === "0") return "0";
  return rendered;
}

function livePoints(curve: unknown): string {
  if (!Array.isArray(curve)) return "";
  const parts: string[] = [];
  for (const point of curve) {
    const sqrt = text((point as { sqrtPrice?: unknown }).sqrtPrice);
    const liquidity = text((point as { liquidity?: unknown }).liquidity);
    if ((sqrt === "" || sqrt === "0") && (liquidity === "" || liquidity === "0")) continue;
    parts.push(`${sqrt}:${liquidity}`);
  }
  return parts.join(",");
}

function jsonSafe(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    const name = (value as { constructor?: { name?: string } }).constructor?.name;
    if (name === "BN" || name === "PublicKey") {
      return (value as { toString(radix?: number): string }).toString(name === "BN" ? 10 : undefined);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = jsonSafe(item);
    return out;
  }
  return String(value);
}

function writeNamed(name: string, value: unknown) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(resolve(evidenceDir, name), `${JSON.stringify(jsonSafe(value), null, 2)}\n`, "utf8");
}

async function registerRecordedLaunch(
  payer: Keypair,
  recorded: {
    pool: string;
    mint: string;
    name: string;
    ticker: string;
    thesis: string;
    sector: Sector;
    presetId: PresetId;
    raiseTarget: number;
    fingerprint: string;
    migrationQuoteThresholdAtoms: string;
    canonicalConfig: string;
    expected: ExpectedMarketConfig;
    profileName: string;
    constraintsPassed: boolean;
    transaction: string;
  },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const { buildLaunchAuthMessage } = await import("@/lib/auth/launchAuth");
  const nacl = (await import("tweetnacl")).default;
  const bs58 = (await import("bs58")).default;
  const issuedAt = new Date().toISOString();
  const signer = payer.publicKey.toBase58();
  const payload = {
    v: 1 as const,
    action: "launch" as const,
    cluster: "devnet" as const,
    pool: recorded.pool,
    mint: recorded.mint,
    profile: {
      name: recorded.name,
      ticker: recorded.ticker,
      thesis: recorded.thesis,
      sector: recorded.sector,
      presetId: recorded.presetId,
      raiseTarget: recorded.raiseTarget,
    },
    design: {
      fingerprint: recorded.fingerprint,
      migrationQuoteThresholdAtoms: recorded.migrationQuoteThresholdAtoms,
      canonicalConfig: recorded.canonicalConfig,
      expected: recorded.expected,
      profileName: recorded.profileName,
      constraintsPassed: recorded.constraintsPassed,
      transaction: recorded.transaction,
    },
  };
  const message = buildLaunchAuthMessage(payload, signer, issuedAt);
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), payer.secretKey));
  const app = process.env.EQUICURVE_APP_URL?.trim() || "https://equicurve.vercel.app";
  try {
    const res = await fetch(`${app}/api/launches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload, auth: { signer, signature, issuedAt } }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) };
  }
}

function walletFor(payer: Keypair): WalletContextState {
  return {
    publicKey: payer.publicKey,
    connected: true,
    signTransaction: async <T,>(tx: T) => {
      (tx as unknown as Transaction).partialSign(payer);
      return tx;
    },
  } as unknown as WalletContextState;
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
  const briefArg = argValue("--brief");
  const outArg = argValue("--out");
  if (briefArg && !outArg) {
    throw new Error("Pass --out with --brief so a second design does not overwrite demo-evidence/public-devnet.");
  }
  if (outArg) evidenceDir = resolve(ROOT, outArg);
  process.env.NEXT_PUBLIC_RPC_URL = RPC;
  delete process.env.NEXT_PUBLIC_POOL_CONFIG_KEY;
  process.env.NEXT_PUBLIC_CLUSTER = "devnet";

  const saved = briefArg ? loadBriefAt(resolve(ROOT, briefArg)) : loadSavedBrief(ROOT);
  const { Connection } = await import("@solana/web3.js");
  const connection = new Connection(RPC, {
    commitment: "confirmed",
    disableRetryOnRateLimit: !sendRequested,
  });
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
  const { buildLaunchReview } = await import("@/lib/dbc/launchReview");
  const { WSOL_MINT } = await import("@/lib/constants");
  const { setFreshBlockhash, signAndSendTransaction } = await import("@/lib/send");
  const policy = designPolicy(saved.brief);
  const mismatches = saved.expect ? expectMismatches(policy, saved.expect) : [];
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
  const review = buildLaunchReview({
    presetId: policy.chosen.recipe.presetId,
    quote: saved.brief.quote,
    quoteMint: WSOL_MINT.toBase58(),
    transferProfile: saved.launch.transferProfile,
    totalSupply: policy.chosen.recipe.totalSupply,
    creatorPct: policy.chosen.recipe.creatorTradingFeePercentage,
    lpLockPct: policy.chosen.recipe.lpLockPct,
    mintRenounce: saved.launch.mintRenounce,
    antiSniper: policy.chosen.recipe.antiSniper,
    feeClaimer: "",
    wallet: payer.publicKey.toBase58(),
    seedBuy: saved.launch.seedBuyAmount,
    cluster: "devnet",
    sharedConfig: null,
    marketCaps: {
      initial: policy.chosen.recipe.initialMarketCap,
      migration: policy.chosen.recipe.migrationMarketCap,
    },
  });
  if (review.configFingerprint !== fingerprint || review.errors.length > 0) {
    writeStatus({
      ...base,
      status: "FINGERPRINT_MISMATCH",
      simulation: "not run",
      reviewFingerprint: review.configFingerprint,
      reviewErrors: review.errors,
    });
    console.error("Policy review does not match the selected design. Nothing was simulated or sent.");
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
  if (bundle.prepared.summary.migrationQuoteThresholdAtoms !== policy.chosen.thresholdAtoms) {
    writeStatus({ ...base, status: "THRESHOLD_MISMATCH", simulation: "not run" });
    console.error("Transaction threshold does not match the selected design. Nothing was simulated or sent.");
    process.exit(1);
  }
  const first = bundle.transactions[0];
  const firstSigners = bundle.signersPerTx[0] ?? [];
  const simTx = new Transaction({ feePayer: payer.publicKey });
  simTx.add(...first.instructions);
  await setFreshBlockhash(connection, simTx, payer.publicKey);
  if (firstSigners.length > 0) simTx.partialSign(...firstSigners);
  simTx.partialSign(payer);
  const simulation = await connection.simulateTransaction(simTx);
  const preview = {
    err: simulation.value.err,
    logs: simulation.value.logs,
    unitsConsumed: simulation.value.unitsConsumed,
    sent: false,
  };
  if (simulation.value.err) {
    writeStatus({
      ...base,
      status: "SIMULATION_FAILED",
      simulation: preview,
      readback: "not run — simulation failed, so nothing was sent",
      selectedFingerprint: fingerprint,
      pool: bundle.prepared.poolPubkey,
      config: bundle.prepared.configPubkey,
    });
    console.error(`Public devnet simulation failed: ${JSON.stringify(simulation.value.err)}`);
    process.exit(1);
  }
  if (!sendRequested) {
    writeStatus({
      ...base,
      status: "SIMULATION_OK",
      simulation: preview,
      readback: "not run — the transaction was simulated and was not sent, so there is no public-devnet pool to read back",
      selectedFingerprint: fingerprint,
      pool: bundle.prepared.poolPubkey,
      config: bundle.prepared.configPubkey,
    });
    console.log("Public devnet simulation succeeded. The transaction was not sent. Re-run with --send to deploy.");
    return;
  }

  inflight = {
    pool: bundle.prepared.poolPubkey,
    config: bundle.prepared.configPubkey,
    baseMint: bundle.prepared.baseMintPubkey,
    signatures: [],
  };
  const { decodeTransactionSwaps } = await import("@/lib/dbc/seedQuote");
  const { DBC_PROGRAM_ID } = await import("@/lib/constants");
  const signatures: string[] = [];
  for (let i = 0; i < bundle.transactions.length; i++) {
    const tx = bundle.transactions[i];
    const signers = bundle.signersPerTx[i] ?? [];
    await setFreshBlockhash(connection, tx, payer.publicKey);
    if (signers.length > 0) tx.partialSign(...signers);
    const seedSwaps = decodeTransactionSwaps(tx, DBC_PROGRAM_ID);
    if (seedSwaps.length > 0) {
      const simCopy = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: tx.recentBlockhash,
      });
      simCopy.add(...tx.instructions);
      if (signers.length > 0) simCopy.partialSign(...signers);
      simCopy.partialSign(payer);
      const seedSim = await connection.simulateTransaction(simCopy);
      if (seedSim.value.err) {
        writeStatus({
          ...base,
          status: "SEED_BUY_SIMULATION_FAILED",
          simulation: {
            err: seedSim.value.err,
            logs: seedSim.value.logs,
            unitsConsumed: seedSim.value.unitsConsumed,
            sent: false,
            minimumAmountOut: seedSwaps[0].minimumAmountOut.toString(),
            expectedOut: bundle.prepared.seedBuyExpectedOutAtoms,
            slippageBps: bundle.prepared.seedBuySlippageBps,
          },
          signatures,
          pool: bundle.prepared.poolPubkey,
          config: bundle.prepared.configPubkey,
        });
        console.error(
          `Seed-buy simulation failed before send: ${JSON.stringify(seedSim.value.err)}. minimumAmountOut ${seedSwaps[0].minimumAmountOut.toString()}.`,
        );
        process.exit(1);
      }
    }
    const signature = await signAndSendTransaction({
      connection,
      wallet: walletFor(payer),
      tx,
    });
    signatures.push(signature);
    inflight = { ...inflight, signatures };
    console.log(`Sent public-devnet transaction ${i + 1}/${bundle.transactions.length}: ${signature}`);
  }

  const { fetchPoolSnapshot } = await import("@/lib/dbc/migrate");
  const { getDbcClient } = await import("@/lib/dbc/client");
  const snapshot = await fetchPoolSnapshot(connection, new PublicKey(bundle.prepared.poolPubkey));
  const onChain = await getDbcClient(connection).state.getPoolConfig(new PublicKey(bundle.prepared.configPubkey));
  if (!onChain) throw new Error("Pool config account was not readable after the public-devnet deploy.");
  const chain = onChain as unknown as Record<string, unknown>;
  const builtRecord = builtConfig as unknown as Record<string, unknown>;
  const builtFees = (builtRecord.poolFees ?? {}) as { baseFee?: Record<string, unknown>; dynamicFee?: Record<string, unknown> | null };
  const chainFees = (chain.poolFees ?? {}) as { baseFee?: Record<string, unknown>; dynamicFee?: Record<string, unknown> | null };
  const checks: Check[] = [];
  const check = (name: string, expected: unknown, actual: unknown, normalize: (value: unknown) => string = text) => {
    const left = normalize(expected);
    const right = normalize(actual);
    checks.push({ name, expected: left, actual: right, ok: left === right });
  };
  check("pool", bundle.prepared.poolPubkey, snapshot.pool);
  check("config", bundle.prepared.configPubkey, snapshot.config);
  check("baseMint", bundle.prepared.baseMintPubkey, snapshot.baseMint);
  check("quoteMint", WSOL_MINT.toBase58(), chain.quoteMint);
  check("snapshot.quoteMint", WSOL_MINT.toBase58(), snapshot.quoteMint);
  check("migrationQuoteThreshold", builtRecord.migrationQuoteThreshold, chain.migrationQuoteThreshold);
  check("snapshot.migrationQuoteThreshold", policy.chosen.thresholdAtoms, snapshot.migrationQuoteThreshold);
  check("sqrtStartPrice", builtRecord.sqrtStartPrice, chain.sqrtStartPrice);
  check("creatorTradingFeePercentage", builtRecord.creatorTradingFeePercentage, chain.creatorTradingFeePercentage);
  check("partnerPermanentLockedLiquidityPercentage", builtRecord.partnerPermanentLockedLiquidityPercentage, chain.partnerPermanentLockedLiquidityPercentage);
  check("partnerLiquidityPercentage", builtRecord.partnerLiquidityPercentage, chain.partnerLiquidityPercentage);
  check("creatorPermanentLockedLiquidityPercentage", builtRecord.creatorPermanentLockedLiquidityPercentage, chain.creatorPermanentLockedLiquidityPercentage);
  check("creatorLiquidityPercentage", builtRecord.creatorLiquidityPercentage, chain.creatorLiquidityPercentage);
  check("enableFirstSwapWithMinFee", builtRecord.enableFirstSwapWithMinFee, chain.enableFirstSwapWithMinFee, flag);
  check("collectFeeMode", builtRecord.collectFeeMode, chain.collectFeeMode);
  check("migrationOption", builtRecord.migrationOption, chain.migrationOption);
  if (bundle.prepared.seedBuyAtoms === "0") {
    check("quoteReserve", "0", snapshot.quoteReserve);
  } else {
    const reserve = text(snapshot.quoteReserve);
    checks.push({
      name: "quoteReserve",
      expected: "> 0",
      actual: reserve,
      ok: reserve !== "" && reserve !== "0",
    });
    const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const swaps = bundle.transactions.flatMap((tx) => decodeTransactionSwaps(tx, DBC_PROGRAM_ID));
    const encoded = swaps.length === 1 ? swaps[0] : null;
    checks.push({
      name: "seedBuy.swapCount",
      expected: "1",
      actual: String(swaps.length),
      ok: swaps.length === 1,
    });
    checks.push({
      name: "seedBuy.amountIn",
      expected: bundle.prepared.seedBuyAtoms,
      actual: encoded ? encoded.amountIn.toString() : "missing",
      ok: encoded?.amountIn.toString() === bundle.prepared.seedBuyAtoms,
    });
    checks.push({
      name: "seedBuy.minimumAmountOut",
      expected: bundle.prepared.seedBuyMinimumOutAtoms,
      actual: encoded ? encoded.minimumAmountOut.toString() : "missing",
      ok:
        !!encoded &&
        encoded.minimumAmountOut > 0n &&
        encoded.minimumAmountOut.toString() === bundle.prepared.seedBuyMinimumOutAtoms &&
        bundle.prepared.seedBuyMinimumOutAtoms === bundle.prepared.seedBuyExpectedOutAtoms &&
        bundle.prepared.seedBuySlippageBps === 0,
    });
    const tokenProgram = saved.launch.transferProfile === "open-spl" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(bundle.prepared.baseMintPubkey),
      payer.publicKey,
      false,
      tokenProgram,
    );
    const received = BigInt((await connection.getTokenAccountBalance(ata, "confirmed")).value.amount);
    const minimum = BigInt(bundle.prepared.seedBuyMinimumOutAtoms);
    checks.push({
      name: "seedBuy.received",
      expected: bundle.prepared.seedBuyExpectedOutAtoms,
      actual: received.toString(),
      ok: received >= minimum && received === BigInt(bundle.prepared.seedBuyExpectedOutAtoms),
    });
  }
  check("isMigrated", "false", String(snapshot.isMigrated));
  for (const field of ["cliffFeeNumerator", "firstFactor", "secondFactor", "thirdFactor", "baseFeeMode"]) {
    check(`baseFee.${field}`, builtFees.baseFee?.[field], chainFees.baseFee?.[field]);
  }
  const dynamicFields = ["initialized", "binStep", "binStepU128", "variableFeeControl", "filterPeriod", "decayPeriod", "reductionFactor", "maxVolatilityAccumulator"];
  if (!builtFees.dynamicFee && !chainFees.dynamicFee) {
    checks.push({ name: "dynamicFee", expected: "none", actual: "none", ok: true });
  } else {
    for (const field of dynamicFields) {
      if (field === "initialized") {
        const configured = text(builtFees.dynamicFee?.[field]);
        const actual = flag(chainFees.dynamicFee?.[field]);
        const ok = configured === "" ? actual === "1" : flag(configured) === actual;
        checks.push({
          name: "dynamicFee.initialized",
          expected: configured === "" ? "1" : flag(configured),
          actual,
          ok,
        });
        continue;
      }
      check(`dynamicFee.${field}`, builtFees.dynamicFee?.[field], chainFees.dynamicFee?.[field]);
    }
  }
  check("curve.livePoints", livePoints(builtRecord.curve), livePoints(chain.curve));
  const failed = checks.filter((item) => !item.ok);
  const deployment = {
    environment: "public-devnet",
    rpc: RPC,
    signatures,
    explorer: signatures.map((signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`),
    pool: bundle.prepared.poolPubkey,
    poolExplorer: `https://explorer.solana.com/address/${bundle.prepared.poolPubkey}?cluster=devnet`,
    config: bundle.prepared.configPubkey,
    baseMint: bundle.prepared.baseMintPubkey,
    metadataUri: bundle.prepared.summary.uri,
    migrationQuoteThresholdAtoms: bundle.prepared.summary.migrationQuoteThresholdAtoms,
    selectedFingerprint: fingerprint,
    mode: bundle.prepared.mode,
    seedBuyAtoms: bundle.prepared.seedBuyAtoms,
    seedBuyExpectedOutAtoms: bundle.prepared.seedBuyExpectedOutAtoms,
    seedBuyMinimumOutAtoms: bundle.prepared.seedBuyMinimumOutAtoms,
    seedBuySlippageBps: bundle.prepared.seedBuySlippageBps,
  };
  writeNamed("deployment.json", deployment);
  writeNamed("readback.json", { snapshot, config: onChain });
  writeNamed("assertions.json", { ok: failed.length === 0, checks });
  writeStatus({
    ...base,
    status: failed.length === 0 ? "PUBLIC_DEVNET_OK" : "ASSERTION_FAILED",
    simulation: { ...preview, sent: true },
    readback: failed.length === 0 ? "on-chain pool and config match the selected design" : "sent, then readback did not match",
    ...deployment,
    failedAssertions: failed,
  });
  if (failed.length > 0) {
    console.error(
      `On-chain values do not match the selected design.\n${failed
        .map((item) => `${item.name}: expected ${item.expected}, chain has ${item.actual}`)
        .join("\n")}`,
    );
    process.exit(1);
  }
  try {
  const landed = await connection.getTransaction(signatures[0], {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const deployedAt = landed?.blockTime ? new Date(landed.blockTime * 1000).toISOString() : new Date().toISOString();
  const sector =
    saved.launch.sector ??
    (saved.brief.asset === "rwa"
      ? "RWA"
      : saved.brief.asset === "tokenized-equity"
        ? "Equity"
        : saved.brief.asset === "private-company"
          ? "Private Co"
          : "Other");
  const thesis =
    saved.launch.thesis ??
    (policy.chosen.feasible
      ? "Public-devnet deployment. The selected design met the issuer constraints, and the on-chain readback matched it."
      : "Public-devnet deployment. The preferred candidate missed an issuer constraint. The on-chain readback matched that design.");
  const { canonicalConfigText, expectedFromConfig } = await import("@/lib/dbc/deploymentReadback");
  const recorded = {
    network: "Solana Devnet" as const,
    cluster: "devnet" as const,
    pool: bundle.prepared.poolPubkey,
    config: bundle.prepared.configPubkey,
    mint: bundle.prepared.baseMintPubkey,
    creator: payer.publicKey.toBase58(),
    transaction: signatures[0],
    fingerprint,
    migrationQuoteThresholdAtoms: bundle.prepared.summary.migrationQuoteThresholdAtoms,
    profileName: policy.chosen.profileName,
    name: saved.launch.name,
    ticker: saved.launch.symbol,
    thesis,
    sector,
    presetId: policy.chosen.recipe.presetId,
    raiseTarget: Number(saved.brief.targetRaise),
    quote: saved.brief.quote,
    constraintsPassed: policy.chosen.feasible,
    readbackPassed: true,
    checks: {
      fingerprint: true,
      poolConfiguration: true,
      migrationThreshold: true,
      readback: true,
    },
    canonicalConfig: canonicalConfigText(builtConfig),
    expected: expectedFromConfig(builtConfig),
    deployedAt,
  };
  const catalogPath = resolve(ROOT, "src/lib/registry/publicDeployments.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { pool: string }[];
  writeFileSync(
    catalogPath,
    `${JSON.stringify([...catalog.filter((row) => row.pool !== recorded.pool), recorded], null, 2)}\n`,
    "utf8",
  );
  writeNamed("manifest.json", {
    network: "Solana Devnet",
    rpc: RPC,
    cluster: "devnet",
    result: "All readback assertions passed.",
    slot: landed?.slot ?? null,
    blockTime: deployedAt,
    pool: recorded.pool,
    config: recorded.config,
    mint: recorded.mint,
    transaction: recorded.transaction,
    fingerprint,
    profileName: recorded.profileName,
    constraintsPassed: recorded.constraintsPassed,
    migrationQuoteThresholdAtoms: recorded.migrationQuoteThresholdAtoms,
    metadataUri: bundle.prepared.summary.uri,
    files: ["README.md", "manifest.json", "assertions.json", "deployment.json", "readback.json"],
  });
  writeFileSync(
    resolve(evidenceDir, "README.md"),
    [
      "# Public devnet proof",
      "",
      "Network: Solana Devnet",
      `RPC: ${RPC}`,
      "",
      `Pool: ${recorded.pool}`,
      `Config: ${recorded.config}`,
      `Mint: ${recorded.mint}`,
      `Transaction: ${recorded.transaction}`,
      `Fingerprint: ${fingerprint}`,
      "",
      "Result:",
      "All readback assertions passed.",
      "",
      `Confirmed at slot ${landed?.slot ?? "unknown"} on ${deployedAt}. Profile ${recorded.profileName}. Migration threshold ${recorded.migrationQuoteThresholdAtoms} lamports.`,
      recorded.constraintsPassed
        ? "The selected design met the issuer constraints in the search."
        : "The selected design is the preferred candidate. It did not meet every issuer constraint. The assertions check that the chain matches that design.",
      "",
      `Pool: https://explorer.solana.com/address/${recorded.pool}?cluster=devnet`,
      `Transaction: https://explorer.solana.com/tx/${recorded.transaction}?cluster=devnet`,
      "",
    ].join("\n"),
    "utf8",
  );
  const registry = await registerRecordedLaunch(payer, recorded);
  writeNamed("registry.json", registry);
  console.log(`Registry: ${registry.ok ? "accepted" : "not stored on the server"} (${registry.status}). Explore reads the creator-signed design from the registry. The static catalog is a fallback.`);
  console.log("PUBLIC_DEVNET_OK");
  console.log(`Pool ${bundle.prepared.poolPubkey}`);
  console.log(deployment.poolExplorer);
  console.log(`Transaction ${signatures[signatures.length - 1]}`);
  console.log(deployment.explorer[deployment.explorer.length - 1]);
  } catch (recordError) {
    const recordMessage = recordError instanceof Error ? recordError.message : String(recordError);
    console.error(`Chain proof is already saved. Recording it for Explore failed: ${recordMessage}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  writeStatus({
    environment: "public-devnet",
    rpc: RPC,
    status: "ERROR",
    error: message,
    inflight,
    note: "This error is about the public-devnet check only. It does not change the local-validator result.",
  });
  console.error(message);
  process.exit(1);
});
