"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getClusterLabel, getCluster, getOptionalPoolConfigKey, isLocalRpc, WSOL_MINT } from "@/lib/constants";
import { launchCurveConfig, planLaunchAddresses, prepareLaunchTransaction } from "@/lib/dbc/create";
import { signLaunchPayload, type LaunchAuthPayload, type SignedLaunchBody } from "@/lib/auth/launchAuth";
import { getUsdcMint } from "@/lib/constants";
import { resolveMetadataUri } from "@/lib/metadata/client";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getPreset, MIN_LP_LOCK_PCT, tradingFeeSplit } from "@/lib/dbc/presets";
import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { canonicalConfigText, expectedFromConfig } from "@/lib/dbc/deploymentReadback";
import { buildLaunchReview, type LaunchReview, type ReviewRow } from "@/lib/dbc/launchReview";
import { fetchPoolSnapshot, expectedDammDestination } from "@/lib/dbc/migrate";
import { formatAtomsExact } from "@/lib/amounts";
import { setReceiptState, upsertReceiptItem, type LaunchReceipt } from "@/lib/dbc/receipt";
import { FeeSplitAnswer, LpLockAnswer } from "@/components/issuer/IssuerAnswers";
import { constraintFailureFromDesigned } from "@/lib/market/constraintNotice";
import { SEARCH_MAX_RAISE_UI } from "@/lib/market/searchDomain";
import { MarketDesignStep } from "./MarketDesignStep";
import { LaunchReceiptCard } from "./LaunchReceiptCard";
import { TokenImageUpload } from "./TokenImageUpload";
import type { ImageCheckResult } from "@/lib/metadata/imageCheck";
import type { PresetId } from "@/lib/dbc/types";
import { toUserMessage } from "@/lib/errors";
import { isLocalTokenImageUrl, normalizeHttpsUrl, normalizeXProfile, validateSeedBuy } from "@/lib/validation";
import { pushActivity, upsertLaunch } from "@/lib/local/launches";
import { registerLaunchRemote } from "@/lib/registry/client";
import { setFreshBlockhash, signAndSendTransaction } from "@/lib/send";
import { withReadConnection } from "@/lib/connection";
import { EligibilityGate, useEligibilityGate } from "@/components/gate/EligibilityGate";
import { clsx } from "clsx";
import { OfferingPreviewCard } from "./OfferingPreviewCard";
import {
  applyWizardPatch,
  canContinue,
  guardWizardStep,
  resolveWizardStep,
  stepErrors,
  INITIAL_WIZARD,
  stepIndex,
  WIZARD_STEPS,
  type WizardState,
  type WizardStepId,
} from "./wizardTypes";
import {
  isTransferHookProfileAvailable,
  TRANSFER_PROFILE_LABELS,
  type TransferProfile,
} from "@/lib/dbc/transferHook";

const ALL_PRESET_IDS: PresetId[] = [
  "short",
  "flat",
  "exponential",
  "long",
  "equity",
];

