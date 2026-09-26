"use client";

import { EligibilityGate } from "./EligibilityGate";

/** First-visit self-attestation & risk disclosure (not KYC; browser-local). Does not block browsing. */
export function GlobalEligibility({ children }: { children: React.ReactNode }) {
  return <EligibilityGate>{children}</EligibilityGate>;
}
