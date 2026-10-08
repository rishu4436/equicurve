import { EquiCurveApiError, EquiCurveProtocolError, EquiCurveTransportError } from "./errors";
import type { ApiErrorEnvelope, ConfigResponse, DesignReference, DesignRequest, DesignResponse, FetchLike, RobustnessResponse } from "./contracts";

const FINGERPRINT = /^[0-9a-f]{32}$/;
type VersionContract = { engineVersion: string; fingerprintVersion: string };
type Pipeline = { design: DesignResponse; robustness: RobustnessResponse; config: ConfigResponse };
export type EquiCurveClientOptions = { baseUrl: string; fetch?: FetchLike };

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EquiCurveProtocolError(label + " is malformed.");
  return value as Record<string, unknown>;
}
function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new EquiCurveProtocolError(label + " is missing.");
  return value;
}
function numberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new EquiCurveProtocolError(label + " is malformed.");
  return value;
}
function assertResponseVersion(response: unknown, expected?: VersionContract): VersionContract {
  const value = record(response, "API success response");
  if (value.ok !== true) throw new EquiCurveProtocolError("API success response is missing ok=true.");
  if (value.schemaVersion !== "1") throw new EquiCurveProtocolError("Unsupported schemaVersion: " + String(value.schemaVersion));
  const engineVersion = stringField(value.engineVersion, "engineVersion");
  const fingerprintVersion = stringField(value.fingerprintVersion, "fingerprintVersion");
  if (expected?.engineVersion && engineVersion !== expected.engineVersion) throw new EquiCurveProtocolError("engineVersion changed within the pipeline.");
  if (expected?.fingerprintVersion && fingerprintVersion !== expected.fingerprintVersion) throw new EquiCurveProtocolError("fingerprintVersion changed within the pipeline.");
  return { engineVersion, fingerprintVersion };
}
function assertFingerprint(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !FINGERPRINT.test(value)) throw new EquiCurveProtocolError(label + " is not a valid 32-character lowercase fingerprint.");
}
function validateDesign(response: unknown): DesignResponse {
  assertResponseVersion(response);
  const value = record(response, "Design response");
  const result = record(value.result, "Design result");
  numberField(result.evaluated, "Design evaluated count");
  numberField(result.feasibleUnderRequestedConstraints, "Design requested feasibility");
  if (typeof result.deploymentAllowedUnderAppliedConstraints !== "boolean") throw new EquiCurveProtocolError("Design applied deployment decision is malformed.");
  record(result.requestedConstraints, "Design requested constraints");
  record(result.acceptedConstraints, "Design accepted constraints");
  const preferred = record(result.preferred, "Design preferred candidate");
  stringField(preferred.id, "Design candidate id");
  assertFingerprint(preferred.fingerprint, "Design fingerprint");
  record(result.brief, "Design brief");
  return response as DesignResponse;
}
function validateRobustness(response: unknown): RobustnessResponse {
  assertResponseVersion(response);
  const value = record(response, "Robustness response");
  const design = record(value.design, "Robustness design");
  assertFingerprint(design.fingerprint, "Robustness design fingerprint");
  const report = record(value.robustness, "Robustness report");
  assertFingerprint(report.fingerprint, "Robustness fingerprint");
  numberField(report.shockCount, "Robustness shock count");
  numberField(report.shockInsideCount, "Robustness inside count");
  return response as RobustnessResponse;
}
function validateConfig(response: unknown): ConfigResponse {
  assertResponseVersion(response);
  const value = record(response, "Config response");
  const design = record(value.design, "Config design");
  assertFingerprint(design.fingerprint, "Config design fingerprint");
  record(value.config, "Config payload");
  stringField(value.canonicalConfig, "Canonical config");
  const integrity = record(value.integrity, "Config integrity");
  assertFingerprint(integrity.designFingerprint, "Config design integrity fingerprint");
  assertFingerprint(integrity.configFingerprint, "Config integrity fingerprint");
  if (integrity.matches !== true) throw new EquiCurveProtocolError("Config integrity does not report matches=true.");
  return response as ConfigResponse;
}
function assertReference(reference: DesignReference): void {
  const value = record(reference, "Design reference");
  if (value.schemaVersion !== "1") throw new EquiCurveProtocolError("Unsupported reference schemaVersion: " + String(value.schemaVersion));
  stringField(value.engineVersion, "Design reference engineVersion");
  stringField(value.fingerprintVersion, "Design reference fingerprintVersion");
  const request = record(value.designRequest, "Design reference request");
  if (request.schemaVersion !== "1") throw new EquiCurveProtocolError("Design reference request schemaVersion is unsupported.");
  const selection = record(value.selection, "Design reference selection");
  stringField(selection.candidateId, "Design reference candidateId");
  assertFingerprint(selection.fingerprint, "Design reference fingerprint");
}

