# EquiCurve roadmap

Directional roadmap, updated 2026-10-08.
Dates express product intent, not a promise of delivery.
Protocol changes, security findings, partner feedback, and evidence quality
can change sequencing.

**Current baseline: v0.2.0 Market Studio.** Everything described as a future milestone below is planned, not shipped. This document publishes direction; it does not introduce APIs, SDKs, streams, webhooks, indexers, or agent tools. See the [changelog](./CHANGELOG.md) for shipped capabilities.

## North star

EquiCurve is evolving from an issuer-facing Market Studio into market-design infrastructure for programmable token launches.

It should help launchpads, terminals, bots, and issuer platforms answer:

1. What market behavior does the issuer want?
2. Which launch configurations were evaluated?
3. Which constraints pass or conflict?
4. What compromise was explicitly accepted?
5. What exact DBC configuration was selected?
6. Is the signed configuration the one analyzed?
7. Does on-chain state match the recorded design?
8. What happens through the DBC → DAMM v2 lifecycle?

The EquiCurve web app remains the reference client for the same engine third-party builders can consume as the planned developer surfaces become available. There should be one implementation of market math, with multiple clients.

## Why this direction

Meteora already provides protocol SDKs and generic launch infrastructure, including Meteora Invent and a launchpad scaffold. EquiCurve should build on that foundation rather than become a second generic Meteora SDK. Its differentiation is constrained market design, deterministic scenario analysis, explicit conflict negotiation, selected-design robustness, fingerprints, deployment-readback verification, and provenance/intelligence that third-party applications can consume.

Upstream capabilities create future integration opportunities: pre-pool DBC quote simulation, lifecycle/event support, Token-2022 transfer hooks, `tokenBadge`, fee scheduler and rate limiter modes, arbitrary quote-token decimals, multiple curve-construction helpers, and DAMM v2 graduation. Each adapter needs verification against the supported protocol and SDK versions. This list is not a claim that every mode is already exposed by EquiCurve; current SOL/USDC and DBC/DAMM support is documented in the changelog.

Official references:

