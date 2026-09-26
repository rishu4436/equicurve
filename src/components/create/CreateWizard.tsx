"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { getClusterLabel, getCluster, getOptionalPoolConfigKey, WSOL_MINT } from "@/lib/constants";
import { planLaunchAddresses, prepareLaunchTransaction } from "@/lib/dbc/create";
import { signLaunchPayload, type LaunchAuthPayload, type SignedLaunchBody } from "@/lib/auth/launchAuth";
import { getUsdcMint } from "@/lib/constants";
import { resolveMetadataUri } from "@/lib/metadata/client";
import { Keypair, PublicKey } from "@solana/web3.js";
import { CURVE_PRESETS, getPreset, MIN_LP_LOCK_PCT, tradingFeeSplit } from "@/lib/dbc/presets";
import { buildLaunchReview, type LaunchReview, type ReviewRow } from "@/lib/dbc/launchReview";
import { fetchPoolSnapshot, expectedDammDestination } from "@/lib/dbc/migrate";
import { formatAtomsExact } from "@/lib/amounts";
import { setReceiptState, upsertReceiptItem, type LaunchReceipt } from "@/lib/dbc/receipt";
import {
  FeeSplitAnswer,
  LpLockAnswer,
  PresetFacts,
  PresetShapeNote,
  presetThresholdLabel,
} from "@/components/issuer/IssuerAnswers";
import { LaunchReceiptCard } from "./LaunchReceiptCard";
import { ImageUrlField } from "./ImageUrlField";
import type { ImageCheckResult } from "@/lib/metadata/imageCheck";
import type { PresetId } from "@/lib/dbc/types";
import { toUserMessage } from "@/lib/errors";
import { validateSeedBuy } from "@/lib/validation";
import { pushActivity, upsertLaunch } from "@/lib/local/launches";
import { registerLaunchRemote } from "@/lib/registry/client";
import { setFreshBlockhash, signAndSendTransaction } from "@/lib/send";
import { EligibilityGate, useEligibilityGate } from "@/components/gate/EligibilityGate";
import { clsx } from "clsx";
import { OfferingPreviewCard } from "./OfferingPreviewCard";
import {
  canContinue,
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

const OFFICIAL: PresetId[] = ["short", "flat", "exponential", "long"];
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

  const initialStep = useMemo((): WizardStepId => {
    const q = search.get("step") as WizardStepId | null;
    if (q && WIZARD_STEPS.some((s) => s.id === q)) return q;
    return "basics";
  }, [search]);

  const initialPreset = useMemo((): PresetId => {
    const q = search.get("preset");
    if (q && ALL_PRESET_IDS.includes(q as PresetId)) {
      return q as PresetId;
    }
    return "short";
  }, [search]);

  const [step, setStep] = useState<WizardStepId>(initialStep);
  const [state, setState] = useState<WizardState>({
    ...INITIAL_WIZARD,
    presetId: initialPreset,
  });
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
  const eligibility = useEligibilityGate();

  const idx = stepIndex(step);
  const feePlatform = 100 - state.feeIssuer;
  const walletAddr = wallet.publicKey?.toBase58() ?? null;
  const review: LaunchReview = useMemo(
    () =>
      buildLaunchReview({
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
      }),
    [state, walletAddr],
  );

  function patch(p: Partial<WizardState>) {
    setState((s) => ({ ...s, ...p }));
  }

  function go(next: WizardStepId) {
    setShowErrors(false);
    setStep(next);
    const url = new URL(window.location.href);
    url.searchParams.set("step", next);
    url.searchParams.set("preset", state.presetId);
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
      if (image) {
        const chk = (await fetch(`/api/image-check?url=${encodeURIComponent(image)}`, { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({ ok: false, error: "image check failed (network)" }))) as ImageCheckResult;
        if (!chk.ok) throw new Error(`Token image rejected: ${chk.error}`);
      }
      const launchKeypairs = {
        config: Keypair.generate(),
        baseMint: Keypair.generate(),
      };
      const planned = planLaunchAddresses({ quoteLabel: state.quote, keypairs: launchKeypairs });
      const cluster = getCluster();
      const description = state.thesis.trim();
      const website = state.website.trim();
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
        },
        metadata: {
          name: state.name.trim(),
          symbol: state.ticker.trim(),
          description,
          image,
          ...(website ? { external_url: website } : {}),
        },
      };

      // Creator signs the registry + metadata payload (binds pool + mint).
      // Wallets without signMessage (or a declined prompt) → local-only record.
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
            `Message signature skipped (${toUserMessage(e)}) — offering stays local-only, metadata inline.`,
          ]);
        }
      } else {
        setLaunchLog((l) => [
          ...l,
          "Wallet does not support signMessage — offering stays local-only, metadata inline.",
        ]);
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
      const { prepared, transactions, signersPerTx } =
        await prepareLaunchTransaction({
          connection,
          payer: wallet.publicKey,
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
          },
        });
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
          ? `Seed buy: ${prepared.seedBuyDisplay} ${prepared.quoteLabel} (exact, in create TX)`
          : "Seed buy: none",
        `Config: ${prepared.configPubkey}`,
        `Mint: ${prepared.baseMintPubkey}`,
        `Pool: ${prepared.poolPubkey}`,
        `Transactions to sign: ${transactions.length}`,
      ]);

      const qDec = prepared.summary.quoteDecimals;
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

      // Read the pool back from chain before calling anything "confirmed".
      try {
        const snap = await fetchPoolSnapshot(connection, new PublicKey(prepared.poolPubkey));
        let r = receiptRef;
        r = setReceiptState(r, "pool", "confirmed", "DBC pool account read back from chain.");
        r = setReceiptState(r, "mint", snap.baseMint === prepared.baseMintPubkey ? "confirmed" : "failed", snap.baseMint === prepared.baseMintPubkey ? "Pool's base mint matches." : `Pool reports base mint ${snap.baseMint}.`);
        r = setReceiptState(r, "config", snap.config === prepared.configPubkey && snap.configRead ? "confirmed" : "failed", snap.configRead ? "Config account read back from chain." : "Config could not be read.");
        if (snap.migrationQuoteThreshold && snap.quoteDecimals != null) {
          r = upsertReceiptItem(r, { key: "threshold", label: "Migration threshold", value: `${formatAtomsExact(snap.migrationQuoteThreshold, snap.quoteDecimals)} ${prepared.quoteLabel}`, kind: "text", state: "confirmed", note: "Read from the on-chain config." });
        }
        const dest = expectedDammDestination(snap);
        if (dest) {
          r = upsertReceiptItem(r, { key: "damm", label: "DAMM v2 pool after graduation", value: dest.dammPool.toBase58(), kind: "address", state: "estimate", note: "Derived address; the pool only exists after migration." });
        }
        rec(r);
      } catch (e) {
        let r = receiptRef;
        for (const k of ["pool", "mint", "config"]) r = setReceiptState(r, k, "pending", `Not read back yet (${toUserMessage(e)}). Refresh the offering page.`);
        if (prepared.summary.migrationQuoteThresholdAtoms) {
          r = upsertReceiptItem(r, { key: "threshold", label: "Migration threshold", value: `${formatAtomsExact(prepared.summary.migrationQuoteThresholdAtoms, qDec)} ${prepared.quoteLabel}`, kind: "text", state: "estimate", note: "Computed from the preset; not yet read from chain." });
        }
        rec(r);
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
        presetId: state.presetId,
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
      <div className="space-y-6">
        <div className="sticky top-16 z-30 -mx-4 border-b border-line bg-base/95 px-4 py-3 backdrop-blur md:top-[4.5rem]">
          <ol className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
            {WIZARD_STEPS.map((s, i) => {
              const active = s.id === step;
              const done = i < idx;
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={i > idx}
                    onClick={() => i <= idx && go(s.id)}
                    className={clsx(
                      "rounded-pill px-3 py-1 text-xs font-medium transition",
                      active && "bg-accent/20 text-accent",
                      done && !active && "text-fg-primary hover:bg-subtle",
                      !done && !active && "text-fg-muted",
                    )}
                  >
                    <span className="mr-1 font-mono">{i + 1}</span>
                    {s.label}
                  </button>
                  {i < WIZARD_STEPS.length - 1 && (
                    <span className="hidden text-line sm:inline">→</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
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
            {step === "offering" && <StepOffering state={state} patch={patch} />}
            {step === "curve" && <StepCurve state={state} patch={patch} />}
            {step === "fees" && (
              <StepFees
                state={state}
                patch={patch}
                feePlatform={feePlatform}
              />
            )}
            {step === "review" && (
              <StepReview
                state={state}
                patch={patch}
                onEdit={go}
                review={review}
                walletAddr={walletAddr}
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
          <OfferingPreviewCard state={state} />
        </div>

        {step !== "launch" && (
          <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-between border-t border-line bg-base/95 px-4 py-3 backdrop-blur">
            <button
              type="button"
              onClick={onBack}
              disabled={idx === 0}
              className="ec-btn-secondary"
            >
              Back
            </button>
            <span className="text-xs text-fg-muted">
              Step {idx + 1} of {WIZARD_STEPS.length}
            </span>
            <button
              type="button"
              onClick={onContinue}
              disabled={!canContinue(step, state)}
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
        <h1 className="text-2xl font-semibold text-fg-primary">Basics</h1>
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
      <label className="block space-y-1.5">
        <span className="ec-label">Website (optional)</span>
        <input
          className="ec-input"
          value={state.website}
          onChange={(e) => patch({ website: e.target.value })}
          placeholder="https://"
        />
      </label>
      <ImageUrlField value={state.image} onChange={(image) => patch({ image })} />
      <p className="rounded-input border border-line bg-subtle px-3 py-2 text-xs text-fg-muted">
        Name and ticker are written on-chain at launch and are <strong className="text-fg-primary">fixed forever</strong>{" "}
        (as is the mint address). After launch you can still edit the description, image and website with a
        wallet-signed update on the offering page.
      </p>
      <label className="block space-y-1.5">
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
          URI overrides (no fake equicurve.dev placeholder).
        </p>
      </label>
    </section>
  );
}

function StepOffering({
  state,
  patch,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}) {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">
          Offering / compliance
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Raise economics plus issuer attestation checklist (stored locally —
          not an upload vault). MVP — no KYC vendor.
        </p>
      </header>

      <div className="ec-card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-fg-primary">Offer economics</h2>
        <label className="block space-y-1.5">
          <span className="ec-label">Raise target (display only)</span>
          <input
            type="number"
            min={1}
            className="ec-input font-mono"
            value={state.raiseTarget}
            onChange={(e) => patch({ raiseTarget: Number(e.target.value) })}
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
              ? "USDC is the on-chain quote mint for this launch. Seed buy amounts are in USDC. Soft raise target stays display-only."
              : "SOL (WSOL) is the default on-chain quote mint. Soft raise target is display-only; graduation uses the curve migration market cap."}
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

function StepCurve({
  state,
  patch,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}) {
  const selected = getPreset(state.presetId);
  const q = state.quote;
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Curve preset</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Each preset maps to a real <code className="text-accent-soft">buildCurveWithMarketCap</code> config for your
          quote asset (<strong className="text-fg-primary">{q}</strong>). Amounts below are in {q}, not dollars. Migration
          target is always DAMM v2.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CURVE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => patch({ presetId: p.id })}
            data-testid={`preset-${p.id}`}
            className={clsx(
              "ec-card p-4 text-left transition",
              state.presetId === p.id ? "border-accent/60 shadow-glow" : "hover:border-accent/30",
            )}
          >
            <CurveMiniViz preset={p.id} className="mb-2 h-12 w-full" />
            <p className="font-semibold text-fg-primary">
              {p.name}
              {!OFFICIAL.includes(p.id) && <span className="ml-1 text-[10px] font-normal text-gold">EquiCurve</span>}
            </p>
            <p className="text-xs text-accent-soft">{p.tagline}</p>
            <p className="mt-1 font-mono text-[10px] text-fg-muted">
              Graduates at {presetThresholdLabel(p.id, q)} raised
            </p>
          </button>
        ))}
      </div>
      <div className="ec-card space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium text-fg-primary">Selected: {selected.name}</p>
          <p className="font-mono text-xs text-accent-soft" data-testid="migration-threshold">
            Migration threshold: {presetThresholdLabel(state.presetId, q, 6)}
          </p>
        </div>
        <p className="text-fg-secondary">{selected.description}</p>
        <PresetFacts id={state.presetId} quote={q} />
        <p className="text-xs text-signal-grad">Migration target: DAMM v2 (fixed — cannot pick v1)</p>
      </div>
      <PresetShapeNote />
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
        <h1 className="text-2xl font-semibold text-fg-primary">Fees &amp; locks</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          DBC supports a two-way split:{" "}
          <code className="text-accent-soft">creatorTradingFeePercentage</code>{" "}
          (issuer) vs partner (feeClaimer). LP permanent lock ≥{MIN_LP_LOCK_PCT}%
          is enforced on-chain.
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
        <label className="block space-y-1.5">
          <span className="ec-label">
            Platform / partner fee share — {feePlatform}% ={" "}
            {tradingFeeSplit(state.feeIssuer).partnerPct}% of each fee (Meteora keeps 20%)
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={feePlatform}
            onChange={(e) =>
              patch({ feeIssuer: 100 - Number(e.target.value) })
            }
            className="w-full accent-accent"
          />
        </label>
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
          Anti-sniper: enable first-swap min fee (
          <code className="text-accent-soft">enableFirstSwapWithMinFee</code>)
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
          <legend className="ec-label">Mint authority (TokenAuthorityOption)</legend>
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
  Token: "offering",
  Curve: "curve",
  Fees: "fees",
  Liquidity: "fees",
  Authorities: "fees",
  "Seed buy": "offering",
};

function StepReview({
  state,
  patch,
  onEdit,
  review,
  walletAddr,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  onEdit: (s: WizardStepId) => void;
  review: LaunchReview;
  walletAddr: string | null;
}) {
  const claimer = state.feeClaimer.trim() || walletAddr;
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Review every on-chain setting</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          This is exactly what the create transaction will write on {getClusterLabel()}, built with the same code path
          as Launch. Name <strong className="text-fg-primary">{state.name}</strong> · ticker{" "}
          <strong className="text-fg-primary">${state.ticker}</strong> (fixed after launch). Bonding price ≠ NAV.
        </p>
      </header>
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
                      {r.field && <span className="ml-2 font-mono text-[10px] text-fg-muted">{r.field}</span>}
                      {r.note && <span className="block text-[10px] text-fg-muted">{r.note}</span>}
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
        <h1 className="text-2xl font-semibold text-fg-primary">Launch</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Signs a real Meteora DBC transaction on {getClusterLabel()} for{" "}
          <strong className="text-fg-primary">{state.name}</strong> ($
          {state.ticker}). No mock success.
        </p>
      </header>
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
        disabled={busy || !walletConnected || !!result}
        onClick={onLaunch}
        className="ec-btn-primary w-full sm:w-auto"
      >
        {busy
          ? "Preparing & signing…"
          : result
            ? "Launched"
            : walletConnected
              ? "Sign & launch on DBC"
              : "Connect wallet to launch"}
      </button>
      {receipt && receipt.items.length > 0 && <LaunchReceiptCard receipt={receipt} />}
      {log.length > 0 && (
        <details className="ec-card p-4" open={!receipt}>
          <summary className="cursor-pointer text-xs text-fg-muted">Launch log</summary>
          <pre className="mt-2 max-h-64 overflow-auto font-mono text-[11px] text-fg-secondary">{log.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}
