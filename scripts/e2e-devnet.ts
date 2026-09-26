/**
 * EquiCurve end-to-end lifecycle verification (review pass 2).
 *
 *   npm run e2e:devnet                       # real devnet (default RPC)
 *   E2E_RPC_URL=http://127.0.0.1:8899 npm run e2e:devnet   # local validator w/ programs cloned from devnet
 *
 * Calls the SAME lib functions the UI uses (src/lib/dbc/*, src/lib/damm/*,
 * send.ts, registry + metadata clients, amounts helpers), signing with local
 * keypairs through a wallet-adapter shim instead of a browser wallet.
 * Registry / metadata go through the real API routes of a local `next dev`
 * (E2E_APP_URL, default http://localhost:3011).
 *
 * Keys live in E2E_KEYS_DIR (default /workspace/equicurve-e2e/keys) — never
 * commit them. Results: $E2E_OUT_DIR/results-<network>.json + e2e-<network>.log.
 */
import { APP_URL, NETWORK, RPC_URL, USDC_STANDIN, loadKeypair } from "./e2e/env";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { formatAtomsExact } from "@/lib/amounts";
import { signLaunchPayload, type LaunchAuthPayload, type SignedLaunchBody } from "@/lib/auth/launchAuth";
import { getCluster, WSOL_MINT } from "@/lib/constants";
import { getDbcClient } from "@/lib/dbc/client";
import { planLaunchAddresses, prepareLaunchTransaction } from "@/lib/dbc/create";
import { buildPresetConfig, presetMigrationThresholdAtoms } from "@/lib/dbc/presets";
import { quoteAndBuildSwap } from "@/lib/dbc/swap";
import {
  expectedDammDestination,
  fetchPoolSnapshot,
  lookupPoolOnChain,
  migrationConfigForSnapshot,
  prepareDammV2Migration,
  verifyDammV2Pool,
} from "@/lib/dbc/migrate";
import { deriveGraduationView, graduationNumbers, type DestinationCheck, type MigrationTxPhase } from "@/lib/dbc/curveState";
import { prepareClaimCreatorFees, prepareClaimPartnerFees, fetchPoolFeeBreakdown } from "@/lib/dbc/claim";
import { resolveDammPoolAddress, fetchDammPoolSnapshot } from "@/lib/damm/pool";
import { buildDammSwapTx, quoteDammSwap } from "@/lib/damm/swap";
import { buildClaimPositionFeeTx, fetchUserDammPositions } from "@/lib/damm/positions";
import { getCpAmm } from "@/lib/damm/client";
import { displayStatus } from "@/lib/explore/verification";
import { getBaseFeeParams, MAX_SQRT_PRICE, MIN_SQRT_PRICE } from "@meteora-ag/cp-amm-sdk";
import { EquiCurveError, mapError } from "@/lib/errors";
import { resolveMetadataUri } from "@/lib/metadata/client";
import { refreshLaunchRemote, registerLaunchRemote } from "@/lib/registry/client";
import { enrichOfferings } from "@/lib/explore/discover";
import { signAndSendTransaction } from "@/lib/send";
import type { PresetId, PreparedLaunch } from "@/lib/dbc/types";
import type { TransferProfile } from "@/lib/dbc/transferHook";
import type { ExploreOffering } from "@/lib/explore/types";
import {
  Step,
  connection,
  ensureSol,
  explorerAddr,
  flush,
  getTx,
  lamportDelta,
  loadState,
  log,
  results,
  saveState,
  sendLikeUi,
  sleep,
  solReceived,
  tokenDelta,
  walletFor,
  withBrowserOrigin,
} from "./e2e/harness";

const creator = loadKeypair("creator");
const partner = loadKeypair("partner");
const trader = loadKeypair("trader");
const other = loadKeypair("other");
const QUOTE6 = USDC_STANDIN.publicKey;

const ONLY = (process.env.E2E_ONLY || "").split(",").filter(Boolean);
const want = (s: string) => !ONLY.length || ONLY.includes(s);

/* ================================================================ setup */

async function setup(oldBlockhashBox: { bh?: string }) {
  const st = new Step("setup", `Fund keypairs + ${NETWORK === "devnet" ? "devnet" : "localnet"} 6-dec quote stand-in mint`);
  try {
    st.note(`RPC ${RPC_URL} (${NETWORK}); app ${APP_URL}; app cluster label ${getCluster()}`);
    for (const [n, kp, min] of [
      ["creator", creator, NETWORK === "devnet" ? 0.9 : 5],
      ["trader", trader, NETWORK === "devnet" ? 0.5 : 20],
      ["partner", partner, NETWORK === "devnet" ? 0.05 : 1],
      ["other", other, NETWORK === "devnet" ? 0.15 : 2],
    ] as const) {
      await ensureSol(kp, min);
      st.addr(n, kp.publicKey.toBase58());
    }
    const bh = await connection.getLatestBlockhash("confirmed");
    oldBlockhashBox.bh = bh.blockhash; // used by S10 (expired blockhash) much later

    const info = await connection.getAccountInfo(QUOTE6);
    if (!info) {
      const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      const tx = new Transaction().add(
        SystemProgram.createAccount({ fromPubkey: creator.publicKey, newAccountPubkey: QUOTE6, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeMint2Instruction(QUOTE6, 6, creator.publicKey, null, TOKEN_PROGRAM_ID),
      );
      st.sig("create 6-dec quote stand-in mint", await sendLikeUi({ tx, signer: creator, extraSigners: [USDC_STANDIN] }));
    }
    const mint = await getMint(connection, QUOTE6);
    st.check(mint.decimals === 6, `stand-in quote mint decimals = ${mint.decimals}`);
    st.addr("quote6Mint", QUOTE6.toBase58());
    // Top up stand-in balances.
    const targets: [Keypair, bigint][] = [[trader, 5_000n], [other, 1_000n], [creator, 200n]];
    const tx = new Transaction();
    for (const [kp, whole] of targets) {
      const ata = getAssociatedTokenAddressSync(QUOTE6, kp.publicKey);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, ata, kp.publicKey, QUOTE6));
      const bal = await connection.getTokenAccountBalance(ata).then((b) => BigInt(b.value.amount)).catch(() => 0n);
      const want = whole * 1_000_000n;
      if (bal < want) tx.add(createMintToInstruction(QUOTE6, ata, creator.publicKey, want - bal + 1_000_000_000n));
    }
    if (tx.instructions.some((ix) => ix.programId.equals(TOKEN_PROGRAM_ID))) {
      st.sig("mint stand-in quote to test wallets", await sendLikeUi({ tx, signer: creator }));
    }
    st.done();
  } catch (e) {
    st.fail(e);
    throw e;
  }
}

/* ================================================================ launch */

type LaunchSpec = {
  key: string;
  name: string;
  symbol: string;
  presetId: PresetId;
  quote: "SOL" | "USDC";
  profile: TransferProfile;
  seed: string;
  fee: number;
  lock: number;
  register: "sign" | "decline";
  /** Grind the base mint so its bytes sort below / above the quote mint. */
  mintOrder?: "lt" | "gt";
};

type LaunchResult = {
  spec: LaunchSpec;
  prepared: PreparedLaunch;
  sigs: string[];
  signed: SignedLaunchBody | null;
  registry: { ok: boolean; error?: string } | null;
  metaSource: string;
};

function grindMint(quote: PublicKey, order?: "lt" | "gt"): Keypair {
  for (;;) {
    const k = Keypair.generate();
    if (!order) return k;
    const c = Buffer.compare(k.publicKey.toBuffer(), quote.toBuffer());
    if ((order === "lt" && c < 0) || (order === "gt" && c > 0)) return k;
  }
}

