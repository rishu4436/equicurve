"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { explorerAddressUrl, explorerTxUrl, getCluster } from "@/lib/constants";
import { prepareLaunchTransaction } from "@/lib/dbc/create";
import { getUsdcMint } from "@/lib/constants";
import { resolveMetadataUri } from "@/lib/metadata/client";
import { Keypair } from "@solana/web3.js";
import { CURVE_PRESETS, getPreset, MIN_LP_LOCK_PCT } from "@/lib/dbc/presets";
import type { PresetId } from "@/lib/dbc/types";
import { toUserMessage } from "@/lib/errors";
import { pushActivity, upsertLaunch } from "@/lib/local/launches";
import { registerLaunchRemote } from "@/lib/registry/client";
import { signAndSendTransaction } from "@/lib/send";
import { EligibilityGate, useEligibilityGate } from "@/components/gate/EligibilityGate";
import { clsx } from "clsx";
import { OfferingPreviewCard } from "./OfferingPreviewCard";
import {
  canContinue,
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
  const [launchLog, setLaunchLog] = useState<string[]>([]);
  const [result, setResult] = useState<{
    pool: string;
    mint: string;
    config: string;
    sig: string;
  } | null>(null);
  const eligibility = useEligibilityGate();

  const idx = stepIndex(step);
  const feePlatform = 100 - state.feeIssuer;

  function patch(p: Partial<WizardState>) {
    setState((s) => ({ ...s, ...p }));
  }

  function go(next: WizardStepId) {
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
      toast.error("Complete required fields before continuing.");
      return;
    }
    if (!eligibility.ok && !eligibility.ensure()) {
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
    setLaunchLog([`Preparing DBC createConfigAndPool (${state.quote} quote)…`]);
    try {
      const launchKeypairs = {
        config: Keypair.generate(),
        baseMint: Keypair.generate(),
      };
      const metadataUri = await resolveMetadataUri(state.uri, {
        id: launchKeypairs.baseMint.publicKey.toBase58(),
        name: state.name,
        symbol: state.ticker,
        description: state.thesis,
        website: state.website,
      });
      const { prepared, transactions, signersPerTx, keypairs } =
        await prepareLaunchTransaction({
          connection,
          payer: wallet.publicKey,
          keypairs: launchKeypairs,
          input: {
            name: state.name,
            symbol: state.ticker,
            uri: metadataUri,
            presetId: state.presetId,
            totalSupply: state.totalSupply,
            creatorTradingFeePercentage: state.feeIssuer,
            lpLockPct: state.lpLockPct,
            mintRenounce: state.mintRenounce,
            seedBuySol: state.seedBuy,
            antiSniper: state.antiSniper,
            quoteLabel: state.quote,
            feeClaimer: state.feeClaimer.trim() || undefined,
            transferProfile: state.transferProfile,
          },
        });
      setLaunchLog((l) => [
        ...l,
        `Mode: ${prepared.mode}`,
        `Quote: ${prepared.quoteLabel}`,
        `Transfer profile: ${prepared.transferProfile}`,
        `Creator fee share: ${prepared.creatorTradingFeePercentage}%`,
        `Partner LP lock: ${prepared.lpLockPct}%`,
        `Mint: ${prepared.mintRenounce ? "renounced (no mint auth)" : "retained"}`,
        prepared.seedBuySol > 0
          ? `Seed buy: ${prepared.seedBuySol} ${prepared.quoteLabel} (in create TX)`
          : "Seed buy: none",
        `Config: ${prepared.configPubkey}`,
        `Mint: ${prepared.baseMintPubkey}`,
        `Pool: ${prepared.poolPubkey}`,
        `Transactions to sign: ${transactions.length}`,
      ]);

      let lastSig = "";
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = wallet.publicKey;
        const partial = signersPerTx[i] ?? [];
        if (partial.length) tx.partialSign(...partial);
        setLaunchLog((l) => [
          ...l,
          `Awaiting wallet signature (${i + 1}/${transactions.length})…`,
        ]);
        lastSig = await signAndSendTransaction({ connection, wallet, tx });
        setLaunchLog((l) => [...l, `TX ${i + 1}: ${lastSig}`]);
      }

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
        cluster: getCluster(),
        status: "raising" as const,
      };
      upsertLaunch(launchRecord);
      void registerLaunchRemote(launchRecord);
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
                feePlatform={feePlatform}
              />
            )}
            {step === "launch" && (
              <StepLaunch
                state={state}
                busy={busy}
                log={launchLog}
                result={result}
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
            type="number"
            min={0}
            step={0.01}
            className="ec-input font-mono"
            value={state.seedBuy}
            onChange={(e) => patch({ seedBuy: Number(e.target.value) })}
          />
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
          Preview geo block: US / OFAC restricted (self-attest)
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
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Curve preset</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Official templates map to real{" "}
          <code className="text-accent-soft">buildCurveWithMarketCap</code>{" "}
          configs. Migration target is always DAMM v2. Prefer{" "}
          <strong className="text-fg-primary">Short raise</strong> to demo
          graduation quickly.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CURVE_PRESETS.filter((p) => OFFICIAL.includes(p.id)).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => patch({ presetId: p.id })}
            className={clsx(
              "ec-card p-4 text-left transition",
              state.presetId === p.id
                ? "border-accent/60 shadow-glow"
                : "hover:border-accent/30",
            )}
          >
            <CurveMiniViz preset={p.id} className="mb-2 h-12 w-full" />
            <p className="font-semibold text-fg-primary">{p.name}</p>
            <p className="text-xs text-accent-soft">{p.tagline}</p>
            <p className="mt-1 font-mono text-[10px] text-fg-muted">
              Migrate @ ${p.migrationMarketCap.toLocaleString()}
            </p>
          </button>
        ))}
      </div>
      <div className="ec-card space-y-2 p-4 text-sm">
        <p className="font-medium text-fg-primary">Selected: {selected.name}</p>
        <p className="text-fg-secondary">{selected.description}</p>
        <p className="font-mono text-xs text-fg-muted">
          Grad threshold ~${selected.migrationMarketCap.toLocaleString()} SOL
          quote · {selected.feeLabel}
        </p>
        <p className="text-xs text-signal-grad">
          Migration target: DAMM v2 (fixed — cannot pick v1)
        </p>
      </div>
      <p className="text-xs text-fg-muted">
        Equity-tuned preset also available via{" "}
        <button
          type="button"
          className="text-accent underline"
          onClick={() => patch({ presetId: "equity" })}
        >
          Use Equity-tuned
        </button>
        .
      </p>
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
            Issuer (creator) fee share — {state.feeIssuer}%
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
            Platform / partner fee share — {feePlatform}%
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
        </p>
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

