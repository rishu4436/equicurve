"use client";

import { EligibilityGate } from "./EligibilityGate";

/** Soft first-visit gate — does not block browsing until Create/Trade. */
export function GlobalEligibility({ children }: { children: React.ReactNode }) {
  return <EligibilityGate>{children}</EligibilityGate>;
}
