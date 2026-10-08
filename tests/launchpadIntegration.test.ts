import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EquiCurveApiError,
  EquiCurveClient,
  EquiCurveProtocolError,
  EquiCurveTransportError,
  type ConfigResponse,
  type DesignRequest,
  type DesignResponse,
  type RobustnessResponse,
} from "../packages/equicurve-client/src";
import { runIntegration } from "../examples/launchpad-integration/run";

const fingerprint = "0123456789abcdef0123456789abcdef";
const alternateFingerprint = "fedcba9876543210fedcba9876543210";
const constraints = { maxThresholdGap: 0.05, maxReferenceImpactBps: 1200, maxWhaleImpactBps: 1800, maxConcentration: 0.55, minRetailProgress: 0.25 };
const journey: DesignRequest = {
  schemaVersion: "1",
  quote: "SOL",
  raiseTarget: "100",
  typicalTrade: "0.2",
  participants: 20,
  objective: "controlled-discovery",
  market: { asset: "private-company", stressPaths: 8, seed: 60428 },
  constraints,
};

function designResponse(accepted = false, schemaVersion = "1"): DesignResponse {
  const acceptedConstraints = accepted ? { ...constraints, minRetailProgress: 0.0384 } : constraints;
  return {
    ok: true,
    schemaVersion,
    engineVersion: "0.2.0",
    fingerprintVersion: "config-v1",
    result: {
      evaluated: 20,
      feasibleUnderRequestedConstraints: 0,
      deploymentAllowedUnderAppliedConstraints: accepted,
      policyId: "EQ-policy",
      configHash: "recipe-hash",
      requestedConstraints: constraints,
      acceptedConstraints,
      negotiation: { status: accepted ? "accepted" : "needs-decision" },
      conflicts: accepted ? [] : ["retail sample fills 4%"],
      preferred: { id: "candidate", profile: "Exponential · 3×", fingerprint, feasible: accepted },
      brief: {
        asset: "private-company",
        objective: "controlled-discovery",
        quote: "SOL",
        targetRaise: "100",
        typicalTrade: "0.2",
        participants: 20,
        stressPaths: 8,
        seed: 60428,
      },
    },
  };
}

function robustnessResponse(overrides: Partial<RobustnessResponse> = {}): RobustnessResponse {
  return {
    ok: true,
    schemaVersion: "1",
    engineVersion: "0.2.0",
    fingerprintVersion: "config-v1",
    design: { policyId: "EQ-policy", candidateId: "candidate", fingerprint },
    requestedConstraints: constraints,
    acceptedConstraints: { ...constraints, minRetailProgress: 0.0384 },
    robustness: { fingerprint, shockCount: 10, shockInsideCount: 8 },
    ...overrides,
  };
}