function StepReview({
  state,
  patch,
  onEdit,
  feePlatform,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  onEdit: (s: WizardStepId) => void;
  feePlatform: number;
}) {
  const preset = getPreset(state.presetId);
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Review</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Confirm params before signing on {getCluster()}. Bonding price ≠ NAV.
          Quote is {state.quote}.
        </p>
      </header>
      <div className="ec-card divide-y divide-line text-sm">
        {(
          [
            [
              "basics",
              "Basics",
              `${state.name} · $${state.ticker} · ${state.sector}`,
            ],
            [
              "offering",
              "Offering",
              `Target $${state.raiseTarget.toLocaleString()} · quote ${state.quote} · seed ${state.seedBuy || 0} ${state.quote}`,
            ],
            [
              "curve",
              "Curve",
              `${preset.name} → DAMM v2 · ${preset.feeLabel}`,
            ],
            [
              "fees",
              "Fees & locks",
              `Creator ${state.feeIssuer}% / partner ${feePlatform}% · lock ${state.lpLockPct}% · mint ${state.mintRenounce ? "renounce" : "retain"}`,
            ],
          ] as const
        ).map(([id, title, summary]) => (
          <div
            key={id}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div>
              <p className="font-medium text-fg-primary">{title}</p>
              <p className="text-fg-secondary">{summary}</p>
            </div>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => onEdit(id)}
            >
              Edit
            </button>
          </div>
        ))}
      </div>
      <div className="ec-card space-y-2 p-4 text-sm">
        <p className="font-medium text-fg-primary">Risk acknowledgment</p>
        {(
          [
            ["ackBonding", "I understand bonding price ≠ NAV / fair value"],
            [
              "ackDocs",
              "I attested required disclosures (stored locally — not uploaded)",
            ],
            [
              "ackFees",
              "I accept Meteora migration fee (~0.2%) and EquiCurve terms",
            ],
            ["ackClaimer", "Deployer wallet will be fee claimer"],
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
      <div className="rounded-card border border-line bg-subtle/50 p-4 font-mono text-xs text-fg-muted">
        <p>Network: {getCluster()}</p>
        <p>Quote: {state.quote}</p>
        <p>Migration: DAMM v2</p>
        <p>
          Preset MC: {preset.initialMarketCap} → {preset.migrationMarketCap}
        </p>
        <p>
          On-chain: creatorTradingFeePercentage={state.feeIssuer},
          partnerPermanentLockedLiquidityPercentage={state.lpLockPct},
          TokenAuthorityOption=
          {state.mintRenounce
            ? "CreatorUpdateAuthority"
            : "CreatorUpdateAndMintAuthority"}
        </p>
      </div>
    </section>
  );
}

function StepLaunch({
  state,
  busy,
  log,
  result,
  onLaunch,
  walletConnected,
}: {
  state: WizardState;
  busy: boolean;
  log: string[];
  result: { pool: string; mint: string; config: string; sig: string } | null;
  onLaunch: () => void;
  walletConnected: boolean;
}) {
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Launch</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Signs a real Meteora DBC transaction on {getCluster()} for{" "}
          <strong className="text-fg-primary">{state.name}</strong> ($
          {state.ticker}). No mock success.
        </p>
      </header>
      <ol className="ec-card space-y-2 p-4 text-sm text-fg-secondary">
        <li>1. Create DBC config (fee / lock / mint authority from your inputs)</li>
        <li>2. Create virtual pool + mint ({state.quote} quote)</li>
        <li>
          3.{" "}
          {state.seedBuy > 0
            ? `Seed buy ${state.seedBuy} ${state.quote} in the same flow`
            : "Optional seed buy skipped — trade after launch"}
        </li>
      </ol>
      <button
        type="button"
        disabled={busy || !walletConnected}
        onClick={onLaunch}
        className="ec-btn-primary w-full sm:w-auto"
      >
        {busy
          ? "Preparing & signing…"
          : walletConnected
            ? "Sign & launch on DBC"
            : "Connect wallet to launch"}
      </button>
      {log.length > 0 && (
        <pre className="ec-card max-h-64 overflow-auto p-4 font-mono text-[11px] text-fg-secondary">
          {log.join("\n")}
        </pre>
      )}
      {result && (
        <div className="ec-card space-y-2 border-accent/40 p-4 text-xs">
          <p className="font-medium text-accent-soft">Live on curve</p>
          <p className="font-mono">
            tx:{" "}
            <a
              className="underline"
              href={explorerTxUrl(result.sig)}
              target="_blank"
              rel="noreferrer"
            >
              {result.sig.slice(0, 16)}…
            </a>
          </p>
          <p className="font-mono">
            pool:{" "}
            <a
              className="underline"
              href={explorerAddressUrl(result.pool)}
              target="_blank"
              rel="noreferrer"
            >
              {result.pool}
            </a>
          </p>
          <p className="font-mono">
            mint:{" "}
            <a
              className="underline"
              href={explorerAddressUrl(result.mint)}
              target="_blank"
              rel="noreferrer"
            >
              {result.mint}
            </a>
          </p>
          <p className="font-mono">
            config:{" "}
            <a
              className="underline"
              href={explorerAddressUrl(result.config)}
              target="_blank"
              rel="noreferrer"
            >
              {result.config}
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
