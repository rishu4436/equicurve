"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { explorerAddressUrl, explorerTxUrl, getCluster } from "@/lib/constants";
import { prepareLaunchTransaction } from "@/lib/dbc/create";
import { CURVE_PRESETS, getPreset } from "@/lib/dbc/presets";
import type { PresetId } from "@/lib/dbc/types";
import { toUserMessage } from "@/lib/errors";
import { pushActivity, upsertLaunch } from "@/lib/local/launches";
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

const OFFICIAL: PresetId[] = ["flat", "exponential", "long"];

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
    if (q && ["flat", "exponential", "long", "equity"].includes(q)) {
      return q as PresetId;
    }
    return "long";
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
    setLaunchLog(["Preparing DBC createConfigAndPool…"]);
    try {
      const { prepared, tx } = await prepareLaunchTransaction({
        connection,
        payer: wallet.publicKey,
        input: {
          name: state.name,
          symbol: state.ticker,
          uri: state.uri,
          presetId: state.presetId,
          totalSupply: state.totalSupply,
        },
      });
      setLaunchLog((l) => [
        ...l,
        `Mode: ${prepared.mode}`,
        `Config: ${prepared.configPubkey}`,
        `Mint: ${prepared.baseMintPubkey}`,
        `Pool: ${prepared.poolPubkey}`,
        "Awaiting wallet signature…",
      ]);
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      setLaunchLog((l) => [...l, `TX: ${sig}`]);
      setResult({
        pool: prepared.poolPubkey,
        mint: prepared.baseMintPubkey,
        config: prepared.configPubkey,
        sig,
      });
      upsertLaunch({
        id: prepared.poolPubkey,
        pool: prepared.poolPubkey,
        mint: prepared.baseMintPubkey,
        config: prepared.configPubkey,
        name: state.name,
        ticker: state.ticker,
        thesis: state.thesis,
        sector: state.sector,
        quote: state.quote,
        raiseTarget: state.raiseTarget,
        presetId: state.presetId,
        feeBps: state.totalTradingFeeBps,
        lockPct: state.lpLockPct,
        sig,
        creator: wallet.publicKey.toBase58(),
        createdAt: new Date().toISOString(),
        cluster: getCluster(),
        status: "raising",
      });
      pushActivity({
        id: `${sig}-launch`,
        pool: prepared.poolPubkey,
        mint: prepared.baseMintPubkey,
        kind: "launch",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success("Offering live on curve");
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
      {/* Stepper */}
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
          {step === "fees" && <StepFees state={state} patch={patch} />}
          {step === "review" && (
            <StepReview state={state} patch={patch} onEdit={go} />
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

      {/* Footer bar */}
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
            patch({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })
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
          Raise economics plus self-attested eligibility and disclosure checklist
          (MVP — no KYC vendor).
        </p>
      </header>

      <div className="ec-card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-fg-primary">Offer economics</h2>
        <label className="block space-y-1.5">
          <span className="ec-label">Raise target</span>
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
          <div className="flex gap-3">
            {(["USDC", "SOL"] as const).map((q) => (
              <label key={q} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={state.quote === q}
                  onChange={() => patch({ quote: q })}
                />
                {q}
                {q === "USDC" && (
                  <span className="text-xs text-fg-muted">(preferred)</span>
                )}
              </label>
            ))}
          </div>
          <p className="text-xs text-fg-muted">
            Soft/hard cap is a mental model for issuers; on-chain graduation uses
            the selected curve&apos;s migration market cap. Devnet launches quote
            against SOL (WSOL) via DBC today.
          </p>
        </fieldset>
        <label className="block space-y-1.5">
          <span className="ec-label">Initial seed buy (optional, quote units)</span>
          <input
            type="number"
            min={0}
            className="ec-input font-mono"
            value={state.seedBuy}
            onChange={(e) => patch({ seedBuy: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="ec-card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-fg-primary">
          Compliance & disclosures
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
            onChange={(e) =>
              patch({
                transferProfile: e.target
                  .value as WizardState["transferProfile"],
              })
            }
          >
            <option>Open SPL</option>
            <option>Token-2022 hook</option>
            <option>Hybrid</option>
          </select>
        </label>
        <div className="space-y-2">
          <p className="ec-label">Docs checklist (self-attest for MVP)</p>
          {(
            [
              ["docMemo", "Offering memo (required)"],
              ["docRisk", "Risk factors (required)"],
              ["docIssuer", "Issuer identity summary (required)"],
              ["docLegal", "Legal opinion / counsel note (optional)"],
              ["docFinancials", "Financials / NAV note (optional)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-fg-secondary">
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
          Official Flat / Exponential / Long templates map to real{" "}
          <code className="text-accent-soft">buildCurveWithMarketCap</code>{" "}
          configs. Migration target is always DAMM v2.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
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
          </button>
        ))}
      </div>
      <div className="ec-card space-y-2 p-4 text-sm">
        <p className="font-medium text-fg-primary">Selected: {selected.name}</p>
        <p className="text-fg-secondary">{selected.description}</p>
        <p className="font-mono text-xs text-fg-muted">
          Grad threshold ~${selected.migrationMarketCap.toLocaleString()} quote ·{" "}
          {selected.feeLabel}
        </p>
        <p className="text-xs text-signal-grad">
          Migration target: DAMM v2 (fixed — cannot pick v1)
        </p>
        <details className="pt-2 text-xs text-fg-muted">
          <summary className="cursor-pointer text-fg-secondary">
            Advanced / Invent export (read-only)
          </summary>
          <p className="mt-2">
            Best for: {selected.bestFor}. Config built via Meteora SDK{" "}
            <code>buildCurveWithMarketCap</code> with partner-locked LP post
            migration.
          </p>
        </details>
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
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
}) {
  const sum = state.feeIssuer + state.feePlatform + state.feeAdvisor;
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Fees & locks</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Issuer / platform / advisor split must sum to 100%. LP lock ≥10% is
          required.
        </p>
      </header>
      <div className="ec-card space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="ec-label">Total trading fee (bps)</span>
          <input
            type="number"
            min={1}
            max={1000}
            className="ec-input font-mono"
            value={state.totalTradingFeeBps}
            onChange={(e) =>
              patch({ totalTradingFeeBps: Number(e.target.value) })
            }
          />
        </label>
        {(
          [
            ["feeIssuer", "Issuer (deployer)"],
            ["feePlatform", "Platform (EquiCurve)"],
            ["feeAdvisor", "Advisors / partners"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block space-y-1.5">
            <span className="ec-label">
              {label} — {state[key]}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={state[key]}
              onChange={(e) => patch({ [key]: Number(e.target.value) })}
              className="w-full accent-accent"
            />
          </label>
        ))}
        <p
          className={clsx(
            "text-xs font-mono",
            sum === 100 ? "text-signal-grad" : "text-signal-danger",
          )}
        >
          Split sum: {sum}% {sum === 100 ? "✓" : "(must be 100)"}
        </p>
      </div>
      <div className="ec-card space-y-3 p-5">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.antiSniper}
            onChange={(e) => patch({ antiSniper: e.target.checked })}
          />
          Anti-sniper fee schedule (high → decay) — on by default for equity
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">LP lock % of migrated liquidity (≥10)</span>
          <input
            type="number"
            min={10}
            max={100}
            className="ec-input font-mono"
            value={state.lpLockPct}
            onChange={(e) => patch({ lpLockPct: Number(e.target.value) })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="ec-label">Vesting period (days)</span>
          <input
            type="number"
            min={1}
            max={730}
            className="ec-input font-mono"
            value={state.vestingDays}
            onChange={(e) => patch({ vestingDays: Number(e.target.value) })}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="ec-label">Mint authority</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={state.mintRenounce}
              onChange={() => patch({ mintRenounce: true })}
            />
            Renounce on launch
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={!state.mintRenounce}
              onChange={() => patch({ mintRenounce: false })}
            />
            Retain with disclosure
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
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  onEdit: (s: WizardStepId) => void;
}) {
  const preset = getPreset(state.presetId);
  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Review</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Confirm params before signing on {getCluster()}. Bonding price ≠ NAV.
        </p>
      </header>
      <div className="ec-card divide-y divide-line text-sm">
        {(
          [
            ["basics", "Basics", `${state.name} · $${state.ticker} · ${state.sector}`],
            [
              "offering",
              "Offering",
              `$${state.raiseTarget.toLocaleString()} ${state.quote} · ${state.investorType}`,
            ],
            ["curve", "Curve", `${preset.name} → DAMM v2 · ${preset.feeLabel}`],
            [
              "fees",
              "Fees & locks",
              `${state.feeIssuer}/${state.feePlatform}/${state.feeAdvisor} · lock ${state.lpLockPct}%`,
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
            ["ackDocs", "I uploaded / attested required disclosures"],
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
        <p>Migration: DAMM v2</p>
        <p>Preset MC: {preset.initialMarketCap} → {preset.migrationMarketCap}</p>
        <p>SDK: partner.createConfigAndPool / creator.createPool</p>
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
        <li>1. Create / confirm DBC config</li>
        <li>2. Create virtual pool + mint</li>
        <li>3. Optional seed buy (manual after launch)</li>
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