function configResponse(overrides: Partial<ConfigResponse> = {}): ConfigResponse {
  return {
    ok: true,
    schemaVersion: "1",
    engineVersion: "0.2.0",
    fingerprintVersion: "config-v1",
    design: { policyId: "EQ-policy", candidateId: "candidate", fingerprint },
    config: { migrationQuoteThreshold: "99999604415" },
    canonicalConfig: "canonical",
    integrity: { designFingerprint: fingerprint, configFingerprint: fingerprint, matches: true },
    ...overrides,
  };
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("EquiCurveClient", () => {
  it("deserializes design success and preserves zero feasible as success", async () => {
    const fetch = vi.fn(async () => response(designResponse()));
    const client = new EquiCurveClient({ baseUrl: "http://example.test/", fetch });
    const result = await client.design(journey);
    expect(result.result.evaluated).toBe(20);
    expect(result.result.feasibleUnderRequestedConstraints).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("maps API errors to EquiCurveApiError", async () => {
    const client = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async () => response({ ok: false, error: { code: "UNSUPPORTED_QUOTE", message: "SOL or USDC" } }, 422) });
    await expect(client.design(journey)).rejects.toBeInstanceOf(EquiCurveApiError);
    await expect(client.design(journey)).rejects.toMatchObject({ status: 422, code: "UNSUPPORTED_QUOTE" });
  });

  it("reports malformed or non-JSON HTTP responses as transport errors", async () => {
    const client = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async () => new Response("not json", { status: 502 }) });
    await expect(client.design(journey)).rejects.toBeInstanceOf(EquiCurveTransportError);
  });

  it("rejects schema version mismatches", async () => {
    const client = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async () => response(designResponse(false, "2")) });
    await expect(client.design(journey)).rejects.toBeInstanceOf(EquiCurveProtocolError);
  });

  it("turns malformed JSON-valid design success payloads into protocol errors", async () => {
    const client = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async () => response({ ok: true, schemaVersion: "1", engineVersion: "0.2.0", fingerprintVersion: "config-v1", result: {} }) });
    await expect(client.design(journey)).rejects.toBeInstanceOf(EquiCurveProtocolError);
  });

  it("turns malformed JSON-valid robustness and config success payloads into protocol errors", async () => {
    const robustnessClient = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async (input: string | URL | Request) => String(input).endsWith("/design") ? response(designResponse(true)) : response({ ok: true, schemaVersion: "1", engineVersion: "0.2.0", fingerprintVersion: "config-v1", design: { fingerprint }, robustness: {} }) });
    const robustnessReference = robustnessClient.getDesignReference(await robustnessClient.design(journey));
    await expect(robustnessClient.robustness(robustnessReference)).rejects.toBeInstanceOf(EquiCurveProtocolError);
    const configClient = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async (input: string | URL | Request) => String(input).endsWith("/design") ? response(designResponse(true)) : response({ ok: true, schemaVersion: "1", engineVersion: "0.2.0", fingerprintVersion: "config-v1", design: { fingerprint }, config: {}, canonicalConfig: "canonical", integrity: {} }) });
    const configReference = configClient.getDesignReference(await configClient.design(journey));
    await expect(configClient.buildConfig(configReference)).rejects.toBeInstanceOf(EquiCurveProtocolError);
  });

  it("extracts a minimal stateless reference without mutating the response", async () => {
    const source = designResponse(true);
    const before = structuredClone(source);
    const client = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async () => response(source) });
    const reference = client.getDesignReference(await client.design(journey));
    expect(reference).toEqual({ schemaVersion: "1", engineVersion: "0.2.0", fingerprintVersion: "config-v1", designRequest: { ...journey, acceptedConstraints: { ...constraints, minRetailProgress: 0.0384 } }, selection: { candidateId: "candidate", fingerprint } });
    expect(source).toEqual(before);
  });

  it("does not accept constraints automatically", () => {
    expect(journey.acceptedConstraints).toBeUndefined();
  });

  it("runs robustness and config through injected fetch", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      calls.push(path);
      if (path.endsWith("/design")) return response(designResponse(true));
      if (path.endsWith("/robustness")) return response(robustnessResponse());
      return response(configResponse());
    });
    const client = new EquiCurveClient({ baseUrl: "http://custom.test/", fetch });
    const accepted = await client.design({ ...journey, acceptedConstraints: { ...constraints, minRetailProgress: 0.0384 } });
    const reference = client.getDesignReference(accepted);
    const robustness = await client.robustness(reference);
    const config = await client.buildConfig(reference);
    expect(robustness.robustness.shockInsideCount).toBe(8);
    expect(config.integrity.matches).toBe(true);
    expect(calls).toEqual(["http://custom.test/api/v1/design", "http://custom.test/api/v1/robustness", "http://custom.test/api/v1/config"]);
  });

  it("fails closed on wrong fingerprints and version drift", async () => {
    const client = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async (input: string | URL | Request) => {
      const path = String(input);
      if (path.endsWith("/design")) return response(designResponse(true));
      if (path.endsWith("/robustness")) return response(robustnessResponse({ robustness: { fingerprint: alternateFingerprint, shockCount: 10, shockInsideCount: 8 } }));
      return response(configResponse({ engineVersion: "changed" }));
    } });
    const reference = client.getDesignReference(await client.design(journey));
    await expect(client.robustness(reference)).rejects.toBeInstanceOf(EquiCurveProtocolError);
    const configClient = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async (input: string | URL | Request) => {
      const path = String(input);
      if (path.endsWith("/design")) return response(designResponse(true));
      return response(configResponse({ integrity: { designFingerprint: fingerprint, configFingerprint: alternateFingerprint, matches: false } }));
    } });
    const configReference = configClient.getDesignReference(await configClient.design(journey));
    await expect(configClient.buildConfig(configReference)).rejects.toBeInstanceOf(EquiCurveProtocolError);
  });

  it("fails closed when a copied reference loses version metadata", async () => {
    const client = new EquiCurveClient({ baseUrl: "http://example.test", fetch: async () => response(designResponse(true)) });
    const reference = client.getDesignReference(await client.design(journey));
    const copied = JSON.parse(JSON.stringify(reference)) as Record<string, unknown>;
    delete copied.engineVersion;
    await expect(client.robustness(copied as never)).rejects.toBeInstanceOf(EquiCurveProtocolError);
  });

  it("checks pipeline versions and fingerprints together", () => {
    const client = new EquiCurveClient({ baseUrl: "http://example.test" });
    expect(() => client.assertPipelineIntegrity({ design: designResponse(true), robustness: robustnessResponse(), config: configResponse() })).not.toThrow();
    expect(() => client.assertPipelineIntegrity({ design: designResponse(true), robustness: { ...robustnessResponse(), engineVersion: "changed" }, config: configResponse() })).toThrow(EquiCurveProtocolError);
    expect(() => client.assertPipelineIntegrity({ design: designResponse(true), robustness: robustnessResponse(), config: configResponse({ integrity: { designFingerprint: fingerprint, configFingerprint: alternateFingerprint, matches: false } }) })).toThrow(EquiCurveProtocolError);
  });

  it("contains no internal imports or fingerprint calculation logic", () => {
    const roots = [resolve(process.cwd(), "packages/equicurve-client"), resolve(process.cwd(), "examples/launchpad-integration")];
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|md)$/.test(entry.name)) files.push(path);
      }
    };
    roots.forEach(walk);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (file.endsWith(".ts")) {
        expect(source, file).not.toMatch(/from\s+["']@\//);
        expect(source, file).not.toMatch(/from\s+["'](?:\.\.\/)+src\//);
        expect(source, file).not.toMatch(/designPolicy|assessRobustness|materializeRecipe|launchCurveConfig/);
        expect(source, file).not.toMatch(/sha256|marketConfigFingerprint|createHash|crypto/);
      }
    }
  });

  it("runs the launchpad example through EquiCurveClient", async () => {
    const originalFetch = globalThis.fetch;
    let designCalls = 0;
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.endsWith("/design")) return response(designResponse(++designCalls > 1));
      if (path.endsWith("/robustness")) return response(robustnessResponse());
      return response(configResponse());
    });
    try {
      const result = await runIntegration();
      expect(result.config.integrity.matches).toBe(true);
      expect(result.robustness.robustness.shockInsideCount).toBe(8);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