- [Meteora DBC developer guide](https://docs.meteora.ag/developer-guides/dbc)
- [Dynamic Bonding Curve TypeScript SDK](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk)
- [Dynamic Bonding Curve program](https://github.com/MeteoraAg/dynamic-bonding-curve)
- [Meteora Invent](https://github.com/MeteoraAg/meteora-invent)

## Strategic pillars

| Pillar | Purpose |
| --- | --- |
| Market Design Engine | Explain evaluated configurations, constraints, tradeoffs, and reproducible outcomes. |
| Developer Platform | Expose the same engine through stable contracts and thin clients. |
| Market Intelligence & Data Plane | Deliver lifecycle facts with field-level provenance and recovery semantics. |
| Execution & Lifecycle | Preserve exact configuration binding through DBC launch and DAMM v2 handoff. |
| Trust / Provenance / Safety | Keep claims, observations, unknowns, and authorization boundaries explicit. |
| Integrations & Distribution | Validate useful launchpad, terminal, and issuer-platform integrations. |

## Q4 2026 — Headless developer preview

**Target: v0.3.x. Theme: expose the engine without rewriting it.**

### Developer API v1

Proposed routes, not currently published contracts:

| Route | Intended responsibility |
| --- | --- |
| `POST /api/v1/design` | Return evaluated count, candidates, feasible set, constraint conflicts, Pareto frontier, preferred candidate, policy ID, config fingerprint, and `deploymentAllowed`. |
| `POST /api/v1/robustness` | Evaluate the SAME exact selected design under the documented shocks; do not substitute a new configuration. |
| `POST /api/v1/config` | Emit canonical serializable configuration for client-side transaction construction; the server holds no wallet keys. |
| `GET /api/v1/deployments/:pool/verify` | Compare recorded design/configuration with chain readback and report unavailable evidence explicitly. |
| `GET /api/v1/markets/:pool` | Return normalized lifecycle state with observation context. |

Contract discipline includes Zod / JSON Schema, OpenAPI, machine-readable error codes, request IDs, `schemaVersion`, `engineVersion`, and `fingerprintVersion`. Deterministic fixtures, a Journey golden response, and compatibility tests must distinguish historical evidence from newly generated designs.

### TypeScript SDK and examples

A proposed `EquiCurveClient` exposes `design()`, `robustness()`, `buildConfig()`, `verifyDeployment()`, and `getMarket()`. It remains a thin client: no duplicated market math or independent candidate-ranking implementation.

Two reference integrations establish the contract:

1. **Launchpad adapter:** brief → design → explicit negotiation → config → client-side wallet signing.
2. **Terminal panel:** pool → provenance → lifecycle → deployment verification.

### Security and exit criteria

Use separate API rate limits, payload limits, bounded execution timeouts, reproducible inputs/results, and fuzz/property tests where they expose useful correctness risks. Reject private-key input; provide no server-side signing or custody.

The milestone is complete only when another app can integrate without importing UI internals, the API and reference UI produce the same fingerprint for the same accepted design, clean-checkout documentation works, existing evidence stays valid, and only one market engine exists.

## Q1 2027 — Integration kit + verified data plane

**Target: v0.4.x.** Build interpretable market intelligence before promising real-time transport.

### Market Intelligence API

Expose fingerprint/version, curve/profile, requested constraints, accepted constraint changes, DBC phase, progress, migration threshold, remaining amount, quote identity, fee configuration, LP lock, migration state, expected versus verified DAMM pool, last successful chain read, and deployment/readback verdict.

Every field gets provenance: `simulation`, `issuer_attestation`, `registry`, `chain`, `derived`, or `unknown`. Derived values should identify their inputs. Missing or stale evidence must remain distinguishable from a successful zero-valued observation.

### Events and durable webhooks

Proposed event vocabulary:

```text
DESIGN_CREATED
CONSTRAINT_CONFLICT_FOUND
CONSTRAINT_POLICY_ACCEPTED
CONFIG_FINGERPRINTED
POOL_CREATED
DEPLOYMENT_VERIFIED
CURVE_PROGRESS_UPDATED
CURVE_COMPLETED
MIGRATION_SUBMITTED
DAMM_V2_VERIFIED
VERIFICATION_DEGRADED
```

**Build durable webhooks before WebSockets.** Require signatures, idempotency, retries, a delivery log, replay, disabled/dead-letter state, and a testing endpoint/CLI. Document whether an event represents an issuer action, an observation, or a verified chain transition; do not present a submitted migration as completed.

### Integration kit and adapters

Provide embeddable verification badges, constraint summaries, progress displays, and launch-review/fingerprint components. Investigate verified adapters for official pre-pool quote simulation, Token-2022 metadata, `tokenBadge`, broader quote assets, and arbitrary quote decimals.

Keep WSOL/known USDC as the default until broader asset verification is equivalent. Exit requires an integration to reconstruct provenance and recover missed webhook deliveries without interpreting unknown data as verified facts.

## Q2 2027 — Partner platform + historical replay

**Target: v0.5.x–v0.6.x.** Progress depends on useful preview integrations and reliable data contracts.

### Partner tenancy

Introduce projects/API keys, scoped permissions, separate environments, key rotation, quotas, audit trails, and project webhooks. API credentials authorize platform access; they do not grant wallet custody or authority to move funds.

### Durable indexer

Index EquiCurve-relevant DBC pool/config events, swaps, progress snapshots, migrations, DAMM handoff, and verification history. Define a finality policy and support backfill/replay with slot/signature provenance. This is a focused lifecycle indexer, not a generic Solana indexer.

### Historical replay

Answer: “How would this exact configuration have behaved under this recorded order sequence?”

Replay recorded order paths and compare the same order path against multiple configurations for impact, slippage, and concentration. Deliver a reproducibility bundle identifying configuration, sequence, model versions, and assumptions. Keep recorded replay distinct from synthetic simulation; neither is prediction, and replay does not establish how traders would have reacted to a different market.

### Partner configuration registry and reliability

Support versioned launch policies, signed manifests, deprecation, organization defaults, approved quote assets, approved hook programs, policy IDs, and configuration diffs. Approval expresses a partner policy, not a compliance certification.

Operational work includes idempotency, tracing, service-level objectives (SLOs), queues/backpressure, RPC failover, and health/status reporting. Exit requires recoverable indexing and delivery, reproducible replay, and tenant isolation demonstrated under failure scenarios.

## Q3 2027 — Advanced market design

**Target: v0.7.x–v0.9.x.** Expand the evaluated domain carefully and expose its limits.

### Search and fee design

Investigate custom multi-segment curves, liquidity-weight search, start/mid/graduation parameters, market-cap construction, bounded fee-configuration search, and bounded LP-policy search. State the evaluated domain and budget; never claim global optimization.

Fee-design work may cover fixed fees, linear and exponential schedulers, dynamic fees, rate limiters where supported, and DAMM v2 fee configuration / market-cap scheduling. Protocol support and exact transaction/readback equivalence gate each addition.

### Optional protocol modules

Research Presale Vault, Alpha Vault, DAMM v2 liquidity operations, Zap UX, and Dynamic Fee Sharing. Integrate only when they improve the market-design product and can preserve its evidence model. EquiCurve should not become a collection of unrelated Meteora buttons.

### Scenario models and comparative reports

Allow explicit trade-size distributions, buy/sell mix, timing, whales, and late capital. Version and fingerprint custom model inputs so a report can be reproduced without confusing a scenario fingerprint with the deployed configuration fingerprint.

Comparative reports should include requested policy, evaluated domain, Pareto set, accepted exceptions, robustness, historical replay when supplied, exact configuration, and fingerprints. Exit requires bounded, reproducible comparisons and regression coverage for each newly supported construction mode.

## Q4 2027 — EquiCurve v1.0

**Target: v1.0.0, gated by evidence rather than the calendar.**

### Stable public infrastructure

Stabilize the v1 API, TypeScript SDK, OpenAPI guarantees, deprecation policy, migration guides, semantic versioning, and fingerprint-version policy. Potential packages are `@equicurve/client`, `@equicurve/types`, `@equicurve/widgets`, and `@equicurve/verify`; these names describe packaging intent, not published packages. Consider an optional Go client only after API contracts stabilize.

Mainnet operation requires a partner pilot, reliable RPC/indexer infrastructure, security hardening, a transaction/readback regression suite, an incident/rollback plan, and a supported-asset policy. A target date is not authorization to relax these gates.

### Real-time and agent interfaces

Add WebSocket or SSE only if actual partner demand justifies it. Require sequence numbers, a resume cursor, heartbeat, and defined reconnect/replay semantics. Keep webhooks as the durable notification primitive.

An agent interface may expose MCP/tools for design, verification, intelligence, quotes, and read operations. Preserve an explicit human/wallet authorization boundary for value-moving transactions; tool access must not imply permission to sign or spend.

### Trust and v1 exit criteria

Publish a threat model, provenance specification, privacy/retention documentation, reproducible and signed releases, and incident/status history. Seek external review when the scope and risk warrant it.

v1 requires at least two independent integration patterns, mainnet operational evidence, a stable compatibility policy, replay/recovery semantics, and external consumers that need no UI internals. The original design → fingerprint → deploy → verify invariant must still hold.

## Beyond v1 — Research only

Explore other protocol adapters where the constrained-design abstraction fits, cross-protocol launch comparisons, a signed design-policy marketplace, scenario libraries, team/multisig approval flows, private simulations with public fingerprints, institutional/RWA templates supplied by qualified partners, non-custodial strategy agents, and trading-terminal/explorer/portfolio integrations. These are research directions without delivery commitments.

### Explicit non-goals

- Custodial wallet.
- Fair-value/NAV oracle.
- Securities compliance engine.
- Black-box AI “best curve.”
- Generic Solana indexer.
- Duplicate Meteora SDK.
- Prediction disguised as simulation.
- Silently changing constraints.

## Version path

| Version | Scope | Status |
| --- | --- | --- |
| v0.1.0 | Initial lifecycle MVP/evidence | Historical baseline |
| v0.2.0 | Current Market Studio + constrained engine + verification | Current release |
| v0.3.x | Developer API + TypeScript SDK | Planned |
| v0.4.x | Intelligence API + webhooks + integration kit | Planned |
| v0.5–0.6 | Partner platform + indexer + replay | Planned |
| v0.7–0.9 | Advanced market design | Planned |
| v1.0.0 | Stable public infrastructure | Gated target |

Every new surface must preserve EquiCurve's central invariant:
A design is useful only if we can explain what was asked, what was evaluated,
what changed, what exact configuration was selected, and whether the deployed
market still matches it.
