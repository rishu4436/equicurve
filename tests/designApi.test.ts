import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { constraintsFor } from "@/lib/market/constraints";
import { configFromReference, designFromApiRequest, designRequestSchema, robustnessFromReference, selectedDesignReferenceSchema } from "@/lib/market/designApi";
import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { designPolicy, materializeRecipe } from "@/lib/market/policy";
import { POST } from "@/app/api/v1/design/route";
import { POST as robustnessPost } from "@/app/api/v1/robustness/route";
import { POST as configPost } from "@/app/api/v1/config/route";

const requested = constraintsFor("private-company", "controlled-discovery");

function journey(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1" as const,
    quote: "SOL" as const,
    raiseTarget: "100",
    typicalTrade: "0.2",
    participants: 20,
    objective: "controlled-discovery" as const,
    market: { asset: "private-company" as const, stressPaths: 8, seed: 0xec0c },
    constraints: {
      maxThresholdGap: requested.maxThresholdGap,
      maxReferenceImpactBps: requested.maxReferenceImpactBps,
      maxWhaleImpactBps: requested.maxWhaleImpactBps,
      maxConcentration: requested.maxConcentration,
      minRetailProgress: requested.minRetailProgress,
    },
    ...over,
  };
}

function acceptedJourney() {
  return journey({ acceptedConstraints: {
    maxThresholdGap: requested.maxThresholdGap,
    maxReferenceImpactBps: requested.maxReferenceImpactBps,
    maxWhaleImpactBps: requested.maxWhaleImpactBps,
    maxConcentration: requested.maxConcentration,
    minRetailProgress: 0.0384,
  }});
}

function selectedReference(accepted = true) {
  const input = designRequestSchema.parse(accepted ? acceptedJourney() : journey());
  const result = designFromApiRequest(input).result;
  return selectedDesignReferenceSchema.parse({
    schemaVersion: "1",
    engineVersion: "0.2.0",
    fingerprintVersion: "config-v1",
    designRequest: input,
    selection: { candidateId: result.preferred.id, fingerprint: result.preferred.fingerprint },
  });
}

