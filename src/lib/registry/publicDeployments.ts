import type { Sector } from "@/lib/demo/offerings";
import type { PresetId, QuoteLabel } from "@/lib/dbc/types";
import type { RegistryLaunch } from "./types";
import records from "./publicDeployments.json";

export type DeploymentChecks = {
  fingerprint: boolean;
  poolConfiguration: boolean;
  migrationThreshold: boolean;
  readback: boolean;
};

/** A public-devnet deploy whose readback matched the selected design. */
export type PublicDeployment = {
  network: "Solana Devnet";
  cluster: "devnet";
  pool: string;
  config: string;
  mint: string;
  creator: string;
  transaction: string;
  fingerprint: string;
  migrationQuoteThresholdAtoms: string;
  profileName: string;
  name: string;
  ticker: string;
  thesis: string;
  sector: Sector;
  presetId: PresetId;
  raiseTarget: number;
  quote: QuoteLabel;
  /** False when the preferred candidate missed an issuer constraint. */
  constraintsPassed: boolean;
  readbackPassed: boolean;
  checks: DeploymentChecks;
  deployedAt: string;
};

function isVerified(row: PublicDeployment): boolean {
  return (
    row.readbackPassed &&
    row.checks.fingerprint &&
    row.checks.poolConfiguration &&
    row.checks.migrationThreshold &&
    row.checks.readback
  );
}

export function listPublicDeployments(): PublicDeployment[] {
  return (records as PublicDeployment[]).filter(isVerified);
}

export function getPublicDeployment(pool: string): PublicDeployment | null {
  return listPublicDeployments().find((row) => row.pool === pool) ?? null;
}

/** Registry row for Explore. Chain fields are the recorded readback, not a client claim. */
export function deploymentToRegistryLaunch(row: PublicDeployment): RegistryLaunch {
  return {
    pool: row.pool,
    mint: row.mint,
    config: row.config,
    creator: row.creator,
    quoteMint: row.quote === "SOL" ? "So11111111111111111111111111111111111111112" : null,
    quote: row.quote,
    feeClaimer: row.creator,
    lockPct: null,
    creatorFeePct: null,
    status: "new",
    isMigrated: false,
    dammPool: null,
    name: row.name,
    ticker: row.ticker,
    thesis: row.thesis,
    sector: row.sector,
    presetId: row.presetId,
    raiseTarget: row.raiseTarget,
    cluster: row.cluster,
    createdAt: row.deployedAt,
    registeredAt: row.deployedAt,
    updatedAt: row.deployedAt,
    chainCheckedAt: null,
    authSigner: null,
    authIssuedAt: null,
  };
}