async function launch(st: Step, spec: LaunchSpec): Promise<LaunchResult> {
  const quoteMint = spec.quote === "USDC" ? QUOTE6 : WSOL_MINT;
  const keypairs = { config: Keypair.generate(), baseMint: grindMint(quoteMint, spec.mintOrder) };
  const planned = planLaunchAddresses({ quoteLabel: spec.quote, keypairs });
  const payload: LaunchAuthPayload = {
    v: 1,
    action: "launch",
    cluster: getCluster(),
    pool: planned.pool,
    mint: planned.mint,
    profile: {
      name: spec.name,
      ticker: spec.symbol,
      thesis: `E2E ${spec.key}: ${spec.presetId} preset, ${spec.quote} quote, ${spec.profile}.`,
      sector: "Equity",
      presetId: spec.presetId,
      raiseTarget: 1000,
    },
    metadata: { name: spec.name, symbol: spec.symbol, description: `EquiCurve e2e ${spec.key}`, image: "" },
  };
  // Same decision tree as CreateWizard.onLaunch.
  let signed: SignedLaunchBody | null = null;
  const wallet = walletFor(creator, { declineSignMessage: spec.register === "decline" });
  try {
    signed = await signLaunchPayload({ payload, signer: creator.publicKey.toBase58(), signMessage: wallet.signMessage! });
  } catch (e) {
    st.note(`signMessage declined → local-only (${mapError(e).kind}: ${mapError(e).message})`);
  }
  const meta = await withBrowserOrigin(() =>
    resolveMetadataUri({ customUri: "", signed, fallback: { name: spec.name, symbol: spec.symbol, description: `EquiCurve e2e ${spec.key}` } }),
  );
  st.note(`metadata source: ${meta.source}${meta.note ? ` (${meta.note})` : ""}`);
  const { prepared, transactions, signersPerTx } = await prepareLaunchTransaction({
    connection,
    payer: creator.publicKey,
    keypairs,
    input: {
      name: spec.name,
      symbol: spec.symbol,
      uri: meta.uri,
      presetId: spec.presetId,
      totalSupply: 1_000_000_000,
      creatorTradingFeePercentage: spec.fee,
      lpLockPct: spec.lock,
      mintRenounce: true,
      seedBuyAmount: spec.seed,
      antiSniper: false,
      quoteLabel: spec.quote,
      feeClaimer: partner.publicKey.toBase58(),
      transferProfile: spec.profile,
    },
  });
  if (prepared.poolPubkey !== planned.pool) throw new Error("planned pool != prepared pool");
  st.note(`mode=${prepared.mode} txs=${transactions.length} seedBuyAtoms=${prepared.seedBuyAtoms}`);
  st.addr("pool", prepared.poolPubkey);
  st.addr("baseMint", prepared.baseMintPubkey);
  st.addr("config", prepared.configPubkey);
  const sigs: string[] = [];
  for (let i = 0; i < transactions.length; i++) {
    const sig = await sendLikeUi({ tx: transactions[i], signer: creator, extraSigners: signersPerTx[i] });
    sigs.push(sig);
    st.sig(`create ${i + 1}/${transactions.length}${transactions.length > 1 ? (i === 0 ? " (config)" : " (pool + first buy)") : " (config + pool)"}`, sig);
  }
  let registry: LaunchResult["registry"] = null;
  if (signed) {
    registry = await registerLaunchRemote(signed);
    st.note(`registry POST (creator-signed): ${registry.ok ? "listed" : `NOT listed: ${(registry as { error: string }).error}`}`);
  }
  return { spec, prepared, sigs, signed, registry, metaSource: meta.source };
}