describe("v0.3 design API application contract", () => {
  it("returns a stable machine error envelope for malformed JSON requests", async () => {
    const response = await POST(new Request("http://localhost/api/v1/design", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: "1" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });

  it("classifies an unsupported quote as a stable API error", async () => {
    const response = await POST(new Request("http://localhost/api/v1/design", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...journey(), quote: "BTC" }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_QUOTE" } });
  });

  it("parses a public Journey-shaped request and returns a valid zero-feasible result", () => {
    const parsed = designRequestSchema.parse(journey());
    const response = designFromApiRequest(parsed);
    expect(response.ok).toBe(true);
    expect(response.engineVersion).toBe("0.2.0");
    expect(response.fingerprintVersion).toBe("config-v1");
    expect(response.result.evaluated).toBe(20);
    expect(response.result.feasibleUnderRequestedConstraints).toBe(0);
    expect(response.result.deploymentAllowedUnderAppliedConstraints).toBe(false);
    expect(response.result.conflicts).toContain("retail sample fills 4%");
    expect(response.result.preferred.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(response.result.preferred.fingerprint).not.toBe("16ac1e49b68f4a4c");
  });

  it("keeps exact atom quantities as decimal strings", () => {
    const response = designFromApiRequest(designRequestSchema.parse(journey()));
    expect(typeof response.result.targetRaiseAtoms).toBe("string");
    expect(typeof response.result.preferred.thresholdAtoms).toBe("string");
    expect(response.result.candidates.every((row) => typeof row.thresholdAtoms === "string")).toBe(true);
    expect(response.result.candidates.every((row) => row.scenarios.every((scenario) => typeof scenario.quoteFilledAtoms === "string"))).toBe(true);
  });

  it("is deterministic for the same request and does not widen constraints implicitly", () => {
    const input = designRequestSchema.parse(journey());
    const first = designFromApiRequest(input);
    const second = designFromApiRequest(input);
    expect(second).toEqual(first);
    expect(first.result.acceptedConstraints).toEqual(first.result.requestedConstraints);
    expect(first.result.negotiation.status).toBe("needs-decision");
  });

  it("recalculates only when the caller explicitly accepts a wider budget", () => {
    const accepted = {
      maxThresholdGap: requested.maxThresholdGap,
      maxReferenceImpactBps: requested.maxReferenceImpactBps,
      maxWhaleImpactBps: requested.maxWhaleImpactBps,
      maxConcentration: requested.maxConcentration,
      minRetailProgress: 0.0384,
    };
    const response = designFromApiRequest(designRequestSchema.parse(journey({ acceptedConstraints: accepted })));
    expect(response.result.negotiation.status).toBe("accepted");
    expect(response.result.requestedConstraints.minRetailProgress).toBe(0.25);
    expect(response.result.acceptedConstraints.minRetailProgress).toBe(0.0384);
    expect(response.result.preferred.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(response.result.feasibleUnderRequestedConstraints).toBe(0);
    expect(response.result.deploymentAllowedUnderAppliedConstraints).toBe(true);
  });

  it("proves API serialization is a representation of the same engine result", () => {
    const input = designRequestSchema.parse(journey());
    const direct = designPolicy({
      asset: input.market.asset,
      objective: input.objective,
      quote: input.quote,
      targetRaise: input.raiseTarget,
      typicalTrade: input.typicalTrade,
      participants: input.participants,
      stressPaths: input.market.stressPaths,
      seed: input.market.seed,
    });
    const api = designFromApiRequest(input);
    expect(api.result.policyId).toBe(direct.policyId);
    expect(api.result.configHash).toBe(direct.configHash);
    expect(api.result.preferred.fingerprint).toBe(direct.chosen.configFingerprint);
    expect(api.result.candidates.map((row) => row.id)).toEqual(direct.candidates.map((row) => row.profileId));
  });

  it("rejects malformed, unsupported, and unsafe amount inputs", () => {
    expect(() => designRequestSchema.parse({ ...journey(), schemaVersion: "2" })).toThrow();
    expect(() => designRequestSchema.parse({ ...journey(), quote: "BTC" })).toThrow();
    expect(() => designRequestSchema.parse({ ...journey(), raiseTarget: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => designRequestSchema.parse({ ...journey(), constraints: { ...journey().constraints, maxConcentration: 2 } })).toThrow();
  });

  it("runs robustness for the exact accepted selected design", () => {
    const reference = selectedReference();
    const response = robustnessFromReference(reference);
    expect(response.design.fingerprint).toBe(reference.selection.fingerprint);
    expect(response.robustness.fingerprint).toBe(reference.selection.fingerprint);
    expect(response.robustness.shockCount).toBe(10);
    expect(response.robustness.shockInsideCount).toBe(8);
    expect(response.requestedConstraints.minRetailProgress).toBe(0.25);
    expect(response.acceptedConstraints.minRetailProgress).toBe(0.0384);
  });

  it("returns the shared stable error envelope for malformed downstream references", async () => {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: "1" }) };
    const robustnessResponse = await robustnessPost(new Request("http://localhost/api/v1/robustness", init));
    const configResponse = await configPost(new Request("http://localhost/api/v1/config", init));
    expect(robustnessResponse.status).toBe(400);
    expect(configResponse.status).toBe(400);
    expect(await robustnessResponse.json()).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await configResponse.json()).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });

  it("exposes the accepted pipeline through both versioned routes", async () => {
    const reference = selectedReference();
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(reference) };
    const robustnessResponse = await robustnessPost(new Request("http://localhost/api/v1/robustness", init));
    const configResponse = await configPost(new Request("http://localhost/api/v1/config", init));
    expect(robustnessResponse.status).toBe(200);
    expect(configResponse.status).toBe(200);
    expect((await robustnessResponse.json()).robustness.fingerprint).toBe(reference.selection.fingerprint);
    expect((await configResponse.json()).integrity.matches).toBe(true);
  });

  it("keeps robustness deterministic and never substitutes a candidate", () => {
    const reference = selectedReference();
    const first = robustnessFromReference(reference);
    const second = robustnessFromReference(reference);
    expect(second).toEqual(first);
    expect(second.design.candidateId).toBe(reference.selection.candidateId);
    expect(second.robustness.fingerprint).toBe(first.robustness.fingerprint);
  });

  it("rejects fabricated candidates and stale fingerprints before robustness", () => {
    const reference = selectedReference();
    expect(() => robustnessFromReference({ ...reference, selection: { ...reference.selection, candidateId: "made-up" } })).toThrow(/not found/);
    expect(() => robustnessFromReference({ ...reference, selection: { ...reference.selection, fingerprint: "00000000000000000000000000000000" } })).toThrow(/fingerprint/);
  });

  it("fails closed for cross-request candidate and stale accepted-budget reuse", () => {
    const referenceA = selectedReference();
    const requestB = designRequestSchema.parse({ ...acceptedJourney(), quote: "USDC" });
    expect(() => robustnessFromReference({ ...referenceA, designRequest: requestB })).toThrow(/fingerprint|not found/);
    const changedBudget = designRequestSchema.parse({ ...acceptedJourney(), acceptedConstraints: { ...acceptedJourney().constraints, minRetailProgress: requested.minRetailProgress } });
    expect(() => configFromReference({ ...referenceA, designRequest: changedBudget })).toThrow(/fingerprint|not deployable|not found/);
  });

  it("keeps accepted-constraint validation explicit at the API boundary", () => {
    const input = journey();
    expect(designRequestSchema.parse(input).acceptedConstraints).toBeUndefined();
    expect(designRequestSchema.parse({ ...input, acceptedConstraints: input.constraints }).acceptedConstraints).toEqual(input.constraints);
    for (const acceptedConstraints of [
      { ...input.constraints, minRetailProgress: -0.01 },
      { ...input.constraints, minRetailProgress: 1.01 },
      { ...input.constraints, unrelated: 1 },
      { minRetailProgress: 0.1 },
    ]) expect(() => designRequestSchema.parse({ ...input, acceptedConstraints })).toThrow();
    const stronger = designFromApiRequest(designRequestSchema.parse({ ...input, acceptedConstraints: { ...input.constraints, minRetailProgress: 0.5 } }));
    expect(stronger.result.acceptedConstraints.minRetailProgress).toBe(input.constraints.minRetailProgress);
  });

  it("builds canonical config from the same accepted selected design", () => {
    const reference = selectedReference();
    const response = configFromReference(reference);
    expect(response.integrity.matches).toBe(true);
    expect(response.integrity.designFingerprint).toBe(reference.selection.fingerprint);
    expect(response.integrity.configFingerprint).toBe(reference.selection.fingerprint);
    expect(response.config.curve.length).toBeGreaterThan(0);
    expect(typeof response.config.migrationQuoteThreshold).toBe("string");
    expect(response.config.quote).toMatchObject({ label: "SOL", decimals: 9, mint: expect.any(String) });
    expect(response.config.units.migrationQuoteThreshold).toBe("quote_atoms");
    expect(typeof response.canonicalConfig).toBe("string");
    expect(JSON.stringify(response)).not.toContain("bigint");
    expect(response.config.curve.every((point) => typeof point.sqrtPrice === "string" && typeof point.liquidity === "string")).toBe(true);
    expect(Object.values(response.config.migration).every((value) => typeof value === "string")).toBe(true);
  });

  it("uses the same canonical config builder and is repeatable", () => {
    const reference = selectedReference();
    const first = configFromReference(reference);
    const second = configFromReference(reference);
    const input = reference.designRequest;
    const policy = designPolicy({
      asset: input.market.asset,
      objective: input.objective,
      quote: input.quote,
      targetRaise: input.raiseTarget,
      typicalTrade: input.typicalTrade,
      participants: input.participants,
      stressPaths: input.market.stressPaths,
      seed: input.market.seed,
    }, { acceptedBudget: input.acceptedConstraints });
    const directFingerprint = marketConfigFingerprint(materializeRecipe(policy.chosen.recipe));
    expect(second).toEqual(first);
    expect(directFingerprint).toBe(first.integrity.configFingerprint);
  });

  it("rejects config for the initial zero-feasible policy", () => {
    expect(() => configFromReference(selectedReference(false))).toThrow(/not deployable/);
  });

  it("rejects fabricated candidates and wrong fingerprints before config construction", () => {
    const reference = selectedReference();
    expect(() => configFromReference({ ...reference, selection: { ...reference.selection, candidateId: "made-up" } })).toThrow(/not found/);
    expect(() => configFromReference({ ...reference, selection: { ...reference.selection, fingerprint: "00000000000000000000000000000000" } })).toThrow(/fingerprint/);
  });

  it("preserves one fingerprint across design, robustness, and config", () => {
    const reference = selectedReference();
    const design = designFromApiRequest(reference.designRequest).result;
    const robustness = robustnessFromReference(reference);
    const config = configFromReference(reference);
    expect(design.preferred.fingerprint).toBe(reference.selection.fingerprint);
    expect(robustness.robustness.fingerprint).toBe(reference.selection.fingerprint);
    expect(config.integrity.configFingerprint).toBe(reference.selection.fingerprint);
    expect(reference.selection.fingerprint).not.toBe("16ac1e49b68f4a4c");
  });

  it("keeps analysis routes outside wallet, transaction, registry, and metadata side-effect boundaries", () => {
    for (const route of ["design", "robustness", "config"]) {
      const source = readFileSync(resolve(process.cwd(), "src/app/api/v1", route, "route.ts"), "utf8");
      expect(source).not.toMatch(/sendTransaction|sendRawTransaction|wallet|privateKey|writeMetadata|writeRegistry|registerLaunch/);
    }
  });
});
