# EquiCurve TypeScript Client

**EXPERIMENTAL — v0.3 Developer Preview**
**NOT PUBLISHED TO NPM**

This package is a thin HTTP client for the local EquiCurve developer preview. It calls exactly three endpoints: `POST /api/v1/design`, `POST /api/v1/robustness`, and `POST /api/v1/config`. It contains no market algorithms, does not calculate fingerprints, and does not replace the EquiCurve server as the authority.

## Setup

Use the source package directly from this repository:

```ts
import { EquiCurveClient } from "./packages/equicurve-client/src";

const client = new EquiCurveClient({ baseUrl: "http://localhost:3000" });
```

The client is intended for server-to-server or same-origin integration. Arbitrary browser cross-origin use is unsupported because the preview routes do not promise CORS headers; use an application backend or same-origin proxy.

## Design

`client.design(request)` returns a deterministic finite search result. A valid result can contain **0 feasible valid candidates**. The client never relaxes constraints automatically. A caller may send `acceptedConstraints` only when an issuer or operator has explicitly accepted those applied constraints.

The public fields are explicit: `feasibleUnderRequestedConstraints` counts candidates satisfying the original request, while `deploymentAllowedUnderAppliedConstraints` reports whether the selected candidate satisfies the applied budget. Therefore a request can have `0` requested-feasible candidates while an explicitly accepted budget allows downstream configuration.

## Reference, robustness, and config

`getDesignReference()` creates a serializable reference containing the canonical design request, candidate ID, fingerprint, `schemaVersion`, `engineVersion`, and `fingerprintVersion`. Send that same reference to `client.robustness(reference)` and `client.buildConfig(reference)`.

Robustness is deterministic synthetic assumption-shock evidence, not a probability, confidence, forecast, or success guarantee. Finite candidate search is not global optimization.

Candidate summaries call the cohort metric `syntheticCohortGraduationFraction`: it is the observed fraction of deterministic synthetic paths that reached the modeled threshold under the supplied seed and assumptions.

`buildConfig()` returns the canonical market configuration and verifies that its fingerprint matches the selected design. It does not construct, sign, or send a launch transaction. Wallet authorization, token/profile inputs, transaction construction, submission, and launch registration remain with the integrating application.

The config response includes quote identity (`SOL` or `USDC`, decimals, and a mint when known) plus units for exact numeric strings: quote atoms, raw SDK integers, basis points, percentages, decimal counts, public keys/base58 values, and dimensionless curve values. Exact quantities remain strings so precision is preserved.

## Errors and versioning

Transport failures throw `EquiCurveTransportError`, API envelopes throw `EquiCurveApiError`, and malformed success payloads or version/fingerprint mismatches throw `EquiCurveProtocolError`.

The preview uses application version **v0.3.0**, API `schemaVersion: "1"`, engine version `0.2.0` (the unchanged algorithm baseline), and fingerprint version `config-v1`. The robustness model reports its own `robustnessModelVersion: "0.3.0"`; that identifies the market model used for synthetic evidence and is not the package release version.

## Trust and limitations

The server recomputes the selected candidate from the reference request and rejects stale, fabricated, or cross-request fingerprints. The client compares returned versions and fingerprints but does not trust client-supplied candidate details. Rate limits are preview abuse protection, not production tenant isolation. Independent DTOs are deliberate for this experiment; before a stable v1, consider a shared schema or OpenAPI contract to reduce drift.