/** Scenario 4: on-chain accounts exist and fields match inputs. */
async function verifyLaunch(st: Step, r: LaunchResult) {
  const { spec, prepared } = r;
  const snap = await fetchPoolSnapshot(connection, new PublicKey(prepared.poolPubkey));
  const client = getDbcClient(connection);
  const cfg = (await client.state.getPoolConfig(new PublicKey(prepared.configPubkey))) as unknown as Record<string, any>;
  const expected = buildPresetConfig(spec.presetId, {
    totalTokenSupply: 1_000_000_000,
    creatorTradingFeePercentage: spec.fee,
    lpLockPct: spec.lock,
    mintRenounce: true,
    antiSniper: false,
    quoteDecimals: spec.quote === "USDC" ? 6 : 9,
    tokenType: spec.profile === "open-spl" ? "spl" : "token-2022",
    allowMintAuthority: false,
  }) as unknown as Record<string, any>;
  const eqBN = (a: unknown, b: unknown) => new BN(String(a)).eq(new BN(String(b)));

  st.check(snap.creator === creator.publicKey.toBase58(), `pool.creator = creator (${snap.creator})`);
  st.check(snap.baseMint === prepared.baseMintPubkey, "pool.baseMint = planned mint");
  st.check(snap.config === prepared.configPubkey, "pool.config = config keypair");
  st.check(snap.kind === "standard", `pool kind (discriminator) = ${snap.kind}`);
  const quoteMint = spec.quote === "USDC" ? QUOTE6.toBase58() : WSOL_MINT.toBase58();
  st.check(snap.quoteMint === quoteMint, `config.quoteMint = ${snap.quoteMint}`);
  st.check(snap.quoteDecimals === (spec.quote === "USDC" ? 6 : 9), `quote decimals = ${snap.quoteDecimals}`);
  st.check(snap.baseDecimals === 9, `config.tokenDecimal = ${snap.baseDecimals}`);
  st.check(snap.feeClaimer === partner.publicKey.toBase58(), `config.feeClaimer = partner (${snap.feeClaimer})`);
  st.check(snap.creatorFeePct === spec.fee, `creatorTradingFeePercentage = ${snap.creatorFeePct} (input ${spec.fee})`);
  st.check(snap.lockPct === spec.lock, `partnerPermanentLockedLiquidityPercentage = ${snap.lockPct} (input ${spec.lock})`);
  st.check(Number(cfg.partnerLiquidityPercentage) === 100 - spec.lock, `partnerLiquidityPercentage = ${cfg.partnerLiquidityPercentage}`);
  st.check(snap.migrationOption === 1, `migrationOption = ${snap.migrationOption} (DAMM v2)`);
  st.check(snap.migrationFeeOption === 2, `migrationFeeOption = ${snap.migrationFeeOption}`);
  st.check(eqBN(cfg.poolCreationFee, 1_000_000), `poolCreationFee = ${cfg.poolCreationFee} lamports (0.001 SOL, not 1,000,000 SOL)`);
  st.check(eqBN(cfg.migrationQuoteThreshold, expected.migrationQuoteThreshold), `migrationQuoteThreshold = ${cfg.migrationQuoteThreshold} (built ${expected.migrationQuoteThreshold})`);
  st.check(eqBN(cfg.sqrtStartPrice, expected.sqrtStartPrice), "sqrtStartPrice matches built curve");
  const onCurve = (cfg.curve as { sqrtPrice: BN; liquidity: BN }[]).filter((p) => !new BN(String(p.sqrtPrice)).isZero());
  const builtCurve = expected.curve as { sqrtPrice: BN; liquidity: BN }[];
  st.check(
    onCurve.length === builtCurve.length && builtCurve.every((p, i) => eqBN(p.sqrtPrice, onCurve[i].sqrtPrice) && eqBN(p.liquidity, onCurve[i].liquidity)),
    `curve points (${onCurve.length}) match preset ${spec.presetId}`,
  );
  const bf = cfg.poolFees?.baseFee ?? {};
  const ebf = expected.poolFees?.baseFee ?? {};
  st.check(eqBN(bf.cliffFeeNumerator, ebf.cliffFeeNumerator), `base fee cliffFeeNumerator = ${bf.cliffFeeNumerator} (built ${ebf.cliffFeeNumerator})`);
  st.check(Number(cfg.tokenType) === (spec.profile === "open-spl" ? 0 : 1), `tokenType = ${cfg.tokenType}`);
  // Mint account.
  const mintInfo = await connection.getAccountInfo(new PublicKey(prepared.baseMintPubkey));
  const expProg = spec.profile === "open-spl" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  st.check(!!mintInfo && mintInfo.owner.equals(expProg), `mint owner program = ${mintInfo?.owner.toBase58()}`);
  const mint = await getMint(connection, new PublicKey(prepared.baseMintPubkey), "confirmed", expProg);
  st.check(mint.decimals === 9, `mint decimals = ${mint.decimals}`);
  st.check(mint.mintAuthority === null, `mint authority renounced (${mint.mintAuthority?.toBase58() ?? "null"})`);
  st.check(mint.supply === 1_000_000_000n * 10n ** 9n, `mint supply = ${mint.supply}`);
  const cfgInfo = await connection.getAccountInfo(new PublicKey(prepared.configPubkey));
  st.check(!!cfgInfo && cfgInfo.owner.equals(new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN")), "config account owned by DBC");
  if (prepared.seedBuyAtoms !== "0") {
    const ata = getAssociatedTokenAddressSync(new PublicKey(prepared.baseMintPubkey), creator.publicKey, false, expProg);
    const bal = await connection.getTokenAccountBalance(ata).then((b) => BigInt(b.value.amount)).catch(() => 0n);
    st.check(bal > 0n, `seed buy delivered ${formatAtomsExact(bal.toString(), 9)} base to creator`);
    const t = await getTx(r.sigs[r.sigs.length - 1]);
    const spent =
      spec.quote === "USDC"
        ? -tokenDelta(t, creator.publicKey, QUOTE6)
        : null;
    if (spent != null) st.check(spent === BigInt(prepared.seedBuyAtoms), `seed buy spent exactly ${formatAtomsExact(spent.toString(), 6)} quote (input ${spec.seed})`);
    st.check(BigInt(snap.quoteReserve) > 0n && BigInt(snap.quoteReserve) <= BigInt(prepared.seedBuyAtoms), `quoteReserve after seed = ${snap.quoteReserve} (≤ seed ${prepared.seedBuyAtoms}, fee deducted)`);
  } else {
    st.check(snap.quoteReserve === "0", `quoteReserve = 0 (no seed buy)`);
  }
  st.check(snap.curve.phase === "raising", `curve phase = ${snap.curve.phase}, progress ${snap.quoteProgress}`);
}

/* ================================================================ swaps */

async function dbcSwap(st: Step, args: {
  label: string; pool: string; kp: Keypair; direction: "buy" | "sell"; amountUi: string; slippageBps: number; quote: "SOL" | "USDC"; baseProgram: PublicKey; baseMint: string;
}): Promise<{ sig: string; received: bigint; expected: bigint; min: bigint; q: Awaited<ReturnType<typeof quoteAndBuildSwap>>; quoteSpent: bigint | null }> {
  const q = await quoteAndBuildSwap({ connection, owner: args.kp.publicKey, pool: new PublicKey(args.pool), direction: args.direction, amountUi: args.amountUi, slippageBps: args.slippageBps });
  const sig = await signAndSendTransaction({ connection, wallet: walletFor(args.kp), tx: q.tx });
  st.sig(args.label, sig);
  const t = await getTx(sig);
  const base = new PublicKey(args.baseMint);
  const baseD = tokenDelta(t, args.kp.publicKey, base);
  let received: bigint;
  const quoteSpent = args.direction === "buy" && args.quote === "USDC" ? -tokenDelta(t, args.kp.publicKey, QUOTE6) : null;
  if (args.direction === "buy") {
    received = baseD;
  } else if (args.quote === "USDC") {
    received = tokenDelta(t, args.kp.publicKey, QUOTE6);
  } else {
    received = solReceived(t, args.kp.publicKey);
  }
  const expected = BigInt(q.expectedOut);
  const min = BigInt(q.minimumAmountOut);
  st.note(`${args.label}: in ${formatAtomsExact(q.amountIn, q.inputDecimals)} (inputDecimals ${q.inputDecimals}) → quoted ${formatAtomsExact(q.expectedOut, q.outputDecimals)}, min ${formatAtomsExact(q.minimumAmountOut, q.outputDecimals)}, actual ${formatAtomsExact(received.toString(), q.outputDecimals)}`);
  st.check(received >= min, `${args.label}: actual ≥ minimumAmountOut (slippage ${args.slippageBps} bps)`);
  const diffBps = expected > 0n ? Number(((received - expected) * 10_000n) / expected) : 0;
  st.check(Math.abs(diffBps) <= args.slippageBps, `${args.label}: actual within ${args.slippageBps} bps of quote (diff ${diffBps} bps)`);
  if (args.direction === "sell") {
    st.check(q.inputDecimals === 9, `sell input uses BASE decimals (${q.inputDecimals})`);
    st.check(-baseD === BigInt(q.amountIn), `sold exactly ${q.amountIn} base atoms (Δ ${baseD})`);
  } else {
    st.check(q.inputDecimals === (args.quote === "USDC" ? 6 : 9), `buy input uses QUOTE decimals (${q.inputDecimals})`);
  }
  return { sig, received, expected, min, q, quoteSpent };
}

/** Connection that forces skipPreflight so a failing tx actually lands (tests confirm-path value.err handling). */
function landingConnection(): Connection {
  const c = new Connection(RPC_URL, "confirmed");
  const orig = c.sendRawTransaction.bind(c);
  c.sendRawTransaction = (raw, opts) => orig(raw, { ...(opts ?? {}), skipPreflight: true, maxRetries: 3 });
  return c;
}

async function slippageFailure(st: Step, pool: string, landed: boolean, amounts: { mine: string; mover: string }) {
  // Quote a small buy with 1 bps slippage, then move the price with a bigger buy first.
  const q = await quoteAndBuildSwap({ connection, owner: trader.publicKey, pool: new PublicKey(pool), direction: "buy", amountUi: amounts.mine, slippageBps: 1 });
  const mover = await quoteAndBuildSwap({ connection, owner: other.publicKey, pool: new PublicKey(pool), direction: "buy", amountUi: amounts.mover, slippageBps: 500 });
  const moverSig = await signAndSendTransaction({ connection, wallet: walletFor(other), tx: mover.tx });
  st.sig("price-moving buy (other wallet)", moverSig);
  let submitted: string | null = null;
  const conn = landed ? landingConnection() : connection;
  try {
    const sig = await signAndSendTransaction({ connection: conn, wallet: walletFor(trader), tx: q.tx, onSubmitted: (s) => (submitted = s) });
    st.check(false, `stale 1-bps buy unexpectedly SUCCEEDED (${sig})`);
  } catch (e) {
    const m = mapError(e);
    const code = e instanceof EquiCurveError ? e.code : "?";
    st.note(`surfaced as failure: code=${code} kind=${m.kind} message="${m.message}"`);
    st.check(m.kind === "slippage", `mapped to slippage error (kind=${m.kind})`);
    if (landed) {
      st.check(!!submitted, "tx was submitted and landed (preflight bypassed)");
      if (submitted) {
        const t = await getTx(submitted);
        st.check(t.meta?.err != null, `on-chain meta.err = ${JSON.stringify(t.meta?.err)}`);
        st.check(code === "TX_FAILED", `send.ts reports TX_FAILED, not success`);
        st.sig("stale 1-bps buy (landed, failed)", submitted, false);
      }
    } else {
      st.check(!submitted, "rejected at preflight — nothing submitted");
    }
  }
}

/* ================================================================ main */

async function main() {
  log(`\n\n######## EquiCurve e2e @ ${new Date().toISOString()} network=${NETWORK} rpc=${RPC_URL}`);
  const oldBh: { bh?: string } = {};
  await setup(oldBh);
  const state = loadState();
  const launches: Record<string, LaunchResult> = {};

  const specs: LaunchSpec[] = [
    { key: "L1", name: "E2E Flat SOL SPL", symbol: "EQSOL", presetId: "flat", quote: "SOL", profile: "open-spl", seed: "", fee: 30, lock: 60, register: "sign" },
    { key: "L2", name: "E2E Flat SOL T22 Seed", symbol: "EQT22", presetId: "flat", quote: "SOL", profile: "token-2022", seed: "0.05", fee: 50, lock: 100, register: "sign" },
    { key: "L3", name: "E2E Equity USD SPL Seed", symbol: "EQUSD", presetId: "equity", quote: "USDC", profile: "open-spl", seed: "25.5", fee: 40, lock: 80, register: "decline" },
  ];
  const scenarioOf: Record<string, string> = { L1: "S1", L2: "S2", L3: "S2" };

  /* ---- S1/S2/S3/S4: creates + on-chain verification */
  for (const spec of specs) {
    if (!want(scenarioOf[spec.key]) && !want("S6") && !want("S7") && !want("S5")) continue;
    const st = new Step(scenarioOf[spec.key], `Create ${spec.key}: ${spec.quote} quote, ${spec.profile}, preset ${spec.presetId}, seed ${spec.seed || "none"}, creator fee ${spec.fee}%, LP lock ${spec.lock}%`);
    try {
      launches[spec.key] = await launch(st, spec);
      st.done();
    } catch (e) {
      st.fail(e);
      continue;
    }
    const v = new Step("S4", `Verify ${spec.key} on-chain (pool, mint, config fields vs inputs)`);
    try {
      await verifyLaunch(v, launches[spec.key]);
      v.done();
    } catch (e) {
      v.fail(e);
    }
  }
  saveState({ launches: Object.fromEntries(Object.entries(launches).map(([k, v]) => [k, v.prepared])) });

  {
    const st = new Step("S3", "Token modes");
    st.note(`Open SPL: L1${launches.L3 ? ", L3" : ""}; Token-2022 (no hook): L2 (+ short pool SB later)`);
    st.note("Transfer-hook: SKIPPED — no executable Token-2022 transfer-hook program is available on devnet for EquiCurve (Meteora requires the launcher to deploy its own; the app refuses to invent one).");
    st.done("skipped");
  }

  /* ---- S5: registry */
  if (want("S5") && launches.L1) {
    const L1 = launches.L1;
    const st = new Step("S5", "Registry authz via real API routes");
    try {
      st.check(L1.registry?.ok === true, `creator-signed POST listed L1 (${L1.registry?.ok ? "ok" : L1.registry && "error" in L1.registry ? L1.registry.error : "no response"})`);
      st.check(L1.metaSource === "hosted", `signed launch used hosted metadata (${L1.metaSource})`);
      const list = (await (await fetch("/api/launches")).json()) as { launches: { pool: string; creator: string; status: string; quote: string }[] };
      const e1 = list.launches.find((l) => l.pool === L1.prepared.poolPubkey);
      st.check(!!e1 && e1.creator === creator.publicKey.toBase58(), `GET /api/launches has L1 with chain creator (${e1?.creator})`);
      st.check(e1?.status === "new", `L1 registry status from chain = ${e1?.status}`);
      // Different wallet signs a payload for L1.
      const forged = await signLaunchPayload({
        payload: { ...L1.signed!.payload, profile: { ...L1.signed!.payload.profile!, name: "Hijacked Name" } },
        signer: other.publicKey.toBase58(),
        signMessage: walletFor(other).signMessage!,
      });
      const r403 = await fetch("/api/launches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(forged) });
      const j403 = await r403.json();
      st.check(r403.status === 403, `other wallet's signature → HTTP ${r403.status} (${j403.code ?? j403.error})`);
      // Spoofed status inside a validly signed payload (strict schema).
      const spoofBody = { ...L1.signed!, payload: { ...L1.signed!.payload, status: "graduated", isMigrated: true } };
      const rs = await fetch("/api/launches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(spoofBody) });
      st.check(rs.status === 400, `spoofed status in POST payload → HTTP ${rs.status} (${(await rs.json()).code})`);
      const rp = await fetch("/api/launches", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pool: L1.prepared.poolPubkey, status: "graduated", dammPool: other.publicKey.toBase58() }) });
      const jp = await rp.json();
      st.note(`PATCH with spoofed status → HTTP ${rp.status} ${jp.code ?? ""}`);
      const after = (await (await fetch("/api/launches")).json()) as { launches: { pool: string; status: string; dammPool: string | null }[] };
      const e1b = after.launches.find((l) => l.pool === L1.prepared.poolPubkey);
      st.check(e1b?.status !== "graduated" && !e1b?.dammPool, `spoofed status ignored: registry status = ${e1b?.status}, dammPool = ${e1b?.dammPool}`);
      if (launches.L3) {
        const L3 = launches.L3;
        st.check(L3.signed === null && L3.registry === null, "declined signMessage → no registry POST attempted");
        st.check(L3.metaSource === "data-uri", `declined → inline data: URI metadata (${L3.metaSource})`);
        st.check(!after.launches.some((l) => l.pool === L3.prepared.poolPubkey), "declined launch absent from shared registry (local-only)");
      }
      st.done();
    } catch (e) {
      st.fail(e);
    }
  }

  /* ---- S6: DBC buy then sell per pool type + slippage failure */
  if (want("S6")) {
    for (const key of ["L1", "L2", "L3"]) {
      const L = launches[key];
      if (!L) continue;
      const st = new Step("S6", `DBC buy → sell on ${key} (${L.spec.quote}, ${L.spec.profile})`);
      try {
        const baseProgram = L.spec.profile === "open-spl" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
        const buyAmt = L.spec.quote === "USDC" ? "12.345678" : "0.0234";
        const b = await dbcSwap(st, { label: `buy ${buyAmt} ${L.spec.quote}`, pool: L.prepared.poolPubkey, kp: trader, direction: "buy", amountUi: buyAmt, slippageBps: 100, quote: L.spec.quote, baseProgram, baseMint: L.prepared.baseMintPubkey });
        const half = b.received / 2n;
        const sellUi = formatAtomsExact(half.toString(), 9);
        await dbcSwap(st, { label: `sell ${sellUi} base`, pool: L.prepared.poolPubkey, kp: trader, direction: "sell", amountUi: sellUi, slippageBps: 100, quote: L.spec.quote, baseProgram, baseMint: L.prepared.baseMintPubkey });
        st.done();
      } catch (e) {
        st.fail(e);
      }
    }
  }

  /* ---- S7: fee claims */
  if (want("S7")) {
    for (const key of ["L1", "L3"]) {
      const L = launches[key];
      if (!L) continue;
      const pool = new PublicKey(L.prepared.poolPubkey);
      const st = new Step("S7", `Fee claims on ${key} (${L.spec.quote}): creator, partner, wrong wallet`);
      try {
        const before = await fetchPoolFeeBreakdown(connection, pool);
        st.note(`unclaimed before: creator quote ${before.creatorUnclaimedQuote}, partner quote ${before.partnerUnclaimedQuote}`);
        // Wrong wallets first (app-level refusal).
        for (const [label, fn] of [
          ["other wallet as creator", () => prepareClaimCreatorFees({ connection, creator: other.publicKey, pool })],
          ["creator wallet as partner", () => prepareClaimPartnerFees({ connection, feeClaimer: creator.publicKey, pool })],
        ] as const) {
          try {
            await fn();
            st.check(false, `${label}: claim was NOT refused`);
          } catch (e) {
            st.check(e instanceof EquiCurveError && e.code === "VALIDATION", `${label}: refused (${(e as Error).message})`);
          }
        }
        // On-chain refusal: SDK-built partner claim signed by a non-feeClaimer.
        const client = getDbcClient(connection);
        const bad = await client.partner.claimPartnerTradingFee({ feeClaimer: other.publicKey, payer: other.publicKey, pool, maxBaseAmount: new BN(1), maxQuoteAmount: new BN(1) });
        bad.feePayer = other.publicKey;
        bad.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        bad.sign(other);
        const sim = await connection.simulateTransaction(bad);
        st.check(sim.value.err != null, `program refuses non-feeClaimer partner claim (sim err ${JSON.stringify(sim.value.err)}; mapped: ${mapError({ message: (sim.value.logs ?? []).join("\n") }).message})`);

        const quoteMint = L.spec.quote === "USDC" ? QUOTE6 : WSOL_MINT;
        const c = await prepareClaimCreatorFees({ connection, creator: creator.publicKey, pool });
        const cs = await signAndSendTransaction({ connection, wallet: walletFor(creator), tx: c.tx });
        st.sig("claimCreatorTradingFee (creator)", cs);
        const ct = await getTx(cs);
        const cGot = L.spec.quote === "USDC" ? tokenDelta(ct, creator.publicKey, quoteMint) : solReceived(ct, creator.publicKey);
        st.check(cGot === BigInt(c.breakdown.creatorUnclaimedQuote), `creator received ${cGot} quote atoms = unclaimed ${c.breakdown.creatorUnclaimedQuote}`);
        const p = await prepareClaimPartnerFees({ connection, feeClaimer: partner.publicKey, pool });
        const ps = await signAndSendTransaction({ connection, wallet: walletFor(partner), tx: p.tx });
        st.sig("claimPartnerTradingFee (partner feeClaimer)", ps);
        const pt = await getTx(ps);
        const pGot = L.spec.quote === "USDC" ? tokenDelta(pt, partner.publicKey, quoteMint) : solReceived(pt, partner.publicKey);
        st.check(pGot === BigInt(p.breakdown.partnerUnclaimedQuote), `partner received ${pGot} quote atoms = unclaimed ${p.breakdown.partnerUnclaimedQuote}`);
        const after = await fetchPoolFeeBreakdown(connection, pool);
        st.check(after.creatorUnclaimedQuote === "0" && after.partnerUnclaimedQuote === "0", `unclaimed after: creator ${after.creatorUnclaimedQuote}, partner ${after.partnerUnclaimedQuote}`);
        st.done();
      } catch (e) {
        st.fail(e);
      }
    }
  }

  /* ---- S8 + S9: short raise → complete → migrate → DAMM v2 */
  const shortSpecs: LaunchSpec[] = [
    { key: "SA", name: "E2E Short A SPL", symbol: "EQSA", presetId: "short", quote: "USDC", profile: "open-spl", seed: "", fee: 50, lock: 100, register: "sign", mintOrder: "lt" },
    { key: "SB", name: "E2E Short B T22", symbol: "EQSB", presetId: "short", quote: "USDC", profile: "token-2022", seed: "", fee: 50, lock: 70, register: "sign", mintOrder: "gt" },
  ];
  const migrated: Record<string, { pool: string; baseMint: string; dammPool: string; dammConfig: string; profile: TransferProfile }> = {};
  if (want("S8") || want("S9")) {
    for (const spec of shortSpecs) {
      const st = new Step("S8", `Short-raise ${spec.key} (${spec.profile}, 6-dec stand-in quote, base ${spec.mintOrder === "lt" ? "<" : ">"} quote): create → buy to completion → migrate`);
      try {
        const L = await launch(st, spec);
        launches[spec.key] = L;
        const pool = new PublicKey(L.prepared.poolPubkey);
        let snap = await fetchPoolSnapshot(connection, pool);
        const threshold = BigInt(snap.migrationQuoteThreshold!);
        st.note(`migrationQuoteThreshold = ${formatAtomsExact(threshold.toString(), 6)} quote`);
        let view = deriveGraduationView({ curve: snap.curve, tx: "idle", destination: "unchecked", config: migrationConfigForSnapshot(snap) });
        st.check(view.state === "not_eligible", `before buys: graduation view = ${view.state} (${view.label})`);
        const baseProgram = spec.profile === "open-spl" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
        if (spec.key === "SA" && want("S6")) {
          // Slippage-exceeded failures need real price impact: use this small (772-unit) curve.
          const s1 = new Step("S6", "Slippage exceeded (SA, stand-in quote): preflight rejection → mapped error");
          try {
            await slippageFailure(s1, L.prepared.poolPubkey, false, { mine: "2", mover: "25" });
            s1.done();
          } catch (e) {
            s1.fail(e);
          }
          const s2 = new Step("S6/S10", "Slippage exceeded (SA) with preflight bypassed: tx lands and fails → TX_FAILED, never success");
          try {
            await slippageFailure(s2, L.prepared.poolPubkey, true, { mine: "2", mover: "25" });
            s2.done();
          } catch (e) {
            s2.fail(e);
          }
          snap = await fetchPoolSnapshot(connection, pool);
        }
        // Buy in chunks; the final chunk is sized from the remaining reserve.
        let guard = 0;
        while (snap.curve.phase === "raising" && guard++ < 8) {
          const remaining = threshold - BigInt(snap.quoteReserve);
          // Final chunk deliberately OVERSHOOTS (remaining × 1.5): planBuy must switch to PartialFill,
          // take only the fillable part and complete the curve (pre-pass-3 this failed with DBC 6033).
          const overshoot = remaining <= 400_000_000n;
          let amt = overshoot ? (remaining * 3n) / 2n : 300_000_000n;
          let sig: string | null = null;
          for (let attempt = 0; attempt < 6 && !sig; attempt++) {
            try {
              const ui = formatAtomsExact(amt.toString(), 6);
              const r = await dbcSwap(st, { label: `buy ${ui} (reserve ${formatAtomsExact(snap.quoteReserve, 6)}/${formatAtomsExact(threshold.toString(), 6)})`, pool: L.prepared.poolPubkey, kp: trader, direction: "buy", amountUi: ui, slippageBps: 200, quote: "USDC", baseProgram, baseMint: L.prepared.baseMintPubkey });
              sig = r.sig;
              if (overshoot) {
                st.note(`overshoot buy: input ${formatAtomsExact(r.q.amountIn, 6)} vs remaining ${formatAtomsExact(remaining.toString(), 6)} → mode ${r.q.mode}, fillable ${formatAtomsExact(r.q.fillableIn, 6)}, unused ${formatAtomsExact(r.q.unusedIn, 6)}, spent ${r.quoteSpent == null ? "?" : formatAtomsExact(r.quoteSpent.toString(), 6)}`);
                st.check(r.q.mode === "partial_fill" && r.q.completesCurve, `buy > remaining curve is planned as partial_fill (mode ${r.q.mode}, completesCurve ${r.q.completesCurve})`);
                st.check(r.quoteSpent != null && r.quoteSpent < BigInt(r.q.amountIn), `partial fill spent less than the requested input (${r.quoteSpent} < ${r.q.amountIn}); no DBC 6033`);
                st.check(r.quoteSpent != null && r.quoteSpent <= BigInt(r.q.fillableIn), `spent ≤ quoted fillable input (${r.quoteSpent} ≤ ${r.q.fillableIn})`);
              }
            } catch (e) {
              st.note(`buy ${amt} atoms failed: ${mapError(e).message.slice(0, 160)} — retrying smaller/larger`);
              amt = attempt % 2 === 0 ? (amt * 9_950n) / 10_000n : (amt * 10_100n) / 10_000n;
            }
          }
          snap = await fetchPoolSnapshot(connection, pool);
        }
        st.check(snap.curve.phase === "complete", `curve phase after buys = ${snap.curve.phase} (reserve ${snap.quoteReserve} ≥ ${threshold}, migrationProgress ${snap.migrationProgress})`);
        const cfgCheck = migrationConfigForSnapshot(snap);
        view = deriveGraduationView({ curve: snap.curve, tx: "idle", destination: "unchecked", config: cfgCheck });
        st.check(view.state === "eligible" && view.canMigrate, `eligibility check → ${view.state} (${view.label})`);
        const dest = expectedDammDestination(snap)!;
        st.addr("expectedDammConfig", dest.dammConfig.toBase58());
        st.addr("expectedDammPool", dest.dammPool.toBase58());
        // Migration: states idle → submitted → confirmed → destination_verified (same state machine as /graduate).
        const phases: string[] = [];
        let txPhase: MigrationTxPhase = "building";
        let destCheck: DestinationCheck = "unchecked";
        phases.push(deriveGraduationView({ curve: snap.curve, tx: txPhase, destination: destCheck, config: cfgCheck }).label);
        const m = await prepareDammV2Migration({ connection, payer: trader.publicKey, pool });
        const sig = await signAndSendTransaction({
          connection,
          wallet: walletFor(trader),
          tx: m.tx,
          onSubmitted: () => {
            txPhase = "submitted";
            phases.push(deriveGraduationView({ curve: snap.curve, tx: txPhase, destination: destCheck, config: cfgCheck }).state);
          },
        });
        txPhase = "confirmed";
        phases.push(deriveGraduationView({ curve: snap.curve, tx: txPhase, destination: destCheck, config: cfgCheck }).state);
        st.sig("migrateToDammV2", sig);
        for (let i = 0; i < 6 && destCheck !== "exists"; i++) {
          destCheck = await verifyDammV2Pool(connection, new PublicKey(m.dammPoolAddress));
          if (destCheck !== "exists") await sleep(1500);
        }
        phases.push(deriveGraduationView({ curve: snap.curve, tx: txPhase, destination: destCheck, config: cfgCheck }).state);
        st.note(`graduation states: ${phases.join(" → ")}`);
        st.check(phases.slice(1).join(",") === "submitted,confirmed,destination_verified", "states went submitted → confirmed → destination_verified");
        st.check(m.dammPoolAddress === dest.dammPool.toBase58(), `migrated DAMM v2 pool = expected (${m.dammPoolAddress})`);
        snap = await fetchPoolSnapshot(connection, pool);
        st.check(snap.isMigrated && snap.curve.phase === "migrated", `DBC pool isMigrated=${snap.isMigrated}, phase ${snap.curve.phase}`);
        // Registry refresh (PATCH) → graduated + DAMM pool recorded only after on-chain verification.
        const rr = await refreshLaunchRemote(L.prepared.poolPubkey);
        const list = (await (await fetch("/api/launches")).json()) as { launches: { pool: string; status: string; dammPool: string | null; isMigrated: boolean }[] };
        const e = list.launches.find((l) => l.pool === L.prepared.poolPubkey);
        st.check(rr.ok && e?.status === "graduated" && e.dammPool === m.dammPoolAddress, `registry refresh → status ${e?.status}, dammPool ${e?.dammPool}`);
        migrated[spec.key] = { pool: L.prepared.poolPubkey, baseMint: L.prepared.baseMintPubkey, dammPool: m.dammPoolAddress, dammConfig: m.dammConfig.toBase58(), profile: spec.profile };
        saveState({ migrated });
        st.done();
      } catch (e) {
        st.fail(e);
      }
    }
  }

  /* ---- S8 (SOL): quote-aware short preset + buy larger than the remaining curve */
  if (want("S8") && NETWORK !== "devnet") {
    const spec: LaunchSpec = { key: "SC", name: "E2E Short C SOL", symbol: "EQSC", presetId: "short", quote: "SOL", profile: "open-spl", seed: "", fee: 50, lock: 100, register: "sign" };
    const st = new Step("S8", "Short-raise SC (SOL quote): quote-aware threshold (~3.09 SOL, was 772.5) + buy 1.5× remaining → partial fill completes the curve (no DBC 6033)");
    try {
      const L = await launch(st, spec);
      launches[spec.key] = L;
      const pool = new PublicKey(L.prepared.poolPubkey);
      let snap = await fetchPoolSnapshot(connection, pool);
      const threshold = BigInt(snap.migrationQuoteThreshold!);
      st.check(threshold.toString() === presetMigrationThresholdAtoms("short", "SOL"), `on-chain threshold ${formatAtomsExact(threshold.toString(), 9)} SOL = preset/wizard value ${formatAtomsExact(presetMigrationThresholdAtoms("short", "SOL"), 9)} SOL`);
      st.check(threshold < 10_000_000_000n, `SOL short threshold is sane (< 10 SOL): ${formatAtomsExact(threshold.toString(), 9)} SOL`);
      const g0 = graduationNumbers(snap);
      st.check(g0.known && g0.remaining === threshold - BigInt(snap.quoteReserve), `graduationNumbers remaining (exact) = ${g0.known ? formatAtomsExact(g0.remaining.toString(), 9) : "unknown"} SOL`);
      const remaining = g0.known ? g0.remaining : threshold;
      const ask = (remaining * 3n) / 2n;
      const reserveBefore = BigInt(snap.quoteReserve);
      const r = await dbcSwap(st, { label: `overshoot buy ${formatAtomsExact(ask.toString(), 9)} SOL (remaining ${formatAtomsExact(remaining.toString(), 9)})`, pool: L.prepared.poolPubkey, kp: trader, direction: "buy", amountUi: formatAtomsExact(ask.toString(), 9), slippageBps: 200, quote: "SOL", baseProgram: TOKEN_PROGRAM_ID, baseMint: L.prepared.baseMintPubkey });
      st.note(`mode ${r.q.mode}, fillable ${formatAtomsExact(r.q.fillableIn, 9)}, unused ${formatAtomsExact(r.q.unusedIn, 9)}, fee ${formatAtomsExact(r.q.feeAtoms, r.q.feeDecimals)}`);
      st.check(r.q.mode === "partial_fill" && r.q.completesCurve && BigInt(r.q.unusedIn) > 0n, `planned as partial_fill with unused input ${formatAtomsExact(r.q.unusedIn, 9)} SOL`);
      snap = await fetchPoolSnapshot(connection, pool);
      const added = BigInt(snap.quoteReserve) - reserveBefore;
      st.check(added <= BigInt(r.q.fillableIn), `curve took ${formatAtomsExact(added.toString(), 9)} SOL ≤ fillable ${formatAtomsExact(r.q.fillableIn, 9)} (not the full ${formatAtomsExact(ask.toString(), 9)})`);
      st.check(snap.curve.phase === "complete", `curve phase after one overshoot buy = ${snap.curve.phase} (reserve ${snap.quoteReserve} ≥ ${threshold})`);
      const g1 = graduationNumbers(snap);
      st.check(g1.known && g1.complete && g1.remaining === 0n, `graduationNumbers after: complete=${g1.known && g1.complete}, remaining 0`);
      st.done();
    } catch (e) {
      st.fail(e);
    }
  }

  if (want("S9")) {
    for (const [key, M] of Object.entries(migrated)) {
      const st = new Step("S9", `DAMM v2 on ${key} (${M.profile} base): resolve, quote + swap both directions, position fee claim`);
      try {
        const res = await resolveDammPoolAddress({ connection, baseMint: M.baseMint, quoteMint: QUOTE6.toBase58(), dammConfig: M.dammConfig });
        st.check(res.exists && res.address === M.dammPool, `resolveDammPoolAddress → ${res.address} exists=${res.exists} (${res.source})`);
        const snap = await fetchDammPoolSnapshot({ connection, pool: new PublicKey(M.dammPool), baseMint: M.baseMint, quoteMint: QUOTE6.toBase58(), source: res.source });
        const baseLtQuote = Buffer.compare(new PublicKey(M.baseMint).toBuffer(), QUOTE6.toBuffer()) < 0;
        st.note(`mint sort: base ${baseLtQuote ? "<" : ">"} quote; pool tokenA=${snap.tokenAMint === M.baseMint ? "base" : "quote"} (${snap.tokenADecimals} dec), tokenB=${snap.tokenBMint === M.baseMint ? "base" : "quote"} (${snap.tokenBDecimals} dec)`);
        st.addr("tokenA", snap.tokenAMint);
        st.addr("tokenB", snap.tokenBMint);
        const baseProg = M.profile === "open-spl" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
        void baseProg;
        for (const [direction, amountUi] of [["quote_to_base", "15.5"], ["base_to_quote", "250000"]] as const) {
          const q = await quoteDammSwap({ connection, pool: new PublicKey(M.dammPool), snap, direction, amountUi, slippagePct: 1 });
          st.check(BigInt(q.amountOut) > BigInt(q.minimumAmountOut), `${direction} quote: amountOut ${q.amountOut} > minimumAmountOut ${q.minimumAmountOut} (expected vs min are distinct)`);
          const expMin = (BigInt(q.amountOut) * 9_900n) / 10_000n;
          st.check(BigInt(q.minimumAmountOut) === expMin, `${direction}: min = amountOut × (1 − 1%) = ${expMin} (slippage applied as 100 bps)`);
          const inputIsBase = q.inputMint === M.baseMint;
          st.check(inputIsBase === (direction === "base_to_quote"), `${direction}: input mint is ${inputIsBase ? "base" : "quote"}; inputDecimals ${q.inputDecimals}`);
          // buildDammSwapTx re-fetches pool state before building.
          const { tx, quote } = await buildDammSwapTx({ connection, payer: trader.publicKey, pool: new PublicKey(M.dammPool), snap, direction, amountUi, slippagePct: 1 });
          const sig = await signAndSendTransaction({ connection, wallet: walletFor(trader), tx });
          st.sig(`DAMM swap ${direction} ${amountUi}`, sig);
          const t = await getTx(sig);
          const outMint = new PublicKey(quote.outputMint);
          const got = tokenDelta(t, trader.publicKey, outMint);
          const spent = -tokenDelta(t, trader.publicKey, new PublicKey(quote.inputMint));
          st.note(`${direction}: in ${formatAtomsExact(spent.toString(), quote.inputDecimals)} → out ${formatAtomsExact(got.toString(), quote.outputDecimals)} (quoted ${formatAtomsExact(quote.amountOut, quote.outputDecimals)}, min ${formatAtomsExact(quote.minimumAmountOut, quote.outputDecimals)})`);
          st.check(spent === BigInt(quote.amountIn), `${direction}: spent exactly amountIn ${quote.amountIn}`);
          st.check(got >= BigInt(quote.minimumAmountOut), `${direction}: received ≥ minimumAmountOut`);
          const diffBps = Number(((got - BigInt(quote.amountOut)) * 10_000n) / BigInt(quote.amountOut));
          st.check(Math.abs(diffBps) <= 100, `${direction}: received within 1% of quoted amountOut (diff ${diffBps} bps)`);
        }
        // Position fee claim for the migration position holder (partner = feeClaimer).
        const positions = await fetchUserDammPositions({ connection, pool: new PublicKey(M.dammPool), user: partner.publicKey });
        st.note(`partner DAMM positions: ${positions.length} (${positions.map((p) => `${p.position.slice(0, 6)}… feeA ${p.feeAPending} feeB ${p.feeBPending}`).join("; ")})`);
        const creatorPositions = await fetchUserDammPositions({ connection, pool: new PublicKey(M.dammPool), user: creator.publicKey });
        st.note(`creator DAMM positions: ${creatorPositions.length}`);
        st.check(positions.length > 0, "partner holds migration position(s)");
        for (const pos of positions) {
          const snap2 = await fetchDammPoolSnapshot({ connection, pool: new PublicKey(M.dammPool), baseMint: M.baseMint, quoteMint: QUOTE6.toBase58(), source: res.source });
          const tx = await buildClaimPositionFeeTx({ connection, owner: partner.publicKey, pool: new PublicKey(M.dammPool), snap: snap2, position: new PublicKey(pos.position), positionNftAccount: new PublicKey(pos.positionNftAccount) });
          const sig = await signAndSendTransaction({ connection, wallet: walletFor(partner), tx });
          st.sig(`claimPositionFee2 (partner position ${pos.position.slice(0, 6)}…)`, sig);
          const t = await getTx(sig);
          const gotQ = tokenDelta(t, partner.publicKey, QUOTE6);
          const gotB = tokenDelta(t, partner.publicKey, new PublicKey(M.baseMint));
          st.note(`claimed: quote ${formatAtomsExact(gotQ.toString(), 6)}, base ${formatAtomsExact(gotB.toString(), 9)}`);
          st.check(gotQ > 0n || gotB > 0n, "position fee claim transferred fees to holder");
          const quoteIsA = snap2.tokenAMint === QUOTE6.toBase58();
          const shownQ = BigInt(quoteIsA ? pos.feeAPending : pos.feeBPending);
          const shownB = BigInt(quoteIsA ? pos.feeBPending : pos.feeAPending);
          st.check(shownQ === gotQ && shownB === gotB, `UI "pending fees" before claim (quote ${shownQ}, base ${shownB}) = amounts actually claimed`);
        }
        st.done();
      } catch (e) {
        st.fail(e);
      }
    }
  }

  /* ---- S9b: DAMM v2 pool with tokenA = QUOTE (other token order) */
  if (want("S9") && migrated.SA) {
    const st = new Step("S9", "DAMM v2 custom pool with tokenA = quote, tokenB = base (reverse token order): app quote + swap both directions");
    try {
      const cp = getCpAmm(connection);
      const baseMint = new PublicKey(migrated.SA.baseMint);
      const positionNft = Keypair.generate();
      const tokenAAmount = new BN(20_000_000); // 20 stand-in quote
      const tokenBAmount = new BN(10_000_000).mul(new BN(1_000_000_000)); // 10M base
      const { initSqrtPrice, liquidityDelta } = cp.preparePoolCreationParams({ tokenAAmount, tokenBAmount, minSqrtPrice: MIN_SQRT_PRICE, maxSqrtPrice: MAX_SQRT_PRICE, collectFeeMode: 0 });
      const poolFees = {
        baseFee: getBaseFeeParams({ baseFeeMode: 0, feeTimeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } }),
        compoundingFeeBps: 0,
        padding: 0,
        dynamicFee: null,
      };
      const created = await cp.createCustomPool({
        payer: trader.publicKey, creator: trader.publicKey, positionNft: positionNft.publicKey,
        tokenAMint: QUOTE6, tokenBMint: baseMint, tokenAAmount, tokenBAmount,
        sqrtMinPrice: MIN_SQRT_PRICE, sqrtMaxPrice: MAX_SQRT_PRICE, liquidityDelta, initSqrtPrice,
        poolFees, hasAlphaVault: false, activationType: 1, collectFeeMode: 0, activationPoint: null,
        tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
      } as never);
      st.sig("fixture: createCustomPool (tokenA = stand-in quote) — test setup, not an app path", await sendLikeUi({ tx: created.tx, signer: trader, extraSigners: [positionNft] }));
      st.addr("customDammPool", created.pool.toBase58());
      const snap = await fetchDammPoolSnapshot({ connection, pool: created.pool, baseMint: baseMint.toBase58(), quoteMint: QUOTE6.toBase58(), source: "launch" });
      st.check(snap.tokenAMint === QUOTE6.toBase58() && snap.tokenBMint === baseMint.toBase58(), `pool tokenA = quote (${snap.tokenADecimals} dec), tokenB = base (${snap.tokenBDecimals} dec)`);
      for (const [direction, amountUi] of [["quote_to_base", "1.25"], ["base_to_quote", "100000"]] as const) {
        const { tx, quote } = await buildDammSwapTx({ connection, payer: other.publicKey, pool: created.pool, snap, direction, amountUi, slippagePct: 1 });
        st.check((direction === "quote_to_base") === (quote.inputMint === QUOTE6.toBase58()), `${direction}: input = ${quote.inputMint === QUOTE6.toBase58() ? "quote" : "base"} (inputDecimals ${quote.inputDecimals}, outputDecimals ${quote.outputDecimals})`);
        const sig = await signAndSendTransaction({ connection, wallet: walletFor(other), tx });
        st.sig(`DAMM swap ${direction} ${amountUi} (tokenA=quote pool)`, sig);
        const t = await getTx(sig);
        const got = tokenDelta(t, other.publicKey, new PublicKey(quote.outputMint));
        const spent = -tokenDelta(t, other.publicKey, new PublicKey(quote.inputMint));
        st.note(`${direction}: in ${formatAtomsExact(spent.toString(), quote.inputDecimals)} → out ${formatAtomsExact(got.toString(), quote.outputDecimals)} (quoted ${formatAtomsExact(quote.amountOut, quote.outputDecimals)}, min ${formatAtomsExact(quote.minimumAmountOut, quote.outputDecimals)})`);
        st.check(spent === BigInt(quote.amountIn), `${direction}: spent exactly amountIn`);
        st.check(got >= BigInt(quote.minimumAmountOut) && got <= BigInt(quote.amountOut) + 1n, `${direction}: minimumAmountOut ≤ received ≤ amountOut`);
      }
      st.done();
    } catch (e) {
      st.fail(e);
    }
  }

  /* ---- S10: failure paths */
  if (want("S10")) {
    const pool = launches.L1?.prepared.poolPubkey ?? launches.L2?.prepared.poolPubkey;
    // (a) expired blockhash at preflight
    {
      const st = new Step("S10", "Expired blockhash → mapped failure (never success)");
      try {
        if (!pool || !oldBh.bh) throw new Error("no SOL pool / blockhash available");
        const q = await quoteAndBuildSwap({ connection, owner: trader.publicKey, pool: new PublicKey(pool), direction: "buy", amountUi: "0.001", slippageBps: 100 });
        for (let i = 0; i < 120; i++) {
          const valid = await connection.isBlockhashValid(oldBh.bh, { commitment: "processed" });
          if (!valid.value) break;
          await sleep(2000);
        }
        st.note(`blockhash ${oldBh.bh} (captured at setup) is no longer valid`);
        q.tx.recentBlockhash = oldBh.bh;
        try {
          const sig = await signAndSendTransaction({ connection, wallet: walletFor(trader), tx: q.tx });
          st.check(false, `expired-blockhash tx reported success ${sig}`);
        } catch (e) {
          const m = mapError(e);
          st.note(`surfaced: kind=${m.kind} "${m.message}"`);
          st.check(m.kind === "blockhash_expired", `mapped as blockhash_expired (${m.kind})`);
        }
        // (a2) submitted but never lands (dropped) → confirmation ends with TX_EXPIRED, not success.
        const q2 = await quoteAndBuildSwap({ connection, owner: trader.publicKey, pool: new PublicKey(pool), direction: "buy", amountUi: "0.001", slippageBps: 100 });
        const dropConn = new Connection(RPC_URL, "confirmed");
        dropConn.sendRawTransaction = async () => "1111111111111111111111111111111111111111111111111111111111111111"; // simulate a dropped tx (never broadcast)
        const t0 = Date.now();
        try {
          await signAndSendTransaction({ connection: dropConn, wallet: walletFor(trader), tx: q2.tx });
          st.check(false, "dropped tx reported success");
        } catch (e) {
          const code = e instanceof EquiCurveError ? e.code : "?";
          st.note(`dropped tx after ${Math.round((Date.now() - t0) / 1000)}s: code=${code} "${(e as Error).message.slice(0, 200)}"`);
          st.check(code === "TX_EXPIRED" || mapError(e).kind === "blockhash_expired", `dropped tx → ${code} (blockhash window elapsed)`);
        }
        st.done();
      } catch (e) {
        st.fail(e);
      }
    }
    // (b) insufficient funds
    {
      const st = new Step("S10", "Insufficient funds → mapped failure");
      try {
        if (!pool) throw new Error("no SOL pool");
        const broke = Keypair.generate();
        await ensureSol(broke, 0.003, true);
        st.addr("brokeWallet", broke.publicKey.toBase58());
        const q = await quoteAndBuildSwap({ connection, owner: broke.publicKey, pool: new PublicKey(pool), direction: "buy", amountUi: "2", slippageBps: 100 });
        try {
          const sig = await signAndSendTransaction({ connection, wallet: walletFor(broke), tx: q.tx });
          st.check(false, `insufficient-funds tx reported success ${sig}`);
        } catch (e) {
          const m = mapError(e);
          st.note(`surfaced: kind=${m.kind} "${m.message}"`);
          st.check(m.kind === "insufficient_funds", `mapped as insufficient_funds (${m.kind})`);
        }
        st.done();
      } catch (e) {
        st.fail(e);
      }
    }
    // (c) degraded RPC
    {
      const st = new Step("S10", "Degraded RPC (bad URL) → unknown / rpc unavailable, never 0% or complete");
      try {
        const bad = new Connection("http://127.0.0.1:9", "confirmed");
        const target = pool ?? Object.values(migrated)[0]?.pool;
        if (!target) throw new Error("no pool to check");
        const l = await lookupPoolOnChain(bad, new PublicKey(target));
        st.check(l.status === "rpc_unavailable", `lookupPoolOnChain → ${l.status}`);
        const view = deriveGraduationView({ curve: null, tx: "idle", destination: "unchecked", config: null });
        st.check(view.state === "unknown" && !view.canMigrate, `graduation view with no read → ${view.state} (${view.label})`);
        const d = await verifyDammV2Pool(bad, new PublicKey(Object.values(migrated)[0]?.dammPool ?? target));
        st.check(d === "rpc_unavailable", `verifyDammV2Pool → ${d}`);
        const offering = {
          id: target, pool: target, mint: target, config: target, name: "x", ticker: "X", thesis: "x", sector: "Other", quote: "SOL",
          raiseTarget: 1, quoteProgress: 0.5, presetId: "flat", lockPct: null, status: "complete", statusSource: "registry",
          verification: { state: "not_checked", checkedAt: null, cluster: "devnet" }, profileSigned: true, createdAt: new Date().toISOString(),
          creator: target, cluster: "devnet", illustrative: false, source: "registry",
        } as unknown as ExploreOffering;
        const enr = await enrichOfferings([offering], { lookup: (p) => lookupPoolOnChain(bad, new PublicKey(p)), cluster: "devnet", timeoutMs: 20_000 });
        const o = enr.offerings[0];
        st.note(`explore offering after bad-RPC enrichment: verification=${o.verification.state}, status=${o.status}, quoteProgress=${o.quoteProgress}`);
        st.check(o.verification.state === "rpc_unavailable", "explore verification = rpc_unavailable");
        st.check(o.quoteProgress == null || o.quoteProgress !== 0, `explore progress not 0% (${o.quoteProgress})`);
        st.check(displayStatus(o) === "unknown", `card status shown = ${displayStatus(o)} (stored registry status "${o.status}" is not echoed as complete)`);
        st.done();
      } catch (e) {
        st.fail(e);
      }
    }
  }

  flush();
  const summary: Record<string, string[]> = {};
  for (const r of results) (summary[r.scenario] ??= []).push(r.status);
  log(`\n######## SUMMARY (${NETWORK})`);
  for (const [s, v] of Object.entries(summary)) log(`${s}: ${v.join(", ")}`);
  const failed = results.filter((r) => r.status === "fail");
  log(failed.length ? `FAILED steps: ${failed.map((f) => `${f.scenario}:${f.step}`).join(" | ")}` : "No failed steps.");
  void state;
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  log(`FATAL: ${e instanceof Error ? e.stack : String(e)}`);
  flush();
  process.exit(2);
});
