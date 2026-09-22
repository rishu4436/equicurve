"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isEligible,
  saveEligibility,
} from "@/lib/local/eligibility";

type Props = {
  /** When true, force open until accepted (e.g. before trade). */
  requireForAction?: boolean;
  onAccepted?: () => void;
  children?: React.ReactNode;
};

/**
 * xStocks-style self-attest eligibility / geo / risk gate (MVP, no KYC).
 * Shows on first visit; also blocks trade actions until accepted.
 */
export function EligibilityGate({
  requireForAction = false,
  onAccepted,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [notUsPerson, setNotUsPerson] = useState(false);
  const [ageOk, setAgeOk] = useState(false);
  const [risksOk, setRisksOk] = useState(false);
  const [transferOk, setTransferOk] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false);

  useEffect(() => {
    if (!isEligible()) setOpen(true);
  }, []);

  useEffect(() => {
    if (requireForAction && !isEligible()) setOpen(true);
  }, [requireForAction]);

  const allChecked = notUsPerson && ageOk && risksOk && transferOk;

  const accept = useCallback(() => {
    if (!allChecked) return;
    saveEligibility(
      {
        acceptedAt: new Date().toISOString(),
        notUsPerson,
        ageOk,
        risksOk,
        transferOk,
      },
      sessionOnly,
    );
    setOpen(false);
    onAccepted?.();
  }, [
    allChecked,
    notUsPerson,
    ageOk,
    risksOk,
    transferOk,
    sessionOnly,
    onAccepted,
  ]);

  return (
    <>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-base/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="eligibility-title"
        >
          <div className="ec-card max-h-[90vh] w-full max-w-md overflow-y-auto p-6 shadow-glow">
            <p className="text-xs font-medium uppercase tracking-wider text-accent">
              EquiCurve
            </p>
            <h2
              id="eligibility-title"
              className="mt-1 text-xl font-semibold text-fg-primary"
            >
              Eligibility &amp; risk disclosure
            </h2>
            <p className="mt-2 text-sm text-fg-secondary">
              Self-attestation only — no KYC vendor in this MVP. Offering-specific
              geo rules may still apply on-chain via transfer hooks.
            </p>

            <ul className="mt-5 space-y-3 text-sm text-fg-secondary">
              <li>
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-accent"
                    checked={notUsPerson}
                    onChange={(e) => setNotUsPerson(e.target.checked)}
                  />
                  <span>
                    I am not a US person and not in a prohibited jurisdiction
                    (offering-specific overrides may apply).
                  </span>
                </label>
              </li>
              <li>
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-accent"
                    checked={ageOk}
                    onChange={(e) => setAgeOk(e.target.checked)}
                  />
                  <span>I am 18 years of age or older.</span>
                </label>
              </li>
              <li>
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-accent"
                    checked={risksOk}
                    onChange={(e) => setRisksOk(e.target.checked)}
                  />
                  <span>
                    I understand smart-contract risk, that bonding price ≠ NAV /
                    fair value, and that I may lose capital.
                  </span>
                </label>
              </li>
              <li>
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-accent"
                    checked={transferOk}
                    onChange={(e) => setTransferOk(e.target.checked)}
                  />
                  <span>
                    I understand this offering may restrict transfers
                    (Token-2022 hooks / eligibility tags).
                  </span>
                </label>
              </li>
            </ul>

            <label className="mt-4 flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                className="accent-accent"
                checked={sessionOnly}
                onChange={(e) => setSessionOnly(e.target.checked)}
              />
              Don&apos;t show again this session only
            </label>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="ec-btn-secondary flex-1"
                onClick={() => {
                  if (!requireForAction) setOpen(false);
                }}
              >
                Decline
              </button>
              <button
                type="button"
                className="ec-btn-primary flex-1"
                disabled={!allChecked}
                onClick={accept}
              >
                Accept &amp; continue
              </button>
            </div>
            <p className="mt-3 text-[11px] text-fg-muted">
              Declining keeps browse-only mode. Create / Trade require acceptance.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/** Hook helpers for trade panels */
export function useEligibilityGate() {
  const [ok, setOk] = useState(false);
  const [needGate, setNeedGate] = useState(false);

  useEffect(() => {
    setOk(isEligible());
  }, []);

  const ensure = useCallback(() => {
    if (isEligible()) {
      setOk(true);
      return true;
    }
    setNeedGate(true);
    return false;
  }, []);

  return {
    ok,
    needGate,
    ensure,
    onAccepted: () => {
      setOk(true);
      setNeedGate(false);
    },
  };
}
