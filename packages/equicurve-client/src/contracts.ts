export type Constraints = {
  maxThresholdGap: number;
  maxReferenceImpactBps: number;
  maxWhaleImpactBps: number;
  maxConcentration: number;
  minRetailProgress: number;
};

export type DesignRequest = {
  schemaVersion: "1";
  quote: "SOL" | "USDC";
  raiseTarget: string;
  typicalTrade: string;
  participants: number;
  objective: string;
  market: {
    asset: string;
    stressPaths?: number;
    seed?: number;
    totalSupply?: number;
    creatorPct?: number;
    lpLockPct?: number;
    antiSniper?: boolean;
  };
  constraints: Constraints;
  acceptedConstraints?: Constraints;
};

export type CandidateSummary = {
  id: string;
  profile: string;
  fingerprint: string;
  feasible: boolean;
  syntheticCohortGraduationFraction?: number;
  [key: string]: unknown;
};

export type DesignResponse = {
  ok: true;
  schemaVersion: string;
  engineVersion: string;
  fingerprintVersion: string;
  result: {
    evaluated: number;
    feasibleUnderRequestedConstraints: number;
    deploymentAllowedUnderAppliedConstraints: boolean;
    policyId: string;
    configHash: string;
    requestedConstraints: Constraints;
    acceptedConstraints: Constraints;
    negotiation: Record<string, unknown>;
    conflicts: string[];
    preferred: CandidateSummary;
    [key: string]: unknown;
  };
};

export type DesignReference = {
  schemaVersion: "1";
  engineVersion: string;
  fingerprintVersion: string;
  designRequest: DesignRequest;
  selection: {
    candidateId: string;
    fingerprint: string;
  };
};

export type RobustnessResponse = {
  ok: true;
  schemaVersion: string;
  engineVersion: string;
  fingerprintVersion: string;
  design: { policyId: string; candidateId: string; fingerprint: string };
  requestedConstraints: Constraints;
  acceptedConstraints: Constraints;
  robustness: {
    fingerprint: string;
    shockCount: number;
    shockInsideCount: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ConfigResponse = {
  ok: true;
  schemaVersion: string;
  engineVersion: string;
  fingerprintVersion: string;
  design: { policyId: string; candidateId: string; fingerprint: string };
  config: Record<string, unknown>;
  canonicalConfig: string;
  integrity: { designFingerprint: string; configFingerprint: string; matches: boolean };
  [key: string]: unknown;
};

export type ApiErrorEnvelope = {
  ok: false;
  error?: { code?: string; message?: string; issues?: unknown[] };
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