export function CreateWizard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const router = useRouter();
  const search = useSearchParams();

  const initialPreset = useMemo((): PresetId => {
    const q = search.get("preset");
    if (q && ALL_PRESET_IDS.includes(q as PresetId)) {
      return q as PresetId;
    }
    return "short";
  }, [search]);

  const initialState = useMemo<WizardState>(() => ({
    ...INITIAL_WIZARD,
    presetId: initialPreset,
  }), [initialPreset]);

  const initialStep = useMemo(
    (): WizardStepId => guardWizardStep(resolveWizardStep(search.get("step")), initialState),
    [search, initialState],
  );

  const [step, setStep] = useState<WizardStepId>(initialStep);
  const [state, setState] = useState<WizardState>(initialState);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [launchLog, setLaunchLog] = useState<string[]>([]);
  const [result, setResult] = useState<{
    pool: string;
    mint: string;
    config: string;
    sig: string;
  } | null>(null);
  const [receipt, setReceipt] = useState<LaunchReceipt | null>(null);
  const [launchKeypairs, setLaunchKeypairs] = useState<{ config: Keypair; baseMint: Keypair } | null>(null);
  const eligibility = useEligibilityGate();

  useEffect(() => {
    setLaunchKeypairs({ config: Keypair.generate(), baseMint: Keypair.generate() });
  }, []);

  const idx = stepIndex(step);
  const feePlatform = 100 - state.feeIssuer;
  const walletAddr = wallet.publicKey?.toBase58() ?? null;
  const review: LaunchReview = useMemo(() => {
    const built = buildLaunchReview({
      presetId: state.presetId,
      quote: state.quote,
      quoteMint: state.quote === "USDC" ? (getUsdcMint()?.toBase58() ?? null) : WSOL_MINT.toBase58(),
      transferProfile: state.transferProfile,
      totalSupply: state.totalSupply,
      creatorPct: state.feeIssuer,
      lpLockPct: state.lpLockPct,
      mintRenounce: state.mintRenounce,
      antiSniper: state.antiSniper,
      feeClaimer: state.feeClaimer,
      wallet: walletAddr,
      seedBuy: state.seedBuy,
      cluster: getClusterLabel(),
      sharedConfig: getOptionalPoolConfigKey()?.toBase58() ?? null,
      marketCaps: state.marketCaps ?? undefined,
    });
    if (!state.marketCaps || !state.designed) {
      built.errors.push(
        "No current market design is selected. Run the search and choose a candidate before review or deployment.",
      );
    } else if (built.configFingerprint !== state.designed.configFingerprint) {
      built.errors.push(
        "This review does not match the design that was simulated. Rerun the market design before deploying.",
      );
    }
    return built;
  }, [state, walletAddr]);
  const plannedAddresses = useMemo(
    () => launchKeypairs ? planLaunchAddresses({ quoteLabel: state.quote, keypairs: launchKeypairs }) : null,
    [launchKeypairs, state.quote],
  );

  function patch(p: Partial<WizardState>) {
    setState((s) => applyWizardPatch(s, p));
  }

  function go(next: WizardStepId, presetId?: PresetId) {
    const guarded = guardWizardStep(next, state);
    setShowErrors(false);
    setStep(guarded);
    const url = new URL(window.location.href);
    url.searchParams.set("step", guarded);
    url.searchParams.set("preset", presetId ?? state.presetId);
    window.history.replaceState({}, "", url.toString());
  }

  function onBack() {
    if (idx <= 0) return;
    go(WIZARD_STEPS[idx - 1].id);
  }

  function onContinue() {
    if (!canContinue(step, state)) {
      setShowErrors(true);
      const errs = Object.entries(stepErrors(step, state));
      toast.error(
        errs.length
          ? `${errs[0][0]}: ${errs[0][1]}`
          : "Complete required fields before continuing.",
      );
      return;
    }
    if (!eligibility.ok && !eligibility.ensure()) {
      return;
    }
    if (step === "review" && review.errors.length) {
      toast.error(review.errors[0]);
      return;
    }
    if (idx >= WIZARD_STEPS.length - 1) return;
    go(WIZARD_STEPS[idx + 1].id);
  }

  async function onLaunch() {
    if (!state.marketCaps || !state.designed) {
      toast.error("Design a market before deploying. The transaction builds that design's market caps.");
      return;
    }
    const acceptedWider = (state.designed.constraintPolicy?.relaxed.length ?? 0) > 0;
    if (state.designed.constraintsPassed !== true && !acceptedWider) {
      toast.error(
        "This design does not meet the requested constraints. Widen a limit in Market design and rerun the search before deploying.",
      );
      return;
    }
    if (getOptionalPoolConfigKey()) {
      toast.error(
        "A shared pool config is set. It cannot deploy this market design. Unset NEXT_PUBLIC_POOL_CONFIG_KEY, then rerun the search.",
      );
      return;
    }
    const signedConfig = (() => {
      try {
        const built = launchCurveConfig({
          presetId: state.presetId,
          totalSupply: state.totalSupply,
          creatorTradingFeePercentage: state.feeIssuer,
          lpLockPct: state.lpLockPct,
          mintRenounce: state.mintRenounce,
          antiSniper: state.antiSniper,
          quoteDecimals: state.quote === "USDC" ? 6 : 9,
          transferProfile: state.transferProfile,
          marketCaps: state.marketCaps,
        });
        if (marketConfigFingerprint(built) !== state.designed.configFingerprint) {
          toast.error("The transaction config does not match the simulated design. Rerun the market design before deploying.");
          return null;
        }
        return built;
      } catch (e) {
        toast.error(toUserMessage(e));
        return null;
      }
    })();
    if (!signedConfig) return;
    const expectedDesign = expectedFromConfig(signedConfig);
    if (!wallet.publicKey) {
      toast.error("Connect a wallet to launch on " + getCluster() + ".");
      return;
    }
    setBusy(true);
    setResult(null);
    setReceipt(null);
    setLaunchLog([`Preparing DBC createConfigAndPool (${state.quote} quote)…`]);
    const image = state.image.trim();
    let receiptRef: LaunchReceipt = { cluster: getClusterLabel(), items: [] };
    const rec = (next: LaunchReceipt) => {
      receiptRef = next;
      setReceipt(next);
    };
    try {
      if (image && !isLocalTokenImageUrl(image)) {
        const chk = (await fetch(`/api/image-check?url=${encodeURIComponent(image)}`, { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ ok: false, error: "image check failed (network)" }))) as ImageCheckResult;
        if (!chk.ok) throw new Error(`Token image rejected: ${chk.error}`);
      }
      if (!launchKeypairs) throw new Error("Launch identities are still being prepared. Try again in a moment.");
      const planned = planLaunchAddresses({ quoteLabel: state.quote, keypairs: launchKeypairs });
      const cluster = getCluster();
      const description = state.thesis.trim();
      const website = state.website.trim() ? normalizeHttpsUrl(state.website) : null;
      const xProfile = state.xProfile.trim() ? normalizeXProfile(state.xProfile) : null;
      if (state.website.trim() && !website) throw new Error("Website must be a valid HTTPS URL.");
      if (state.xProfile.trim() && !xProfile) throw new Error("X profile must be an https://x.com/<handle> URL.");
      const payload: LaunchAuthPayload = {
        v: 1,
        action: "launch",
        cluster,
        pool: planned.pool,
        mint: planned.mint,
        profile: {
          name: state.name.trim(),
          ticker: state.ticker.trim(),
          thesis: state.thesis.trim(),
          sector: state.sector,
          presetId: state.presetId,
          raiseTarget: state.raiseTarget,
          ...(website ? { website } : {}),
          ...(xProfile ? { xProfile } : {}),
        },
        metadata: {
          name: state.name.trim(),
          symbol: state.ticker.trim(),
          description,
          image,
          ...(website ? { external_url: website } : {}),
        },
        design: {
          fingerprint: state.designed.configFingerprint,
          migrationQuoteThresholdAtoms: expectedDesign.migrationQuoteThreshold,
          canonicalConfig: canonicalConfigText(signedConfig),
          expected: expectedDesign,
          profileName: (state.designed.profileName || state.presetId).slice(0, 80),
          constraintsPassed: state.designed.constraintsPassed === true,
          ...(state.designed.constraintPolicy ? { constraintPolicy: state.designed.constraintPolicy } : {}),
        },
      };

      // Creator signs the registry + metadata payload (binds pool + mint).
      // A public cluster stops here when that signature is missing. Local RPC still launches local-only.
      let signed: SignedLaunchBody | null = null;
      if (wallet.signMessage) {
        try {
          setLaunchLog((l) => [...l, "Sign the registry / metadata message in your wallet (no fee)…"]);
          signed = await signLaunchPayload({
            payload,
            signer: wallet.publicKey.toBase58(),
            signMessage: wallet.signMessage,
          });
        } catch (e) {
          setLaunchLog((l) => [
            ...l,
            isLocalRpc()
              ? `Message signature skipped (${toUserMessage(e)}) — offering stays local-only, metadata inline.`
              : `Message signature was not completed (${toUserMessage(e)}). The launch was not sent.`,
          ]);
        }
      } else {
        setLaunchLog((l) => [
          ...l,
          isLocalRpc()
            ? "Wallet does not support signMessage — offering stays local-only, metadata inline."
            : "This wallet cannot sign the registry message. The launch was not sent.",
        ]);
      }
      if (!signed && !isLocalRpc()) {
        throw new Error(
          "This deployment needs your wallet's registry signature before it can be sent. Without that signature the market would not be publicly discoverable. Sign the message, or use a wallet that supports signMessage.",
        );
      }

      const meta = await resolveMetadataUri({
        customUri: state.uri,
        signed,
        fallback: { name: state.name.trim(), symbol: state.ticker.trim(), description, image },
      });
      setLaunchLog((l) => [
        ...l,
        `Metadata: ${meta.source}${meta.note ? ` — ${meta.note}` : ""}`,
      ]);
      const payer = wallet.publicKey;
      if (!payer) throw new Error("Wallet disconnected before launch preparation.");
      const { prepared, transactions, signersPerTx } =
        await withReadConnection(connection, (readConnection) => prepareLaunchTransaction({
          connection: readConnection,
          payer,
          keypairs: launchKeypairs,
          input: {
            name: state.name,
            symbol: state.ticker,
            uri: meta.uri,
            presetId: state.presetId,
            totalSupply: state.totalSupply,
            creatorTradingFeePercentage: state.feeIssuer,
            lpLockPct: state.lpLockPct,
            mintRenounce: state.mintRenounce,
            seedBuyAmount: state.seedBuy,
            antiSniper: state.antiSniper,
            quoteLabel: state.quote,
            feeClaimer: state.feeClaimer.trim() || undefined,
            transferProfile: state.transferProfile,
            marketCaps: state.marketCaps ?? undefined,
          },
        }));
      if (prepared.poolPubkey !== planned.pool || prepared.baseMintPubkey !== planned.mint) {
        throw new Error("Internal error: planned pool/mint does not match the built transaction.");
      }
      setLaunchLog((l) => [
        ...l,
        `Mode: ${prepared.mode}`,
        `Quote: ${prepared.quoteLabel}`,
        `Transfer profile: ${prepared.transferProfile}`,
        `Creator fee share: ${prepared.creatorTradingFeePercentage}%`,
        `Partner LP lock: ${prepared.lpLockPct}%`,
        `Mint: ${prepared.mintRenounce ? "renounced (no mint auth)" : "retained"}`,
        prepared.seedBuyAtoms !== "0"
          ? `Seed buy: ${prepared.seedBuyDisplay} ${prepared.quoteLabel} → expected ${prepared.seedBuyExpectedOutAtoms} base atoms, minimum ${prepared.seedBuyMinimumOutAtoms} (${prepared.seedBuySlippageBps} bps)`
          : "Seed buy: none",
        `Config: ${prepared.configPubkey}`,
        `Mint: ${prepared.baseMintPubkey}`,
        `Pool: ${prepared.poolPubkey}`,
        `Transactions to sign: ${transactions.length}`,
      ]);

      let r0: LaunchReceipt = { cluster: getClusterLabel(), items: [] };
      r0 = upsertReceiptItem(r0, { key: "config", label: prepared.mode === "pool-only" ? "Config (shared)" : "Config", value: prepared.configPubkey, kind: "address", state: "estimate", note: "Planned address; confirmed once read back from chain." });
      r0 = upsertReceiptItem(r0, { key: "pool", label: "DBC pool", value: prepared.poolPubkey, kind: "address", state: "estimate", note: "Derived from quote mint + base mint + config." });
      r0 = upsertReceiptItem(r0, { key: "mint", label: "Base mint", value: prepared.baseMintPubkey, kind: "address", state: "estimate" });
      rec(r0);

      let lastSig = "";
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        await setFreshBlockhash(connection, tx, wallet.publicKey);
        const partial = signersPerTx[i] ?? [];
        if (partial.length) tx.partialSign(...partial);
        setLaunchLog((l) => [
          ...l,
          `Awaiting wallet signature (${i + 1}/${transactions.length})…`,
        ]);
        const txKey = `tx${i}`;
        const txLabel =
          transactions.length > 1
            ? i === 0
              ? "Tx 1 · create config"
              : `Tx ${i + 1} · create pool${prepared.seedBuyAtoms !== "0" ? " + seed buy" : ""}`
            : `Tx · create ${prepared.mode === "pool-only" ? "pool" : "config + pool"}${prepared.seedBuyAtoms !== "0" ? " + seed buy" : ""}`;
        try {
          lastSig = await signAndSendTransaction({
            connection,
            wallet,
            tx,
            onSubmitted: (sig) =>
              rec(upsertReceiptItem(receiptRef, { key: txKey, label: txLabel, value: sig, kind: "tx", state: "pending", note: "Submitted; waiting for confirmation." })),
          });
        } catch (e) {
          if (receiptRef.items.some((x) => x.key === txKey)) rec(setReceiptState(receiptRef, txKey, "failed", toUserMessage(e)));
          throw e;
        }
        rec(upsertReceiptItem(receiptRef, { key: txKey, label: txLabel, value: lastSig, kind: "tx", state: "confirmed", note: "Confirmed on-chain." }));
        setLaunchLog((l) => [...l, `TX ${i + 1}: ${lastSig}`]);
      }

      // A confirmed signature is not a verified deployment until readback matches.
      let snap;
      try {
        snap = await withReadConnection(connection, (readConnection) =>
          fetchPoolSnapshot(readConnection, new PublicKey(prepared.poolPubkey)),
        );
      } catch (e) {
        let r = receiptRef;
        for (const k of ["pool", "mint", "config"]) {
          r = setReceiptState(r, k, "failed", `Not read back (${toUserMessage(e)}).`);
        }
        rec(r);
        throw new Error(
          `Transaction confirmed (${lastSig}), but chain readback failed. It was not registered and is not marked verified. Check the explorer before launching again.`,
        );
      }
      const mintOk = snap.baseMint === prepared.baseMintPubkey;
      const configOk = snap.config === prepared.configPubkey && snap.configRead;
      const expectedThreshold = prepared.summary.migrationQuoteThresholdAtoms;
      const thresholdOk = !expectedThreshold || snap.migrationQuoteThreshold === expectedThreshold;
      let r = receiptRef;
      r = setReceiptState(r, "pool", "confirmed", "DBC pool account read back from chain.");
      r = setReceiptState(r, "mint", mintOk ? "confirmed" : "failed", mintOk ? "Pool's base mint matches." : `Pool reports base mint ${snap.baseMint}.`);
      r = setReceiptState(r, "config", configOk ? "confirmed" : "failed", configOk ? "Config account read back from chain." : "Config does not match this deployment.");
      if (snap.migrationQuoteThreshold && snap.quoteDecimals != null) {
        r = upsertReceiptItem(r, {
          key: "threshold",
          label: "Migration threshold",
          value: `${formatAtomsExact(snap.migrationQuoteThreshold, snap.quoteDecimals)} ${prepared.quoteLabel}`,
          kind: "text",
          state: thresholdOk ? "confirmed" : "failed",
          note: thresholdOk ? "Read from the on-chain config." : "On-chain threshold does not match the built config.",
        });
      }
      const dest = expectedDammDestination(snap);
      if (dest) {
        r = upsertReceiptItem(r, { key: "damm", label: "DAMM v2 pool after graduation", value: dest.dammPool.toBase58(), kind: "address", state: "estimate", note: "Derived address; the pool only exists after migration." });
      }
      rec(r);
      if (!mintOk || !configOk || !thresholdOk) {
        throw new Error(
          `Transaction confirmed (${lastSig}), but on-chain readback does not match this deployment. It was not registered and is not marked verified.`,
        );
      }
      rec(upsertReceiptItem(receiptRef, { key: "metadata", label: "Token metadata", value: meta.source === "hosted" ? meta.uri : meta.source === "custom" ? meta.uri : "inline data: URI", kind: "text", state: meta.source === "hosted" ? "confirmed" : meta.source === "custom" ? "estimate" : "local", note: meta.source === "hosted" ? "Hosted JSON written with your signature." : meta.source === "custom" ? "Custom URI; not fetched by EquiCurve." : meta.note }));

      setResult({
        pool: prepared.poolPubkey,
        mint: prepared.baseMintPubkey,
        config: prepared.configPubkey,
        sig: lastSig,
      });
      const launchRecord = {
        id: prepared.poolPubkey,
        pool: prepared.poolPubkey,
        mint: prepared.baseMintPubkey,
        config: prepared.configPubkey,
        name: state.name,
        ticker: state.ticker,
        thesis: state.thesis,
        sector: state.sector,
        quote: prepared.quoteLabel,
        raiseTarget: state.raiseTarget,
        website: website ?? undefined,
        xProfile: xProfile ?? undefined,
        image: image || undefined,
        presetId: state.presetId,
        designed: state.designed ?? undefined,
        feeBps: 0,
        feeIssuerPct: prepared.creatorTradingFeePercentage,
        lockPct: prepared.lpLockPct,
        mintRenounce: prepared.mintRenounce,
        attestations: {
          memo: state.docMemo,
          risk: state.docRisk,
          issuer: state.docIssuer,
          legal: state.docLegal,
          financials: state.docFinancials,
        },
        sig: lastSig,
        creator: wallet.publicKey.toBase58(),
        feeClaimer: prepared.feeClaimer,
        createdAt: new Date().toISOString(),
        cluster,
        status: "raising" as const,
      };
      upsertLaunch(launchRecord);
      if (signed) {
        // Server verifies the signature, re-reads the pool on-chain and checks
        // the signer is the pool creator before listing it.
        const reg = await registerLaunchRemote(signed);
        if (reg.ok) {
          // Mark the browser record as backed by the same signed registry write.
          upsertLaunch({ ...launchRecord, registryVerified: true });
        }
        setLaunchLog((l) => [
          ...l,
          reg.ok
            ? "Registry: listed (signature + on-chain creator verified)"
            : `Registry: not listed (${reg.error}) — saved in this browser only`,
        ]);
        rec(upsertReceiptItem(receiptRef, { key: "registry", label: "Registry listing", value: reg.ok ? "listed · server verified signature + on-chain creator" : `not listed · ${reg.error}`, kind: "text", state: reg.ok ? "confirmed" : "local" }));
      } else {
        setLaunchLog((l) => [...l, "Registry: skipped (unsigned) — saved in this browser only"]);
        rec(upsertReceiptItem(receiptRef, { key: "registry", label: "Registry listing", value: "skipped (unsigned) · saved in this browser only", kind: "text", state: "local" }));
      }
      pushActivity({
        id: `${lastSig}-launch`,
        pool: prepared.poolPubkey,
        mint: prepared.baseMintPubkey,
        kind: "launch",
        sig: lastSig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success("Offering live on curve");
      void router;
    } catch (err) {
      const msg = toUserMessage(err);
      setLaunchLog((l) => [...l, `Error: ${msg}`]);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EligibilityGate
      requireForAction={eligibility.needGate}
      onAccepted={eligibility.onAccepted}
    >
      <div className="ec-wizard grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[200px_minmax(0,1fr)] xl:gap-10">
        <nav aria-label="Create market steps" className="sticky top-[72px] z-30 -mx-5 min-w-0 self-start border-b border-line bg-base/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8 xl:top-24 xl:mx-0 xl:rounded-card xl:border xl:bg-elevated/50 xl:p-4">
          <p className="mb-5 hidden px-3 text-xs font-medium uppercase tracking-widest text-fg-muted xl:block">Market studio</p>
          <ol className="flex items-center gap-1 overflow-x-auto xl:flex-col xl:items-stretch xl:gap-2">
            {WIZARD_STEPS.map((s, i) => {
              const active = s.id === step;
              const done = i < idx;
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    disabled={i > idx}
                    aria-current={active ? "step" : undefined}
                    onClick={() => i <= idx && go(s.id)}
                    className={clsx(
                      "flex min-h-11 w-full items-center gap-3 whitespace-nowrap rounded-input px-3 py-3 text-sm font-medium transition-colors",
                      active && "bg-accent/10 text-accent",
                      done && !active && "text-fg-primary hover:bg-subtle",
                      !done && !active && "text-fg-muted",
                    )}
                  >
                    <span className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs", active ? "border-accent/30" : "border-line")}>{done ? "✓" : i + 1}</span>
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className={clsx("grid min-w-0 gap-8", step !== "design" && "lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,.8fr)] xl:grid-cols-[minmax(0,1.3fr)_minmax(260px,.8fr)]")}>
          <div className="min-w-0 space-y-6">
            {showErrors && Object.keys(stepErrors(step, state)).length > 0 && (
              <ul className="mb-4 space-y-1 rounded-input border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-signal-danger">
                {Object.entries(stepErrors(step, state)).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-medium">{k}</span>: {v}
                  </li>
                ))}
              </ul>
            )}
            {step === "basics" && <StepBasics state={state} patch={patch} />}
            {step === "goals" && <StepGoals state={state} patch={patch} />}
            {step === "terms" && (
              <StepFees
                state={state}
                patch={patch}
                feePlatform={feePlatform}
              />
            )}
            {step === "design" && (
              <MarketDesignStep state={state} patch={patch} onDeploy={(presetId) => go("review", presetId)} />
            )}
            {step === "review" && (
              <StepReview
                state={state}
                patch={patch}
                onEdit={go}
                review={review}
                walletAddr={walletAddr}
                planned={plannedAddresses}
              />
            )}
            {step === "launch" && (
              <StepLaunch
                state={state}
                busy={busy}
                log={launchLog}
                result={result}
                receipt={receipt}
                onLaunch={onLaunch}
                walletConnected={!!wallet.publicKey}
              />
            )}
          </div>
          {step !== "design" && <OfferingPreviewCard state={state} />}
        </div>

        {step !== "launch" && (
          <div className="sticky bottom-0 z-20 -mx-5 flex items-center justify-between gap-3 border-t border-line bg-base/95 px-5 py-4 backdrop-blur sm:mx-0 xl:col-start-2">
            <button
              type="button"
              onClick={onBack}
              disabled={idx === 0}
              className="ec-btn-secondary"
            >
              Back
            </button>
            <span className="text-center text-xs text-fg-muted">
              Step {idx + 1} of {WIZARD_STEPS.length}
              {!canContinue(step, state) && <span className="mt-1 block max-w-48">{step === "design" ? "Choose an eligible design to continue" : step === "review" ? "Complete the acknowledgements" : "Complete the required fields"}</span>}
            </span>
            <button
              type="button"
              onClick={onContinue}
              disabled={!canContinue(step, state) || (step === "review" && review.errors.length > 0)}
              className="ec-btn-primary"
            >
              Continue
            </button>
          </div>
        )}
        {step === "launch" && result && (
          <div className="flex flex-wrap gap-3">
            <Link href={`/o/${result.pool}`} className="ec-btn-primary">
              View offering
            </Link>
            <Link href={`/trade/${result.pool}`} className="ec-btn-secondary">
              Trade on curve
            </Link>
          </div>
        )}
      </div>
    </EligibilityGate>
  );
}

function StepBasics({
  state,
  patch,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}) {
  return (
    <section className="space-y-4">
      <header>
        <h1 className="ec-page-title">Give your market an identity.</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Name, ticker, thesis, and sector for your equity / RWA offering.
        </p>
      </header>
      <label className="block space-y-1.5">
        <span className="ec-label">Offering name</span>
        <input
          className="ec-input"
          maxLength={48}
          value={state.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Acme Equity Unit"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="ec-label">Ticker (2–8)</span>
        <input
          className="ec-input font-mono uppercase"
          maxLength={8}
          value={state.ticker}
          onChange={(e) =>
            patch({
              ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
            })
          }
          placeholder="ACME"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="ec-label">One-line thesis</span>
        <input
          className="ec-input"
          maxLength={140}
          value={state.thesis}
          onChange={(e) => patch({ thesis: e.target.value })}
          placeholder="Tokenized participating interest in Acme Labs Series A SPV."
        />
      </label>
      <label className="block space-y-1.5">
        <span className="ec-label">Sector</span>
        <select
          className="ec-input"
          value={state.sector}
          onChange={(e) =>
            patch({ sector: e.target.value as WizardState["sector"] })
          }
        >
          {["Equity", "RWA", "Fund", "Private Co", "Other"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-card border border-line bg-subtle/30 p-4">
        <p className="text-sm font-semibold text-fg-primary">Project presence</p>
        <p className="mt-1 text-xs text-fg-muted">These links are included in your creator-signed profile and shown beside the offering identity.</p>
      </div>
      <label className="block space-y-1.5">
        <span className="ec-label">Website (optional)</span>
        <input
          className="ec-input"
          value={state.website}
          onChange={(e) => patch({ website: e.target.value })}
          placeholder="https://"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="ec-label">X profile (optional)</span>
        <input
          className="ec-input"
          value={state.xProfile}
          onChange={(e) => patch({ xProfile: e.target.value })}
          placeholder="https://x.com/yourhandle"
          inputMode="url"
        />
        <p className="text-xs text-fg-muted">Creator-provided X · 1–15 letters, numbers or underscores.</p>
      </label>
      <TokenImageUpload
        value={state.image}
        onChange={(image) => patch({ image })}
        onStatusChange={(imageUploadState, imageUploadError) => patch({ imageUploadState, imageUploadError: imageUploadError ?? "" })}
      />
      <p className="rounded-input border border-line bg-subtle px-3 py-2 text-xs text-fg-muted">
        Name and ticker are written on-chain at launch and are <strong className="text-fg-primary">fixed forever</strong>{" "}
        (as is the mint address). After launch you can still edit the description, image and website with a
        wallet-signed update on the offering page. X is launch-bound in Phase 1 and is not an unsigned editable field.
      </p>
      <details className="rounded-xl border border-line p-4">
      <summary className="text-sm text-fg-secondary">Advanced metadata settings</summary>
      <label className="mt-4 block space-y-1.5">
        <span className="ec-label">Metadata URI (optional override)</span>
        <input
          className="ec-input font-mono text-xs"
          value={state.uri}
          onChange={(e) => patch({ uri: e.target.value })}
          placeholder="Leave blank to use /api/metadata/[mint]"
        />
        <p className="text-xs text-fg-muted">
          Blank → EquiCurve hosts JSON at{" "}
          <code className="text-accent-soft">/api/metadata/[id]</code>. Custom
          URI overrides this hosted metadata.
        </p>
      </label>
      </details>
    </section>
  );
}

function StepGoals({
  state,
  patch,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}) {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Market goals</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          The raise, the typical order, and who you expect to trade set the search. Asset kind changes the constraints.
          It does not make the token a share, and EquiCurve does not verify NAV or custody. Attestations stay in this
          browser.
        </p>
      </header>

      <div className="ec-card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-fg-primary">What the market should do</h2>
        <label className="block space-y-1.5">
          <span className="ec-label">Asset profile (design assumption, not a legal category)</span>
          <select
            className="ec-input"
            value={state.assetKind}
            onChange={(e) => patch({ assetKind: e.target.value as WizardState["assetKind"] })}
          >
            <option value="tokenized-equity">Tokenized equity</option>
            <option value="private-company">Private company</option>
            <option value="commodity">Commodity</option>
            <option value="rwa">Real-world asset</option>
            <option value="pre-launch">Pre-launch</option>
            <option value="ai-agent">AI agent</option>
            <option value="community">Community</option>
            <option value="speculative">Speculative</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">Market objective</span>
          <select
            className="ec-input"
            value={state.objective}
            onChange={(e) => patch({ objective: e.target.value as WizardState["objective"] })}
          >
            <option value="stable">Price stability</option>
            <option value="controlled-discovery">Controlled discovery</option>
            <option value="participation">Broad participation</option>
            <option value="fast-graduation">Fast graduation</option>
            <option value="long-runway">Long runway</option>
            <option value="whale-protection">Whale protection</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">Target raise ({state.quote} the curve must hold before graduation)</span>
          <input
            type="text"
            inputMode="decimal"
            className="ec-input font-mono"
            value={state.targetRaise}
            onChange={(e) => patch({ targetRaise: e.target.value.trim() })}
          />
          <p className="text-xs text-fg-muted">
            Market-cap search accepts a raise up to {SEARCH_MAX_RAISE_UI.toLocaleString("en-US")} {state.quote}. Above
            that, the search window would pass a market cap through a JavaScript number.
          </p>
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">Typical order ({state.quote})</span>
          <input
            type="text"
            inputMode="decimal"
            className="ec-input font-mono"
            value={state.typicalTrade}
            onChange={(e) => patch({ typicalTrade: e.target.value.trim() })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">Expected participants</span>
          <input
            type="number"
            min={1}
            max={1000000}
            className="ec-input font-mono"
            value={state.participants}
            onChange={(e) => patch({ participants: Number(e.target.value) })}
          />
          <p className="text-xs text-fg-muted">
            Retail and sell-pressure samples run at most 64 orders and say so. This is not a forecast of who will trade.
          </p>
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">Total supply (minted into the curve)</span>
          <input
            type="number"
            min={1}
            className="ec-input font-mono"
            value={state.totalSupply}
            onChange={(e) => patch({ totalSupply: Number(e.target.value) })}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="ec-label">Quote asset</legend>
          <div className="flex flex-wrap gap-2">
            {(["SOL", "USDC"] as const).map((q) => {
              const usdcOk = !!getUsdcMint();
              const disabled = q === "USDC" && !usdcOk;
              return (
                <button
                  key={q}
                  type="button"
                  disabled={disabled}
                  onClick={() => patch({ quote: q })}
                  className={
                    state.quote === q
                      ? "rounded-pill border border-accent/50 bg-accent/15 px-3 py-1.5 text-sm text-accent"
                      : "rounded-pill border border-line bg-subtle px-3 py-1.5 text-sm text-fg-secondary disabled:opacity-40"
                  }
                >
                  {q === "SOL" ? "SOL (WSOL)" : "USDC"}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-fg-muted">
            {state.quote === "USDC"
              ? "USDC is the on-chain quote mint. The target raise is what the search tries to hit as migrationQuoteThreshold."
              : "SOL (WSOL) is the on-chain quote. The target raise is what the search tries to hit as migrationQuoteThreshold."}
            {!getUsdcMint() && (
              <> USDC is unavailable on this cluster (no known mint).</>
            )}
          </p>
        </fieldset>

        
        <label className="block space-y-1.5">
          <span className="ec-label">
            Seed buy at launch ({state.quote} — wired into create TX when &gt; 0)
          </span>
          <input
            type="text"
            inputMode="decimal"
            className="ec-input font-mono"
            value={state.seedBuy}
            onChange={(e) => patch({ seedBuy: e.target.value.trim() })}
          />
          {validateSeedBuy(state.seedBuy, state.quote) && (
            <p className="text-xs text-signal-danger">
              {validateSeedBuy(state.seedBuy, state.quote)}
            </p>
          )}
          <p className="text-xs text-fg-muted">
            Uses SDK <code className="text-accent-soft">createConfigAndPoolWithFirstBuy</code>.
            Leave 0 to buy manually after launch.
          </p>
        </label>
      </div>

      <div className="ec-card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-fg-primary">
          Compliance &amp; disclosures
        </h2>
        <label className="block space-y-1.5">
          <span className="ec-label">Jurisdiction tags</span>
          <input
            className="ec-input"
            value={state.jurisdictions}
            onChange={(e) => patch({ jurisdictions: e.target.value })}
            placeholder="e.g. non-US, offshore SPV"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">Investor type</span>
          <select
            className="ec-input"
            value={state.investorType}
            onChange={(e) =>
              patch({
                investorType: e.target.value as WizardState["investorType"],
              })
            }
          >
            <option>Retail-friendly</option>
            <option>Restricted</option>
            <option>Accredited-oriented</option>
          </select>
        </label>
                <label className="block space-y-1.5">
          <span className="ec-label">Transfer profile</span>
          <select
            className="ec-input"
            value={state.transferProfile}
            onChange={(e) => {
              const next = e.target.value as TransferProfile;
              const nextPatch: Partial<WizardState> = { transferProfile: next };
              // Mint+update authority only valid for transfer-hook configs.
              if (next !== "transfer-hook" && !state.mintRenounce) {
                nextPatch.mintRenounce = true;
              }
              patch(nextPatch);
            }}
          >
            <option value="open-spl">{TRANSFER_PROFILE_LABELS["open-spl"]}</option>
            <option value="token-2022">
              {TRANSFER_PROFILE_LABELS["token-2022"]}
            </option>
            <option
              value="transfer-hook"
              disabled={!isTransferHookProfileAvailable()}
            >
              {TRANSFER_PROFILE_LABELS["transfer-hook"]}
              {!isTransferHookProfileAvailable()
                ? " (set NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM)"
                : ""}
            </option>
          </select>
          <p className="text-xs text-fg-muted">
            {state.transferProfile === "open-spl" &&
              "Standard SPL mint via createConfigAndPool. DAMM v2 graduation."}
            {state.transferProfile === "token-2022" &&
              "Token-2022 mint (metadata) via createConfigAndPool with TokenType.Token2022 — no transfer hook. DAMM v2 only."}
            {state.transferProfile === "transfer-hook" &&
              "Token-2022 + transfer hook via createConfigAndPoolWithTransferHook. Hook is revoked when the curve completes; then migrateToDammV2."}
          </p>
        </label>
        <div className="space-y-2">
          <p className="ec-label">
            Issuer attestation (stored locally — not uploaded)
          </p>
          {(
            [
              ["docMemo", "Offering memo (required)"],
              ["docRisk", "Risk factors (required)"],
              ["docIssuer", "Issuer identity summary (required)"],
              ["docLegal", "Legal opinion / counsel note (optional)"],
              ["docFinancials", "Financials / NAV note (optional)"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 text-sm text-fg-secondary"
            >
              <input
                type="checkbox"
                checked={state[key]}
                onChange={(e) => patch({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input
            type="checkbox"
            checked={state.geoBlockUs}
            onChange={(e) => patch({ geoBlockUs: e.target.checked })}
          />
          Show a US / OFAC restriction notice (display only — EquiCurve does not geo-block, verify location, or run KYC)
        </label>
      </div>
    </section>
  );
}

function StepFees({
  state,
  patch,
  feePlatform,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  feePlatform: number;
}) {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Terms</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Creator fee share, LP lock, and anti-sniper are written into both the simulation and the create transaction.
          Changing them clears a design you already selected. LP permanent lock ≥{MIN_LP_LOCK_PCT}% is enforced on-chain.
        </p>
      </header>
      <div className="ec-card space-y-4 p-5">
        <p className="text-xs text-fg-muted">
          Trading fee <em>schedule</em> (bps over time) comes from the selected
          curve preset — not a free-form total. Below is the creator/partner
          share of those fees.
        </p>
        <label className="block space-y-1.5">
          <span className="ec-label">
            Issuer (creator) fee share — {state.feeIssuer}% of the non-protocol part ={" "}
            {tradingFeeSplit(state.feeIssuer).creatorPct}% of each fee
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={state.feeIssuer}
            onChange={(e) => patch({ feeIssuer: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </label>
        <div className="grid items-end gap-4 sm:grid-cols-[110px_1fr]">
          <label className="space-y-2"><span className="ec-label">Creator share %</span><input type="number" min={0} max={100} value={state.feeIssuer} onChange={e => patch({ feeIssuer: Math.min(100, Math.max(0, Number(e.target.value))) })} className="ec-input tabular-nums" /></label>
          <div className="rounded-xl border border-line bg-base/40 p-4 text-xs text-fg-secondary">
            <p>Partner receives the remaining {feePlatform}% of the non-protocol share.</p>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full" role="img" aria-label={`Each fee: creator ${tradingFeeSplit(state.feeIssuer).creatorPct}%, partner ${tradingFeeSplit(state.feeIssuer).partnerPct}%, protocol 20%`}><span className="bg-accent" style={{ width: `${tradingFeeSplit(state.feeIssuer).creatorPct}%` }} /><span className="bg-signal-raise" style={{ width: `${tradingFeeSplit(state.feeIssuer).partnerPct}%` }} /><span className="bg-fg-muted" style={{ width: "20%" }} /></div>
            <p className="mt-3 leading-relaxed"><span className="text-accent">Creator {tradingFeeSplit(state.feeIssuer).creatorPct}%</span> · <span className="text-signal-raise">Partner {tradingFeeSplit(state.feeIssuer).partnerPct}%</span> · Protocol 20%</p>
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          Partner share accrues to feeClaimer. Default: deployer wallet.
          Optional advanced override below.
        </p>
        <label className="block space-y-1.5">
          <span className="ec-label">
            Partner fee claimer (optional advanced)
          </span>
          <input
            className="ec-input font-mono text-xs"
            placeholder="Leave blank to use your wallet"
            value={state.feeClaimer}
            onChange={(e) => patch({ feeClaimer: e.target.value.trim() })}
          />
          <p className="text-xs text-fg-muted">
            SDK feeClaimer pubkey. Blank = connected wallet receives partner
            remainder.
          </p>
        </label>
        <FeeSplitAnswer creatorPct={state.feeIssuer} feeLabel={getPreset(state.presetId).feeLabel} />
      </div>
      <div className="ec-card space-y-3 p-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.antiSniper}
            onChange={(e) => patch({ antiSniper: e.target.checked })}
          />
          Enable minimum fee on the first swap (anti-sniper setting)
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">
            Partner permanent LP lock % (≥{MIN_LP_LOCK_PCT}, on-chain)
          </span>
          <input
            type="number"
            min={MIN_LP_LOCK_PCT}
            max={100}
            className="ec-input font-mono"
            value={state.lpLockPct}
            onChange={(e) =>
              patch({
                lpLockPct: Math.max(
                  MIN_LP_LOCK_PCT,
                  Number(e.target.value) || MIN_LP_LOCK_PCT,
                ),
              })
            }
          />
          <p className="text-xs text-fg-muted">
            Maps to{" "}
            <code className="text-accent-soft">
              partnerPermanentLockedLiquidityPercentage
            </code>
            . Remainder stays as unlockable partner liquidity. Protocol minimum
            is {MIN_LP_LOCK_PCT}% (
            <code className="text-accent-soft">MIN_LOCKED_LIQUIDITY_BPS</code>).
          </p>
        </label>
        <LpLockAnswer lockPct={state.lpLockPct} />
        <fieldset className="space-y-2">
          <legend className="ec-label">Mint authority</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={state.mintRenounce}
              onChange={() => patch({ mintRenounce: true })}
            />
            Renounce on launch — CreatorUpdateAuthority (no mint auth)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={!state.mintRenounce}
              disabled={state.transferProfile !== "transfer-hook"}
              onChange={() => patch({ mintRenounce: false })}
            />
            Retain with disclosure — CreatorUpdateAndMintAuthority
            {state.transferProfile !== "transfer-hook" && (
              <span className="text-xs text-fg-muted">
                (transfer-hook profile only)
              </span>
            )}
          </label>
        </fieldset>
      </div>
    </section>
  );
}

const REVIEW_GROUPS: ReviewRow["group"][] = ["Token", "Curve", "Fees", "Liquidity", "Authorities", "Seed buy", "Network"];
const GROUP_STEP: Partial<Record<ReviewRow["group"], WizardStepId>> = {
  Token: "goals",
  Curve: "design",
  Fees: "terms",
  Liquidity: "terms",
  Authorities: "terms",
  "Seed buy": "goals",
};

function StepReview({
  state,
  patch,
  onEdit,
  review,
  walletAddr,
  planned,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  onEdit: (s: WizardStepId) => void;
  review: LaunchReview;
  walletAddr: string | null;
  planned: ReturnType<typeof planLaunchAddresses> | null;
}) {
  const claimer = state.feeClaimer.trim() || walletAddr;
  return (
    <section className="space-y-4">
      {state.designed?.constraintsPassed === false && (
        <div
          className="space-y-1 rounded-input border border-signal-warn/40 bg-signal-warn/10 px-4 py-3 text-sm"
          role="alert"
          data-testid="constraint-failure-review"
        >
          {(constraintFailureFromDesigned(state.designed) ?? []).map((line) => (
            <p key={line} className={line === "Constraint failure" ? "font-semibold text-fg-primary" : "text-fg-secondary"}>
              {line}
            </p>
          ))}
        </div>
      )}
      {state.designWhy.length > 0 && (
        <div className="ec-card space-y-2 p-4 text-sm">
          <p className="font-medium text-fg-primary">Why this design</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-fg-secondary">
            {state.designWhy.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {state.designLimits.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted">
              {state.designLimits.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {state.designed && (
            <p className="font-mono text-xs text-fg-muted">
              {state.designed.policyId} · config {state.designed.configHash} · fingerprint {state.designed.configFingerprint} ·
              review {review.configFingerprint} · model {state.designed.modelVersion} · seed {state.designed.seed}
            </p>
          )}
        </div>
      )}
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Policy review</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          This is exactly what the create transaction will write on {getClusterLabel()}, built with the same code path
          as Deploy. Name <strong className="text-fg-primary">{state.name}</strong> · ticker{" "}
          <strong className="text-fg-primary">${state.ticker}</strong> (fixed after launch). Bonding price ≠ NAV.
        </p>
      </header>
      <div className="ec-card space-y-2 p-4 text-xs" data-testid="planned-launch-identities">
        <p className="font-semibold text-fg-primary">Expected identities before signing</p>
        <dl className="grid gap-2 font-mono sm:grid-cols-2">
          <div><dt className="text-fg-muted">Expected mint</dt><dd className="break-all text-fg-primary">{planned?.mint ?? "Preparing…"}</dd></div>
          <div><dt className="text-fg-muted">Expected DBC config</dt><dd className="break-all text-fg-primary">{planned?.config ?? "Preparing…"}</dd></div>
          <div><dt className="text-fg-muted">Expected DBC pool</dt><dd className="break-all text-fg-primary">{planned?.pool ?? "Preparing…"}</dd></div>
          <div><dt className="text-fg-muted">Design fingerprint</dt><dd className="break-all text-fg-primary">{state.designed?.configFingerprint ?? "Missing design"}</dd></div>
          <div><dt className="text-fg-muted">Network</dt><dd className="text-fg-primary">{getClusterLabel()}</dd></div>
        </dl>
        <p className="text-fg-muted">These addresses come from the same keypairs and planning function used to build the transaction.</p>
      </div>
      {review.errors.length > 0 && (
        <ul className="space-y-1 rounded-input border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-signal-danger">
          {review.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="ec-card divide-y divide-line text-sm" data-testid="launch-review">
        {REVIEW_GROUPS.map((g) => {
          const rows = review.rows.filter((r) => r.group === g);
          if (!rows.length) return null;
          const editStep = GROUP_STEP[g];
          return (
            <div key={g} className="px-4 py-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{g}</p>
                {editStep && (
                  <button type="button" className="text-xs text-accent hover:underline" onClick={() => onEdit(editStep)}>
                    Edit
                  </button>
                )}
              </div>
              <dl className="space-y-1.5">
                {rows.map((r) => (
                  <div key={r.label} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
                    <dt className="text-xs text-fg-muted">{r.label}</dt>
                    <dd className="min-w-0 text-xs">
                      <span className="whitespace-pre-wrap break-all font-mono text-fg-primary">{r.value}</span>
                      {r.field && <span className="ml-2 font-mono text-xs text-fg-muted">{r.field}</span>}
                      {r.note && <span className="block text-xs text-fg-muted">{r.note}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
      <div className="ec-card space-y-2 p-4 text-sm">
        <p className="font-medium text-fg-primary">Acknowledgments</p>
        {(
          [
            ["ackBonding", "I understand the bonding price is set by the curve, not by NAV or fair value."],
            ["ackDocs", "I attested the required disclosures (stored in this browser, not uploaded or verified)."],
            [
              "ackFees",
              "I accept the fees above: 0.001 SOL pool creation fee, Meteora's 20% protocol share of trading fees, and a 1% DAMM v2 pool fee after migration (no separate migration fee in this config).",
            ],
            ["ackClaimer", `Partner fees and LP go to the fee claimer: ${claimer ?? "the connected wallet"}.`],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-start gap-2 text-fg-secondary">
            <input
              type="checkbox"
              className="mt-1"
              checked={state[key]}
              onChange={(e) => patch({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </section>
  );
}

function StepLaunch({
  state,
  busy,
  log,
  result,
  receipt,
  onLaunch,
  walletConnected,
}: {
  state: WizardState;
  busy: boolean;
  log: string[];
  result: { pool: string; mint: string; config: string; sig: string } | null;
  receipt: LaunchReceipt | null;
  onLaunch: () => void;
  walletConnected: boolean;
}) {
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Deploy this market design</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Signs a real Meteora DBC transaction on {getClusterLabel()} for{" "}
          <strong className="text-fg-primary">{state.name}</strong> ($
          {state.ticker}). The curve is the design you selected
          {state.marketCaps
            ? ` (${state.marketCaps.initial} → ${state.marketCaps.migration} ${state.quote} market cap)`
            : ""}. No mock success.
        </p>
      </header>
      {!state.designed && (
        <p className="rounded-input border border-signal-warn/30 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn">
          No current market design is selected. Go back, run the search, and choose a candidate. Deployment stays blocked
          until that design matches the transaction.
        </p>
      )}
      <ol className="ec-card space-y-2 p-4 text-sm text-fg-secondary">
        <li>1. Sign a free message binding the registry / metadata to the planned pool and mint</li>
        <li>2. Create DBC config (fee / lock / mint authority from your inputs)</li>
        <li>3. Create virtual pool + mint ({state.quote} quote)</li>
        <li>
          4.{" "}
          {state.seedBuy.trim() !== "" && !/^0*(\.0*)?$/.test(state.seedBuy.trim())
            ? `Seed buy ${state.seedBuy.trim()} ${state.quote} in the same flow`
            : "Optional seed buy skipped — trade after launch"}
        </li>
      </ol>
      <button
        type="button"
        disabled={busy || !walletConnected || !!result || !state.designed || !state.marketCaps}
        onClick={onLaunch}
        className="ec-btn-primary w-full sm:w-auto"
      >
        {busy
          ? "Preparing & signing…"
          : result
            ? "Launched"
            : walletConnected
              ? "Deploy this market design"
              : "Connect wallet to launch"}
      </button>
      {receipt && receipt.items.length > 0 && <LaunchReceiptCard receipt={receipt} />}
      {log.length > 0 && (
        <details className="ec-card p-4" open={!receipt}>
          <summary className="cursor-pointer text-xs text-fg-muted">Launch log</summary>
          <pre className="mt-2 max-h-64 overflow-auto font-mono text-xs text-fg-secondary">{log.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}
