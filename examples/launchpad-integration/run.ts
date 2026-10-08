import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import {
  EquiCurveClient,
  type ConfigResponse,
  type DesignRequest,
  type DesignResponse,
  type RobustnessResponse,
} from "../../packages/equicurve-client/src";

const BASE_URL = (process.env.EQUICURVE_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export function buildAcceptedRequest(original: DesignRequest, initial: DesignResponse): DesignRequest {
  if (initial.result.deploymentAllowedUnderAppliedConstraints || initial.result.feasibleUnderRequestedConstraints !== 0) {
    throw new Error("Initial Journey design did not produce the expected zero-feasible conflict.");
  }
  return {
    ...original,
    acceptedConstraints: {
      ...initial.result.requestedConstraints,
      minRetailProgress: 0.0384,
    },
  };
}

async function loadJourneyRequest(): Promise<DesignRequest> {
  const fixture = await readFile(resolve(process.cwd(), "examples/launchpad-integration/journey-request.json"), "utf8");
  return JSON.parse(fixture) as DesignRequest;
}

export async function runIntegration() {
  const started = performance.now();
  const client = new EquiCurveClient({ baseUrl: BASE_URL });
  const original = await loadJourneyRequest();
  const initial = await client.design(original);
  const initialDesign = initial.result;
  if (initialDesign.feasibleUnderRequestedConstraints !== 0 || initialDesign.deploymentAllowedUnderAppliedConstraints) throw new Error("Initial Journey policy unexpectedly became deployable.");
  if (initialDesign.conflicts.length === 0) throw new Error("Initial Journey policy did not report a blocking conflict.");

  const acceptedRequest = buildAcceptedRequest(original, initial);
  if (acceptedRequest.constraints.minRetailProgress !== 0.25 || acceptedRequest.acceptedConstraints?.minRetailProgress !== 0.0384) throw new Error("The explicit issuer acceptance was not preserved.");
  const accepted = await client.design(acceptedRequest);
  if (!accepted.result.deploymentAllowedUnderAppliedConstraints) throw new Error("Explicitly accepted Journey design did not become deployable.");
  const reference = client.getDesignReference(accepted);
  const robustness = await client.robustness(reference);
  const config = await client.buildConfig(reference);
  client.assertPipelineIntegrity({ design: accepted, robustness, config });

  const fingerprint = accepted.result.preferred.fingerprint;
  const elapsedMs = Math.round(performance.now() - started);
  console.log("EquiCurve Developer Preview");
  console.log("External launchpad integration");
  console.log("");
  console.log("Initial design");
  console.log("  evaluated: " + initialDesign.evaluated);
  console.log("  feasible under requested constraints: " + initialDesign.feasibleUnderRequestedConstraints);
  console.log("  deployment allowed: " + initialDesign.deploymentAllowedUnderAppliedConstraints);
  console.log("  blocker: " + (initialDesign.conflicts[0] ?? "reported by API"));
  console.log("");
  console.log("Issuer decision");
  console.log("  retail progress: 25% → 3.84% (explicit acceptance)");
  console.log("");
  console.log("Accepted design");
  console.log("  candidate: " + accepted.result.preferred.profile);
  console.log("  fingerprint: " + fingerprint);
  console.log("");
  console.log("Robustness");
  console.log("  " + robustness.robustness.shockInsideCount + " / " + robustness.robustness.shockCount + " synthetic shocks inside accepted budget");
  console.log("  fingerprint: same");
  console.log("");
  console.log("Canonical configuration");
  console.log("  quote: " + acceptedRequest.quote);
  console.log("  migration threshold: " + String(config.config.migrationQuoteThreshold));
  console.log("  integrity verified: yes");
  console.log("");
  console.log("Transaction submitted");
  console.log("  no");
  console.log("Next boundary");
  console.log("  token/profile + wallet authorization handled by integrating launchpad");
  console.log("End-to-end time: " + elapsedMs + " ms");
  return { initial, accepted, robustness, config, elapsedMs } satisfies {
    initial: DesignResponse;
    accepted: DesignResponse;
    robustness: RobustnessResponse;
    config: ConfigResponse;
    elapsedMs: number;
  };
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedScript) {
  runIntegration().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Launchpad integration failed.");
    process.exitCode = 1;
  });
}
