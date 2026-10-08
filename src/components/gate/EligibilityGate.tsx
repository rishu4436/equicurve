"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import {
  hasSelfAttested as isEligible,
  saveEligibility,
} from "@/lib/local/eligibility";

type Props = {
  /** When true, force open until accepted (e.g. before trade). */
  requireForAction?: boolean;
  onAccepted?: () => void;
  children?: React.ReactNode;
};

type GateRequest = { required: boolean; accepted: () => void };
const GateContext = createContext<{
  register: (id: string, request: GateRequest) => () => void;
} | null>(null);

/**
 * Self-attestation & risk-disclosure prompt (NOT KYC). Stored only in this
 * browser; does not verify identity or enforce jurisdictional eligibility.
 * Shows on first visit and before Create / Trade actions.
 */
export function EligibilityGate({
  requireForAction = false,
  onAccepted,
  children,
}: Props) {
  const parent = useContext(GateContext);
  const parentRegister = parent?.register;
  const id = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const acceptedRef = useRef(onAccepted);
  acceptedRef.current = onAccepted;
  const requests = useRef(new Map<string, GateRequest>());
  const [requiredByChild, setRequiredByChild] = useState(false);
  const register = useCallback((key: string, request: GateRequest) => {
    requests.current.set(key, request);
    setRequiredByChild([...requests.current.values()].some(item => item.required));
    if (!isEligible()) setOpen(true);
    return () => {
      requests.current.delete(key);
      setRequiredByChild([...requests.current.values()].some(item => item.required));
    };
  }, []);
  const [open, setOpen] = useState(false);
  const [notUsPerson, setNotUsPerson] = useState(false);
  const [ageOk, setAgeOk] = useState(false);
  const [risksOk, setRisksOk] = useState(false);
  const [transferOk, setTransferOk] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false);
  const forced = requireForAction || requiredByChild;

  useEffect(() => parentRegister?.(id, { required: requireForAction, accepted: () => acceptedRef.current?.() }), [parentRegister, id, requireForAction]);

  useEffect(() => {
    if (!open || parent) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !forced) { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keyboard); previous?.focus(); };
  }, [open, parent, forced]);

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
    requests.current.forEach(request => request.accepted());
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
    <GateContext.Provider value={parent ?? { register }}>
      {children}
      {open && !parent && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-base/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          ref={dialogRef}
          tabIndex={-1}
        >
          <div className="ec-card max-h-[90dvh] w-full max-w-xl overflow-y-auto p-6 shadow-2xl sm:p-8">
            <p className="text-xs font-medium uppercase tracking-wider text-accent">
              EquiCurve
            </p>
            <h2
              id={titleId}
              className="mt-3 text-2xl font-semibold tracking-tight text-fg-primary"
            >
              Self-attestation &amp; risk disclosure
            </h2>
            <p className="mt-2 text-sm text-fg-secondary">
              This is a self-attestation, <strong>not KYC</strong>. EquiCurve does
              not verify your identity or location and does not enforce
              jurisdictional eligibility. Your answers are stored only in this
              browser. You are responsible for complying with the laws that apply
              to you.
            </p>

            <ul className="mt-6 space-y-4 rounded-xl border border-line bg-base/40 p-4 text-sm leading-relaxed text-fg-secondary">
              <li>
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-accent"
                    checked={notUsPerson}
                    onChange={(e) => setNotUsPerson(e.target.checked)}
                  />
                  <span>
                    I confirm I am not a US person and not located in a
                    jurisdiction where participating is prohibited (self-declared,
                    not verified).
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
                    I understand an offering may restrict transfers (e.g.
                    Token-2022 transfer hooks) independently of this prompt.
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
                  if (!forced) setOpen(false);
                }}
                disabled={forced}
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
            <p className="mt-3 text-xs leading-relaxed text-fg-muted">
              Declining keeps browse-only mode. The app asks for this
              acknowledgement before Create / Trade; it is not an access control.
            </p>
          </div>
        </div>
      )}
    </GateContext.Provider>
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
