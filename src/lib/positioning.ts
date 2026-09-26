/** Single source of truth for EquiCurve's product positioning copy. */
export const POSITIONING =
  "EquiCurve is an issuer-controlled launch and price-discovery interface for equity-inspired and RWA-related tokens.";

export const POSITIONING_SHORT =
  "Issuer-controlled launch and price discovery for equity-inspired and RWA-related tokens.";

export const NOT_A_SECURITIES_PLATFORM =
  "EquiCurve is software for launching tokens on Meteora's bonding curve. It is not a broker, exchange, transfer agent or securities platform, makes no claim of securities-law compliance, and does not create shareholder rights.";

export const EXPLAINER = [
  {
    id: "launch",
    title: "Token launch",
    who: "What EquiCurve does on-chain",
    body:
      "Creates a Meteora DBC config and pool, mints the token into the bonding curve, runs curve trades, and migrates liquidity to a DAMM v2 pool once the raise threshold is reached. Every step is a transaction you can verify on an explorer.",
    points: ["Fixed supply at launch (mint authority renounced by default)", "Fees and LP lock set in the config", "Graduation to DAMM v2 is permissionless"],
  },
  {
    id: "equity",
    title: "Equity representation",
    who: "The issuer's legal framework",
    body:
      "Whether a token represents any economic or governance interest in a company depends entirely on the issuer's own legal structure (for example an SPV, a note, or a membership agreement) and the law that applies to it. EquiCurve does not create, register or enforce shareholder rights.",
    points: ["Holding the token ≠ owning shares unless the issuer's documents say so", "Investor eligibility and offering rules are the issuer's responsibility", "EquiCurve's attestation checklist is self-reported, not reviewed"],
  },
  {
    id: "rwa",
    title: "RWA verification",
    who: "Independent of the curve",
    body:
      "For tokens tied to real-world assets, disclosures, custody of the asset, audits and redemption rights must be verified through the issuer and its custodians or auditors. The bonding curve prices demand for the token; it says nothing about the asset's existence, value or NAV.",
    points: ["Check custody and audit reports off-chain", "Redemption, if any, is an issuer promise, not a curve feature", "Curve price ≠ NAV or appraisal"],
  },
] as const;