export class EquiCurveClient {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  constructor(options: EquiCurveClientOptions) {
    if (!options.baseUrl?.trim()) throw new Error("EquiCurveClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }
  async design(request: DesignRequest): Promise<DesignResponse> { return validateDesign(await this.post<DesignResponse>("/api/v1/design", request)); }
  getDesignReference(response: DesignResponse): DesignReference {
    const versions = assertResponseVersion(validateDesign(response));
    const result = record(response.result, "Design result");
    const preferred = record(result.preferred, "Design preferred candidate");
    const brief = record(result.brief, "Design brief") as { asset: string; quote: "SOL" | "USDC"; targetRaise: string; typicalTrade: string; participants: number; objective: string; totalSupply?: number; creatorPct?: number; lpLockPct?: number; antiSniper?: boolean; stressPaths?: number; seed?: number };
    assertFingerprint(preferred.fingerprint, "Design fingerprint");
    const designRequest: DesignRequest = {
      schemaVersion: "1", quote: brief.quote, raiseTarget: brief.targetRaise, typicalTrade: brief.typicalTrade, participants: brief.participants, objective: brief.objective,
      market: { asset: brief.asset, totalSupply: brief.totalSupply, creatorPct: brief.creatorPct, lpLockPct: brief.lpLockPct, antiSniper: brief.antiSniper, stressPaths: brief.stressPaths, seed: brief.seed },
      constraints: result.requestedConstraints as DesignRequest["constraints"], acceptedConstraints: result.acceptedConstraints as DesignRequest["constraints"],
    };
    return { schemaVersion: "1", engineVersion: versions.engineVersion, fingerprintVersion: versions.fingerprintVersion, designRequest, selection: { candidateId: stringField(preferred.id, "Design candidate id"), fingerprint: preferred.fingerprint } };
  }
  async robustness(reference: DesignReference): Promise<RobustnessResponse> {
    assertReference(reference);
    const response = validateRobustness(await this.post<RobustnessResponse>("/api/v1/robustness", reference));
    assertResponseVersion(response, { engineVersion: reference.engineVersion, fingerprintVersion: reference.fingerprintVersion });
    if (response.design.fingerprint !== reference.selection.fingerprint || response.robustness.fingerprint !== reference.selection.fingerprint) throw new EquiCurveProtocolError("Robustness fingerprint does not match the design reference.");
    return response;
  }
  async buildConfig(reference: DesignReference): Promise<ConfigResponse> {
    assertReference(reference);
    const response = validateConfig(await this.post<ConfigResponse>("/api/v1/config", reference));
    assertResponseVersion(response, { engineVersion: reference.engineVersion, fingerprintVersion: reference.fingerprintVersion });
    if (response.design.fingerprint !== reference.selection.fingerprint || response.integrity.designFingerprint !== reference.selection.fingerprint || response.integrity.configFingerprint !== reference.selection.fingerprint) throw new EquiCurveProtocolError("Config integrity does not match the design reference.");
    return response;
  }
  assertPipelineIntegrity(pipeline: Pipeline): void {
    const versions = assertResponseVersion(validateDesign(pipeline.design));
    assertResponseVersion(validateRobustness(pipeline.robustness), versions);
    assertResponseVersion(validateConfig(pipeline.config), versions);
    const fingerprint = pipeline.design.result.preferred.fingerprint;
    assertFingerprint(fingerprint, "Design fingerprint");
    if (pipeline.robustness.robustness.fingerprint !== fingerprint || pipeline.config.integrity.designFingerprint !== fingerprint || pipeline.config.integrity.configFingerprint !== fingerprint) throw new EquiCurveProtocolError("Pipeline fingerprints do not match.");
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try { response = await this.fetcher(this.baseUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw new EquiCurveTransportError("Could not reach EquiCurve at " + this.baseUrl + "."); }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new EquiCurveTransportError("EquiCurve returned non-JSON data for " + path + ".", response.status); }
    if (!response.ok || !payload || typeof payload !== "object" || (payload as ApiErrorEnvelope).ok === false) {
      const error = payload && typeof payload === "object" ? (payload as ApiErrorEnvelope).error : undefined;
      if (error?.code) throw new EquiCurveApiError(response.status, error.code, error.message ?? "EquiCurve API request failed.", error.issues);
      throw new EquiCurveTransportError("EquiCurve returned HTTP " + response.status + " for " + path + ".", response.status);
    }
    if ((payload as { ok?: unknown }).ok !== true) throw new EquiCurveProtocolError("EquiCurve returned a malformed success response for " + path + ".");
    return payload as T;
  }
}
