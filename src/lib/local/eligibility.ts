/**
 * Self-attestation & risk-disclosure acknowledgement, stored ONLY in this
 * browser (localStorage / sessionStorage).
 *
 * This is NOT KYC: it does not verify identity, residency or location, and it
 * does not enforce jurisdictional eligibility. It is trivially bypassable by
 * editing browser storage. Never treat it as verified identity or location.
 */
export const ELIGIBILITY_KEY = "equicurve.eligibility.v1";
export const ELIGIBILITY_SESSION = "equicurve.eligibility.session";

export type EligibilityRecord = {
  acceptedAt: string;
  notUsPerson: boolean;
  ageOk: boolean;
  risksOk: boolean;
  transferOk: boolean;
  sessionOnly?: boolean;
};

export function getEligibility(): EligibilityRecord | null {
  if (typeof window === "undefined") return null;
  const session = sessionStorage.getItem(ELIGIBILITY_SESSION);
  if (session) {
    try {
      return JSON.parse(session) as EligibilityRecord;
    } catch {
      /* fall through */
    }
  }
  const raw = localStorage.getItem(ELIGIBILITY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EligibilityRecord;
  } catch {
    return null;
  }
}

/** True when the user ticked every self-attestation box in this browser. */
export function hasSelfAttested(): boolean {
  const r = getEligibility();
  return !!(r && r.notUsPerson && r.ageOk && r.risksOk && r.transferOk);
}

/**
 * @deprecated Misleading name — this is a local self-attestation, not an
 * eligibility check. Use {@link hasSelfAttested}.
 */
export const isEligible = hasSelfAttested;

export function saveEligibility(
  record: EligibilityRecord,
  sessionOnly: boolean,
): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ ...record, sessionOnly });
  if (sessionOnly) {
    sessionStorage.setItem(ELIGIBILITY_SESSION, payload);
  } else {
    localStorage.setItem(ELIGIBILITY_KEY, payload);
    sessionStorage.removeItem(ELIGIBILITY_SESSION);
  }
}

export function clearEligibility(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ELIGIBILITY_KEY);
  sessionStorage.removeItem(ELIGIBILITY_SESSION);
}
