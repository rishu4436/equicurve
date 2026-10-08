# EquiCurve launchpad integration example

## What this proves

This example behaves like a third-party launchpad. It imports only `EquiCurveClient` from the source-included experimental package and treats EquiCurve as an HTTP service with published Developer Preview JSON contracts. The client is a thin wrapper; it contains no market math.

## Requirements

- Node.js 20 or newer
- The EquiCurve development server running locally

## Run

Start EquiCurve in one terminal:

```bash
npm run dev
```

Then run the external client in another:

```bash
npx tsx examples/launchpad-integration/run.ts
```

Use `EQUICURVE_API_URL` to point at another local HTTP origin:

```bash
EQUICURVE_API_URL=http://localhost:3000 npx tsx examples/launchpad-integration/run.ts
```

## Flow

The external app calls `EquiCurveClient.design()` for the original Journey request, observes the valid zero-feasible conflict, constructs a second request with an explicit `3.84%` retail-progress acceptance, and calls `design()` again. It then sends the same server-issued reference through `robustness()` and `buildConfig()`.

## Trust model

The server recomputes candidate selection from the canonical request. The client cannot inject an arbitrary candidate object. Candidate identity and the 32-character fingerprint are checked through the pipeline, and `/config` returns configuration data without signing or deploying.

## Important semantics

- `0 feasible` is a valid design result.
- The accepted constraint is explicit in the client code.
- Synthetic scenarios are not predictions.
- Robustness is not probability.
- Finite search is not global optimization.
- Config output is not a chain deployment.
- User and wallet authorization remain outside this example.

The example ends at canonical configuration with `Canonical configuration integrity verified: yes` and `Transaction submitted: no`. The next step is for the integrating application to add token/profile inputs and client-side wallet authorization. This example does not load wallets, private keys, sign, submit, create pools, register launches, or write metadata.

The preview routes support server-to-server and same-origin calls. Arbitrary third-party browser cross-origin calls are unsupported because the routes do not promise CORS headers; use a backend or same-origin proxy.
