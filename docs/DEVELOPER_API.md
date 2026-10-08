# EquiCurve Developer API

This document describes the experimental API included in the EquiCurve v0.3.0 Developer Preview. The contracts may evolve before stable v1.

## 1. Scope and architecture

The Developer Preview exposes analysis and canonical configuration around the existing Market Studio engine. The route layer validates requests, rebuilds the selected design on the server, and serializes the result. It does not introduce a second pricing or simulation engine.

```text
client
  |
  | POST /api/v1/design
  v
selected design reference: request + candidateId + fingerprint + version metadata
  |                         \
  | POST /api/v1/robustness   \ POST /api/v1/config
  v                            v
same server-computed candidate  same canonical launch recipe
  |                            |
synthetic robustness evidence   downstream launch integration configuration
```

The shared engine boundary is `designPolicy()` in `src/lib/market/policy.ts`. It uses the existing `LaunchBrief`, constraints, simulation, Pareto ordering, negotiation, policy identity, recipe materialization, and configuration fingerprint functions. `assessRobustness()` is the production robustness path, and `materializeRecipe()` is the production config path used by Create.

The model is stateless. A follow-up request carries the original public request plus the selected candidate identity and fingerprint. The server recomputes the policy and refuses a missing candidate, stale fingerprint, or non-deployable selection. No server-side registry or mutable session is required.

## 2. Endpoint contracts

`POST /api/v1/design` accepts `schemaVersion: "1"`, a supported `quote` (`SOL` or `USDC`), decimal-string amounts, a public market brief, requested constraints, and an optional explicit `acceptedConstraints` budget. It returns candidate summaries, negotiation state, requested and accepted constraints, policy identity, config identity, exact atom strings, and the selected candidate fingerprint.

Example request shape:

```json
{
  "schemaVersion": "1",
  "quote": "SOL",
  "raiseTarget": "100",
  "typicalTrade": "0.2",
  "participants": 20,
  "objective": "controlled-discovery",
  "market": { "asset": "private-company", "stressPaths": 8, "seed": 60428 },
  "constraints": {
    "maxThresholdGap": 0.2,
    "maxReferenceImpactBps": 1200,
    "maxWhaleImpactBps": 1800,
    "maxConcentration": 0.55,
    "minRetailProgress": 0.25
  }
}
```

`0 feasible candidates` is a valid HTTP 200 analysis result. It preserves the conflict and reports `feasibleUnderRequestedConstraints: 0` and `deploymentAllowedUnderAppliedConstraints: false`. With an explicitly accepted budget, requested feasibility can remain zero while deployment is allowed under the applied constraints. Constraint relaxation is never inferred.

`POST /api/v1/robustness` accepts the selected design reference returned by the design step. It calls `assessRobustness({ chosen, brief, budget })` for that exact server-recomputed candidate and returns the robustness model version, ten shock outcomes, shock definitions, inside counts, sensitivity summary, and the same design fingerprint. It also returns `provenance: "synthetic_assumption_shocks"`.

`POST /api/v1/config` accepts the same selected design reference. It requires the selected candidate to be deployable under the applied constraints, calls `materializeRecipe(candidate.recipe)`, and returns the canonical configuration, canonical serialized config, migration attestation, and an integrity object containing matching design and config fingerprints. It returns configuration for downstream launch integration; token/profile inputs and wallet authorization remain with the integrator. It does not deploy, sign, send, or register anything.

## 3. Identity, integrity, and serialization

The selected reference is:

```json
{
  "schemaVersion": "1",
  "engineVersion": "0.2.0",
  "fingerprintVersion": "config-v1",
  "designRequest": { "...": "the original design request" },
  "selection": {
    "candidateId": "profile-id",
    "fingerprint": "32 lowercase hexadecimal characters"
  }
}
```

The server recomputes the policy from `designRequest`, finds `candidateId`, and compares the candidate's current `configFingerprint` with the supplied fingerprint before running robustness or building config. The same fingerprint is expected in the design response, robustness response, and config integrity object.

Exact atom quantities remain decimal strings, including thresholds, curve values, quote totals, and migration thresholds. Config also identifies quote label, decimals, and mint when known, and exposes units for quote atoms, raw SDK integers, basis points, percentages, decimal counts, public keys/base58 values, and dimensionless curve values. Bounded impacts, ratios, scores, counts, and percentages remain numbers. The public config serializer converts bigint-like values explicitly and `canonicalConfig` is a string, so `JSON.stringify()` never encounters a bigint.

Shared constants live in `src/lib/market/apiVersion.ts`:

```text
schemaVersion       1
engineVersion       0.2.0
fingerprintVersion  config-v1
```

