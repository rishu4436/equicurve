/**
 * One local-validator journey for the saved market brief.
 *
 *   npm run demo:local
 *
 * Connects to the WSL solana-test-validator, or starts it, without --reset.
 * A missing ledger is a first boot that clones Meteora programs from devnet.
 * An existing ledger is reused as-is. This script never sends to public devnet
 * and never replaces the saved metadata URI or the selected curve.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { expectMismatches, loadSavedBrief } from "./saved-brief";

const ROOT = process.cwd();
const RPC = "http://127.0.0.1:8899";
const LEDGER = "/home/rishu/equicurve-e2e/ledger";
const OUT_DIR = resolve(ROOT, "demo-evidence", "local-validator");
const ZIP = resolve(ROOT, "demo-evidence", "equicurve-local-validator-evidence.zip");
const PROGRAMS = [
  { name: "Meteora Dynamic Bonding Curve", id: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN" },
  { name: "Meteora DAMM v2", id: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" },
  { name: "Metaplex Token Metadata", id: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" },
] as const;
const SUPPORTING_ACCOUNTS = [
  "7F6dnUcRuyM2TwR8myT1dYypFXpPSxqwKNSFNkxyNESd",
  "2nHK1kju6XjphBLbNxpM5XRGFj7p9U8vvNzyZiha1z6k",
  "Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp",
  "2c4cYd4reUYVRAB9kUUkrq55VPyy2FNQ3FDL4o12JXmq",
  "AkmQWebAwFvWk55wBoCr5D62C6VVDTzi84NJuD9H7cFD",
  "DbCRBj8McvPYHJG1ukj8RE15h2dCNUdTAESG49XpQ44u",
  "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck",
  "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM",
  "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
];

type Check = { name: string; expected: string; actual: string; ok: boolean };

const evidence: Record<string, unknown> = {};
let failure: string | null = null;

function log(message: string) {
  console.log(message);
}

function die(message: string): never {
  failure = message;
  throw new Error(message);
}

function wsl(script: string): string {
  const result = spawnSync("wsl", ["-e", "bash", "-lc", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `wsl exited ${result.status}`).trim());
  }
  return result.stdout ?? "";
}

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

function writeJson(name: string, value: unknown) {
  writeFileSync(resolve(OUT_DIR, name), `${JSON.stringify(jsonSafe(value), null, 2)}\n`, "utf8");
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

async function rpcHealthy(): Promise<boolean> {
  try {
    const { Connection } = await import("@solana/web3.js");
    const connection = new Connection(RPC, "confirmed");
    await connection.getSlot("processed");
    return true;
  } catch {
    return false;
  }
}

function startValidator() {
  const ledger = wsl(`if test -d ${LEDGER}; then echo PRESENT; else echo MISSING; fi`).trim();
  const firstBoot = ledger !== "PRESENT";
  const cloneArgs = firstBoot
    ? [
        "--url",
        "https://api.devnet.solana.com",
        "--clone-upgradeable-program",
        "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
        "--clone-upgradeable-program",
        "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
        "--clone-upgradeable-program",
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
        ...SUPPORTING_ACCOUNTS.flatMap((id) => ["--clone", id]),
      ]
    : [];
  if (firstBoot) {
    log("Ledger directory is missing. First boot will clone Meteora programs from devnet. This does not reset an existing ledger.");
  } else {
    log("Starting the existing WSL ledger without --reset.");
  }
  const validatorArgs = ["--quiet", "--ledger", LEDGER, "--rpc-port", "8899", "--faucet-port", "9900", ...cloneArgs];
  if (validatorArgs.includes("--reset")) die("Refusing to start the validator because the arguments contain --reset.");
  const script = `export PATH=$HOME/.local/share/solana/install/active_release/bin:$PATH; mkdir -p /home/rishu/equicurve-e2e; exec solana-test-validator ${validatorArgs.join(" ")}`;
  mkdirSync(resolve(ROOT, "demo-evidence"), { recursive: true });
  const logFd = openSync(resolve(ROOT, "demo-evidence", "validator-process.log"), "a");
  const child = spawn("wsl", ["-e", "bash", "-lc", script], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  evidence.validatorStart = firstBoot ? "first-boot-clone" : "existing-ledger-no-reset";
}

async function waitForValidator() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (await rpcHealthy()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
  }
  let tail = "";
  try {
    tail = readFileSync(resolve(ROOT, "demo-evidence", "validator-process.log"), "utf8").slice(-4000);
  } catch {
    tail = "validator log was not readable";
  }
  die(`Local validator at ${RPC} did not become healthy. Ledger was not reset.\n${tail}`);
}

function loadPayer(): Keypair {
  const path =
    process.env.DEMO_KEYPAIR?.trim() ||
    resolve(process.env.USERPROFILE ?? "", ".config", "solana", "unseal-devnet.json");
  try {
    const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch {
    die(`Payer keypair was not readable at ${path}. Set DEMO_KEYPAIR to a Solana CLI keypair file. The secret is not printed.`);
  }
}

async function ensureLocalSol(connection: Connection, payer: Keypair): Promise<number> {
  const host = new URL(connection.rpcEndpoint).hostname;
  const balance = await connection.getBalance(payer.publicKey, "confirmed");
  evidence.payerBalanceLamportsBefore = balance;
  if (balance >= 2_000_000_000) return balance;
  if (host !== "127.0.0.1") {
    die(`Payer has ${balance} lamports and this script refuses to airdrop on ${host}.`);
  }
  log("Payer is below 2 SOL. Requesting a 5 SOL airdrop from the local validator only.");
  const signature = await connection.requestAirdrop(payer.publicKey, 5_000_000_000);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  const funded = await connection.getBalance(payer.publicKey, "confirmed");
  evidence.localAirdropSignature = signature;
  evidence.payerBalanceLamportsAfterAirdrop = funded;
  if (funded < 2_000_000_000) die(`Local airdrop confirmed but the payer still has ${funded} lamports.`);
  return funded;
}

function writeEvidence(checks: Check[]) {
  mkdirSync(OUT_DIR, { recursive: true });
  const saved = evidence.saved as { clusterLabel?: string; clusterNote?: string; brief?: { seed?: number } } | undefined;
  const lines = [
    "# EquiCurve local-validator evidence",
    "",
    "This bundle is the output of `npm run demo:local` for `scripts/demo/local-brief.json`.",
    "",
    `**Environment:** ${saved?.clusterLabel ?? "local validator"}. ${saved?.clusterNote ?? "This is not a public-devnet deployment."}`,
    "",
    `**Result:** ${failure ? `FAILED — ${failure}` : "PASSED. On-chain config matches the selected design."}`,
    "",
    `**Seed:** ${saved?.brief?.seed ?? "unknown"}. Cohort path i uses seed (brief seed + i * 997) mod 2^32. The path file is cohort-paths.json.`,
    "",
    "The search result is a tradeoff when no candidate meets every constraint. The bundle keeps that candidate for inspection and does not relabel it as fully feasible.",
    "",
    "Files: brief.json, assumptions.json, candidates.json, policy-review.json, selected-config.json, deployment.json, readback.json, assertions.json, environment.json, cohort-paths.json.",
    "",
  ];
  writeFileSync(resolve(OUT_DIR, "README.md"), lines.join("\n"), "utf8");
  for (const [name, value] of Object.entries(evidence)) {
    if (name === "saved") writeJson("brief.json", value);
    else if (name === "assumptions") writeJson("assumptions.json", value);
    else if (name === "candidates") writeJson("candidates.json", value);
    else if (name === "policyReview") writeJson("policy-review.json", value);
    else if (name === "selected") writeJson("selected-config.json", value);
    else if (name === "deployment") writeJson("deployment.json", value);
    else if (name === "readback") writeJson("readback.json", value);
    else if (name === "environment") writeJson("environment.json", value);
    else if (name === "cohortPaths") writeJson("cohort-paths.json", value);
  }
  try {
    rmSync(ZIP, { force: true });
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${OUT_DIR}\\*' -DestinationPath '${ZIP}' -Force`],
      { stdio: "inherit" },
    );
    log(`Evidence zip: ${ZIP}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!failure) failure = `Evidence files were written, but the zip failed: ${message}`;
    log(failure);
  }
  writeJson("assertions.json", { ok: checks.every((item) => item.ok) && !failure, failure, checks });
}

async function main() {
  process.env.NEXT_PUBLIC_RPC_URL = RPC;
  delete process.env.NEXT_PUBLIC_POOL_CONFIG_KEY;
  process.env.NEXT_PUBLIC_CLUSTER = "devnet";

  const saved = loadSavedBrief(ROOT);
  evidence.saved = saved;
  if (new URL(saved.rpc).hostname !== "127.0.0.1") {
    die(`Saved brief RPC is ${saved.rpc}. demo:local only runs against 127.0.0.1. Use npm run demo:devnet for public devnet.`);
  }

  log("1. Validator");
  if (await rpcHealthy()) {
    log("Connected to the validator already listening on 127.0.0.1:8899. Ledger was not reset.");
    evidence.validatorStart = evidence.validatorStart ?? "already-running-no-reset";
  } else {
    startValidator();
    await waitForValidator();
    log("Validator is healthy. Ledger was not reset.");
  }

  const { Connection } = await import("@solana/web3.js");
  const connection = new Connection(RPC, { commitment: "confirmed", confirmTransactionInitialTimeout: 60_000 });
  const { DBC_PROGRAM_ID, DAMM_V2_PROGRAM, WSOL_MINT, getOptionalPoolConfigKey } = await import("@/lib/constants");
  if (DBC_PROGRAM_ID.toBase58() !== PROGRAMS[0].id || DAMM_V2_PROGRAM.toBase58() !== PROGRAMS[1].id) {
    die("SDK program ids do not match the programs this demo verifies. Refusing to continue.");
  }
  if (getOptionalPoolConfigKey()) {
    die("NEXT_PUBLIC_POOL_CONFIG_KEY is set. It would ignore the searched market caps. Unset it. This script did not deploy.");
  }

  log("2. Programs");
  const programReports = [];
  for (const program of PROGRAMS) {
    const info = await connection.getAccountInfo(new PublicKey(program.id), "confirmed");
    programReports.push({
      ...program,
      exists: !!info,
      executable: info?.executable ?? false,
      owner: info?.owner.toBase58() ?? null,
      dataLength: info?.data.length ?? 0,
    });
  }
  const supportReports = [];
  for (const id of SUPPORTING_ACCOUNTS) {
    const info = await connection.getAccountInfo(new PublicKey(id), "confirmed");
    supportReports.push({ id, exists: !!info, owner: info?.owner.toBase58() ?? null, dataLength: info?.data.length ?? 0 });
  }
  let validatorVersion = "unknown";
  try {
    validatorVersion = wsl(
      'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"; solana-test-validator --version',
    ).trim();
  } catch (error) {
    validatorVersion = error instanceof Error ? error.message : "unknown";
  }
  evidence.environment = {
    label: saved.clusterLabel,
    note: saved.clusterNote,
    notPublicDevnet: true,
    rpc: RPC,
    genesisHash: await connection.getGenesisHash(),
    slot: await connection.getSlot("confirmed"),
    validatorVersion,
    programs: programReports,
    supportingAccounts: supportReports,
  };
  const missingPrograms = programReports.filter((item) => !item.executable);
  if (missingPrograms.length > 0) {
    die(
      `Required programs are not executable on this ledger: ${missingPrograms.map((item) => item.name).join(", ")}. The ledger was not reset and no other config was deployed.`,
    );
  }
  const missingSupport = supportReports.filter((item) => !item.exists);
  if (missingSupport.length > 0) {
    die(
      `Cloned Meteora accounts are missing: ${missingSupport.map((item) => item.id).join(", ")}. The ledger was not reset.`,
    );
  }
  log("DBC, DAMM v2, and Metaplex are executable on the local validator.");

  log("3. Brief and search");
  const {
    designPolicy,
    materializeRecipe,
    parseBrief,
    toDesignedMarket,
    describeCohortPaths,
    scenarioAssumptions,
    constraintFailureCopy,
    MARKET_MODEL_VERSION,
    DBC_SDK_VERSION,
  } = await import("@/lib/market");
  const { FEE_BY_PRESET } = await import("@/lib/dbc/presets");
  const { openBook } = await import("@/lib/market/book");
  const { marketConfigFingerprint, canonicalMarketConfig } = await import("@/lib/dbc/configFingerprint");
  const { launchCurveConfig } = await import("@/lib/dbc/create");
  const { buildLaunchReview } = await import("@/lib/dbc/launchReview");
  const policy = designPolicy(saved.brief);
  const mismatches = expectMismatches(policy, saved.expect);
  const failureLines = constraintFailureCopy(policy);
  const designed = toDesignedMarket(policy);
  evidence.candidates = policy.candidates;
  evidence.policyReview = {
    policyId: policy.policyId,
    modelVersion: policy.modelVersion,
    sdkVersion: policy.sdkVersion,
    seed: policy.seed,
    configHash: policy.configHash,
    search: policy.search,
    why: policy.why,
    limits: policy.limits,
    observedLaunches: policy.observedLaunches,
    observedNote: policy.observedNote,
    constraintFailure: failureLines,
    designed,
    chosenRejected: policy.chosen.rejected,
    feasibleCount: policy.candidates.filter((row) => row.feasible).length,
  };
  const parsed = parseBrief(saved.brief);
  const assumptions = scenarioAssumptions(saved.brief.asset);
  const built = materializeRecipe(policy.chosen.recipe);
  const fee = FEE_BY_PRESET[policy.chosen.recipe.presetId];
  const cohortPaths = describeCohortPaths({
    book: openBook(built, parsed.decimals),
    typicalAtoms: parsed.typicalAtoms,
    feeDurationSec: fee.totalDuration,
    paths: parsed.paths,
    seed: parsed.seed,
    whaleHundredths: assumptions.cohortWhaleHundredths,
    participants: saved.brief.participants,
  });
  evidence.assumptions = {
    modelVersion: MARKET_MODEL_VERSION,
    sdkVersion: DBC_SDK_VERSION,
    brief: saved.brief,
    targetRaiseAtoms: policy.targetRaiseAtoms,
    typicalTrade: saved.brief.typicalTrade,
    scenarioAssumptions: assumptions,
    feeDurationSec: fee.totalDuration,
    stressPaths: parsed.paths,
    seed: parsed.seed,
    pathSeedRule: "path i uses (seed + i * 997) >>> 0",
    retailSampleCap: 64,
    note: "Cohort flow is synthetic. Graduation here is a simulated frequency, not a real-world probability.",
  };
  evidence.cohortPaths = { seed: parsed.seed, paths: cohortPaths };
  evidence.selected = {
    recipe: policy.chosen.recipe,
    profileId: policy.chosen.profileId,
    profileName: policy.chosen.profileName,
    configFingerprint: policy.chosen.configFingerprint,
    configHash: policy.configHash,
    canonical: canonicalMarketConfig(built),
    feasible: policy.chosen.feasible,
    rejected: policy.chosen.rejected,
  };
  if (mismatches.length > 0) {
    die(
      `Saved brief does not match this search, so nothing was deployed.\n${mismatches.join("\n")}`,
    );
  }
  log(
    `Search matched the saved brief: ${policy.chosen.profileName}, fingerprint ${policy.chosen.configFingerprint}, ${policy.candidates.filter((row) => row.feasible).length} of ${policy.candidates.length} fully feasible.`,
  );

  log("4. Fingerprint");
  const payer = loadPayer();
  evidence.payer = payer.publicKey.toBase58();
  const fromRecipe = marketConfigFingerprint(built);
  const fromLaunch = marketConfigFingerprint(
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
    cluster: saved.clusterLabel,
    sharedConfig: null,
    marketCaps: {
      initial: policy.chosen.recipe.initialMarketCap,
      migration: policy.chosen.recipe.migrationMarketCap,
    },
  });
  if (fromRecipe !== policy.chosen.configFingerprint || fromLaunch !== policy.chosen.configFingerprint || review.configFingerprint !== policy.chosen.configFingerprint) {
    die(
      `Fingerprint mismatch before deploy. Selected ${policy.chosen.configFingerprint}, recipe ${fromRecipe}, launch builder ${fromLaunch}, review ${review.configFingerprint}. Nothing was sent.`,
    );
  }
  if (review.errors.length > 0) {
    die(`Policy review refused this design before deploy: ${review.errors.join(" ")}`);
  }
  log(`Fingerprint ${policy.chosen.configFingerprint} matches the simulator, the review, and the transaction builder.`);

  log("5. Deploy");
  await ensureLocalSol(connection, payer);
  const { prepareLaunchTransaction } = await import("@/lib/dbc/create");
  const { setFreshBlockhash, signAndSendTransaction } = await import("@/lib/send");
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
    die(
      `Transaction metadata URI is ${bundle.prepared.summary.uri}, not the saved brief URI ${saved.launch.uri}. Nothing was sent.`,
    );
  }
  if (bundle.prepared.summary.migrationQuoteThresholdAtoms !== policy.chosen.thresholdAtoms) {
    die(
      `Transaction threshold ${bundle.prepared.summary.migrationQuoteThresholdAtoms} does not match the selected design ${policy.chosen.thresholdAtoms}. Nothing was sent.`,
    );
  }
  const signatures: string[] = [];
  for (let i = 0; i < bundle.transactions.length; i++) {
    const tx = bundle.transactions[i];
    const signers = bundle.signersPerTx[i] ?? [];
    await setFreshBlockhash(connection, tx, payer.publicKey);
    if (signers.length > 0) tx.partialSign(...signers);
    signatures.push(
      await signAndSendTransaction({
        connection,
        wallet: walletFor(payer),
        tx,
      }),
    );
  }
  evidence.deployment = {
    signatures,
    mode: bundle.prepared.mode,
    pool: bundle.prepared.poolPubkey,
    config: bundle.prepared.configPubkey,
    baseMint: bundle.prepared.baseMintPubkey,
    quoteMint: bundle.prepared.quoteMint,
    metadataUri: bundle.prepared.summary.uri,
    migrationQuoteThresholdAtoms: bundle.prepared.summary.migrationQuoteThresholdAtoms,
  };
  log(`Deployed pool ${bundle.prepared.poolPubkey} in ${signatures[signatures.length - 1]}`);

  log("6. Read back and assert");
  const { fetchPoolSnapshot } = await import("@/lib/dbc/migrate");
  const { getDbcClient } = await import("@/lib/dbc/client");
  const snapshot = await fetchPoolSnapshot(connection, new PublicKey(bundle.prepared.poolPubkey));
  const onChain = await getDbcClient(connection).state.getPoolConfig(new PublicKey(bundle.prepared.configPubkey));
  evidence.readback = { snapshot, config: onChain };
  const checks: Check[] = [];
  const check = (name: string, expected: unknown, actual: unknown, normalize: (value: unknown) => string = text) => {
    const left = normalize(expected);
    const right = normalize(actual);
    checks.push({ name, expected: left, actual: right, ok: left === right });
  };
  if (!onChain) die("Pool config account was not readable after deploy.");
  const chain = onChain as unknown as Record<string, unknown>;
  const builtRecord = built as unknown as Record<string, unknown>;
  const builtFees = (builtRecord.poolFees ?? {}) as { baseFee?: Record<string, unknown>; dynamicFee?: Record<string, unknown> | null };
  const chainFees = (chain.poolFees ?? {}) as { baseFee?: Record<string, unknown>; dynamicFee?: Record<string, unknown> | null };
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
  check("quoteReserve", "0", snapshot.quoteReserve);
  check("isMigrated", "false", String(snapshot.isMigrated));
  for (const field of ["cliffFeeNumerator", "firstFactor", "secondFactor", "thirdFactor", "baseFeeMode"]) {
    check(`baseFee.${field}`, builtFees.baseFee?.[field], chainFees.baseFee?.[field]);
  }
  const dynamicFields = [
    "initialized",
    "binStep",
    "binStepU128",
    "variableFeeControl",
    "filterPeriod",
    "decayPeriod",
    "reductionFactor",
    "maxVolatilityAccumulator",
  ];
  if (!builtFees.dynamicFee && !chainFees.dynamicFee) {
    checks.push({ name: "dynamicFee", expected: "none", actual: "none", ok: true });
  } else {
    for (const field of dynamicFields) {
      if (field === "initialized") {
        const configured = text(builtFees.dynamicFee?.[field]);
        const actual = flag(chainFees.dynamicFee?.[field]);
        // ConfigParameters omits this flag. The program writes 1 when a dynamic fee is present.
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
  evidence.assertions = checks;
  const failed = checks.filter((item) => !item.ok);
  if (failed.length > 0) {
    die(
      `On-chain values do not match the selected design.\n${failed
        .map((item) => `${item.name}: expected ${item.expected}, chain has ${item.actual}`)
        .join("\n")}`,
    );
  }
  log("On-chain pool and config match the selected design.");
  log(failureLines ? failureLines.join("\n") : "The selected design passed every constraint.");
  return checks;
}

main()
  .then((checks) => {
    writeEvidence(checks);
    if (failure) {
      console.error(failure);
      process.exit(1);
    }
    log("JOURNEY_OK");
  })
  .catch((error: unknown) => {
    const message = failure ?? (error instanceof Error ? error.message : String(error));
    failure = message;
    console.error(message);
    try {
      const checks = (evidence.assertions as Check[] | undefined) ?? [];
      writeEvidence(checks);
    } catch (writeError) {
      console.error(writeError instanceof Error ? writeError.message : String(writeError));
    }
    process.exit(1);
  });