The application release is v0.3.0. `engineVersion: 0.2.0` identifies the unchanged algorithm baseline; `schemaVersion: "1"` identifies the API wire schema; `fingerprintVersion: "config-v1"` identifies canonical config hashing; and `robustnessModelVersion: "0.3.0"` identifies the synthetic market model. Any engine change that can alter candidate selection, robustness values, or canonical config must update the release note and rerun the deterministic cross-endpoint tests.

## 4. Errors, limits, and evidence boundaries

All route failures use `{ ok: false, error: { code, message, issues? } }`. Stable codes include `INVALID_REQUEST`, `UNSUPPORTED_QUOTE`, `RATE_LIMITED`, `CANDIDATE_NOT_FOUND`, `FINGERPRINT_MISMATCH`, `DESIGN_MISMATCH`, `ROBUSTNESS_FAILED`, and `CONFIG_BUILD_FAILED`. Design, robustness, and config each use a separate `api:v1:*` rate-limit namespace at 30 requests per minute.

The outputs are evidence from deterministic finite simulations under explicit assumptions. Synthetic robustness is not a probability, confidence interval, backtest, or market prediction. Finite candidate search is not a global optimum proof. A robustness pass does not verify deployment readiness beyond the reported policy checks, and the config endpoint does not perform wallet or chain actions. Deployment verification, signing, transaction submission, registration, and metadata writes remain outside this local phase.

## 5. Reuse boundary

The existing Market Studio calls `designPolicy()` and `toDesignedMarket()`. The experimental routes only adapt public input and output around that engine. They do not import React state, duplicate simulation formulas, maintain a candidate registry, or create a second configuration builder.

## External integration proof

`examples/launchpad-integration/` is a black-box launchpad client. Its executable TypeScript imports only `EquiCurveClient` and its public DTOs plus Node's built-in APIs; it does not import from `src/`, `@/lib/`, `@/app/`, or the test suite. It sends the fixture request to `/api/v1/design`, observes the valid zero-feasible Journey conflict, explicitly adds the accepted `3.84%` retail-progress budget in its own code, then sends the resulting selected reference to `/api/v1/robustness` and `/api/v1/config`.

The client checks `schemaVersion`, keeps `engineVersion` stable within the run, keeps `fingerprintVersion` stable across endpoints, validates the fingerprint format, and fails closed on any error or mismatch. It verifies the full chain `design.result.preferred.fingerprint === robustness.robustness.fingerprint === config.integrity.configFingerprint === config.integrity.designFingerprint` and requires `integrity.matches === true`.

Run it against an EquiCurve server with:

```text
npm run dev
npx tsx examples/launchpad-integration/run.ts
```

The integration proof ends at canonical configuration. It does not instantiate a wallet, load a private key, sign, submit, create a pool, register a launch, or write metadata. The client prints `Canonical configuration integrity verified: yes` and `Transaction submitted: no`, then points the integrator to token/profile inputs and wallet authorization.

The verified production-style HTTP run returned `evaluated: 20`, `feasibleUnderRequestedConstraints: 0` for the original request, then accepted the explicit `25% -> 3.84%` decision, selected `Exponential · 3×`, returned `8 / 10` robustness shocks inside budget, and confirmed fingerprint `d44dbb02bb2d68ef00e9e714da519e58` through config. No transaction was signed or sent and no chain, registry, or metadata write occurred.

## TypeScript client proof

The source-included experimental client adds a thin developer-facing layer:

```text
external app
    ↓
EquiCurveClient
    ↓
HTTP
    ↓
API
    ↓
existing engine
```

`packages/equicurve-client/` knows only the three public endpoint paths, request and response DTOs, version fields, and error envelopes. It contains no market math and does not import `src/`, application code, engine code, or Meteora SDK internals. `getDesignReference()` reconstructs only the stateless public reference required by the API; it never copies a candidate report or calculates a fingerprint. The client checks schema and version consistency and fails closed when design, robustness, and config fingerprints diverge.

The launchpad example uses `EquiCurveClient` while retaining the same external HTTP behavior and no-transaction boundary. The client is experimental, included as source in this repository, and not yet published to npm. The routes support server-to-server and same-origin use; arbitrary browser cross-origin use is unsupported because CORS is not part of this preview.

Rate limiting trusts the first forwarded IP when a proxy supplies one, otherwise the request's local fallback key. Shared NATs can share a bucket, and the in-memory fallback is per process. This is preview abuse protection, not production tenant isolation or authentication. The DTOs are intentionally independent in this experiment; before a stable v1, consider a shared schema or OpenAPI contract to reduce drift.
