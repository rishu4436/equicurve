# Changelog

All notable EquiCurve changes are documented here.

The project follows Semantic Versioning while pre-1.0. During the 0.x series,
minor releases may introduce new public developer surfaces; breaking API
changes must be documented explicitly.

## [Unreleased]

Planned work belongs in [ROADMAP.md](./ROADMAP.md) and is not considered shipped.

## [0.3.5] - 2026-10-10

Market Operating & Verification Layer.

### Creator identity

- Added Website and X profile support with canonical creator-signed identity continuity.
- Added direct validated project-image upload with Vercel Blob production persistence.

### Scheduled launches

- Added persisted launch intents, Upcoming discovery, reschedule/cancel, server-time readiness, and fingerprint-bound launch revalidation.
- Scheduled launches remain intents: they do not contain pre-signed transactions or execute automatically.

### Issuer updates and comments

- Added canonical creator-only issuer posts with edit, delete, and pin actions.
- Added wallet-authenticated comments with author-only mutation and short-lived wallet sessions.
- Added durable production persistence in Upstash.

### Global News

- Added creator-post aggregation with Newest, Popular, category filtering, search, deterministic pagination, and creator provenance.

### Market Passport

- Added original design intent, configuration fingerprints, accepted constraint changes, deterministic robustness context, deployment verification, live design monitoring, and scheduled/pre-launch Passport views.

### Production persistence

- Added Upstash persistence for schedules, posts/comments, and auth challenges/sessions.
- Added atomic nonce consumption, atomic pin behavior, and schedule CAS.
- Added Vercel Blob persistence for production images.

### Quality

- 62 test files and 526 passing tests.
- Production deployment smoke passed.
- EQFULL live Passport passed.
- Correct EQFULL holders mint endpoint passed 3/3.

### Evidence boundaries

- Synthetic scenarios are not forecasts, and robustness is not probability.
- A fingerprint identifies the canonical EquiCurve configuration; the fingerprint itself is not stored on-chain.
- Creator posts are creator-authored; EquiCurve verifies authorship where supported, not the truth of claims.
- Token accounts are not necessarily beneficial owners.
- A scheduled launch is an intent, not an automatic transaction.

### Production QA disclosure

- Wallet/auth/schedule/community behavior has focused automated coverage.
- Production storage/backends and read-only surfaces were live-verified.
- Disposable production wallet mutation flows were not exercised because no controlled signing wallet was used in that audit.

### Versioning notes

- Application release: `0.3.5`.
- API schema, market engine, fingerprint, and robustness model versions remain independent.

## [0.3.0] - 2026-10-08

Developer Preview — headless market-design API and TypeScript client.

### Developer API

- Added `POST /api/v1/design`, `POST /api/v1/robustness`, and `POST /api/v1/config` with strict request validation and stable error envelopes.
- Added stateless selected-design references with server-side recomputation and schema, engine, fingerprint-version, candidate, and configuration-fingerprint continuity checks.
- Preserved requested constraints separately from explicitly accepted constraints. A zero-feasible result is a successful design outcome and never triggers automatic relaxation.
- Added fingerprint-bound canonical market configuration output. The API does not construct, sign, or submit transactions.

### TypeScript Client

- Added the thin, source-included `EquiCurveClient` with `design()`, `getDesignReference()`, `robustness()`, `buildConfig()`, and `assertPipelineIntegrity()`.
- Added typed API, transport, and protocol errors; runtime success-response validation; and version/fingerprint continuity checks.
- Kept all market math on the server. The client does not rank candidates or calculate fingerprints and is not yet published to npm.

### External integration proof

- Added an external launchpad flow: external launchpad → `EquiCurveClient` → HTTP → EquiCurve API → existing market engine.
- Journey proof evaluated 20 candidates, found 0 feasible under requested constraints, preserved explicit retail-progress acceptance from 25% to 3.84%, and selected `Exponential · 3×` under the current engine output.
- Verified 8 / 10 synthetic robustness shocks inside the accepted budget and canonical configuration integrity with fingerprint `d44dbb02bb2d68ef00e9e714da519e58`. No transaction was submitted.

### Contract hardening

- Made malformed success payloads fail as protocol errors and preserved version metadata through copied or serialized references.
- Added fail-closed cross-request candidate/fingerprint checks, explicit quote identity and unit metadata, clarified requested-versus-applied feasibility fields, and renamed the synthetic cohort graduation field.
- Classified unsupported quotes consistently across design, robustness, and configuration routes.

### Preview limitations

- Server-to-server and same-origin integrations are supported; arbitrary cross-origin browser calls are not yet supported.
- Anonymous IP rate limiting is preview-grade rather than tenant-grade.
- Client DTOs remain independently defined and may move to a shared schema or OpenAPI contract before stable v1.
- `/config` returns canonical market configuration, not a complete transaction DTO. Token/profile inputs, wallet construction, signing, and submission remain with the integrator.

## [0.2.0] - 2026-10-08

The mature Market Studio release consolidates the constrained engine, execution, verification, and hardening capabilities below. This entry records the audited application baseline at `a2e5485a8f93aa8c2729ff398b777a711d65a95c`; assigning the version does not change application behavior.

### Market design

- Established EquiCurve as a constrained market-design engine with deterministic candidate search and synthetic scenario analysis.
- Added explicit hard constraints, Pareto-frontier analysis, and an objective-aware preferred candidate among the evaluated configurations. Finite search does not establish a global optimum.
- Made conflicts explicit and constraint-budget changes issuer-controlled; requested limits remain distinguishable from accepted exceptions.
- Added robustness analysis of the selected design without replacing its configuration.
- Adopted 32-character configuration fingerprints while keeping historical 16-character evidence readable. Journey's deployed fingerprint remains `16ac1e49b68f4a4c`.

### Execution and verification

- Bound simulation and review to transaction construction through configuration fingerprint checks.
- Supported real Meteora DBC creation with SOL/USDC quotes, optional seed buys, and transaction-size-aware splitting.
- Supported DBC quotes and swaps, partial fills at curve limits, quote freshness checks, and explicit slippage protection.
- Supported graduation and DAMM v2 migration, the DAMM trading ticket, and fee claims.
- Added full deployment readback verification against the recorded configuration. Verification proves the on-chain match, not that every requested constraint passed.
- Recorded Journey and additional public-devnet proofs. [Canonical evidence](./docs/canonical-evidence.md) identifies the historical transactions; local-validator lifecycle coverage is separate.

### Registry, metadata and trust

- Added a creator-signed registry with strict schemas, chain-derived fields, and durable compare-and-set (CAS) updates.
- Supported Upstash-hosted metadata and shared rate limits, with documented local/process fallbacks.
- Hardened remote image handling against SSRF and DNS rebinding through address validation and pinned fetches.
- Made configuration and quote verification fail closed: unreadable configuration or missing quote is verification unavailable; unsupported quote mints are rejected and never silently treated as SOL.

### Market Studio UI

- Introduced the six-step workflow: Asset → Market goals → Terms → Market design → Policy review → Deploy.
- Redesigned the homepage with an explicitly illustrative curve and a historical Journey evidence panel.
- Added mobile candidate cards, a compact accepted-budget summary, and selected-design robustness UX.
- Kept historical swap prices separate from theoretical curves and spot observations, preserving unknown-data states.
- Improved accessibility through labelled controls, keyboard-accessible chart data, navigation, and focus treatment.
- Captured current judge screens with [source and capture provenance](./docs/judge-screens/README.md); pre-redesign screenshots remain labelled historical.

### Security and dependency hygiene

- Removed the unused aggregate wallet-adapter bundle while retaining the directly used Phantom and Solflare adapters.
- Reduced runtime npm audit findings from 123 to 38 and runtime critical entries from 2 to 0 at the audited release.
- Applied compatible transitive security updates and synchronized optional lockfile entries for CI's npm installer.
- Documented residual runtime, optional/transitive, and development-tooling risks in [DEPENDENCY-AUDIT.md](./docs/DEPENDENCY-AUDIT.md). Reduced counts do not establish that all dependencies are secure.

### Quality

- Audited release: 39 test files and 281 passing tests.
- Required lint, typecheck, test, and build checks in CI; stabilized timeout testing with deterministic timers.
- Kept public-devnet transactions, local-validator evidence, synthetic simulations, and illustrative UI distinct.

## [0.1.0] - 2026-10-02

Original hackathon lifecycle MVP and evidence foundation:

- Meteora DBC creation lifecycle with curve presets, SOL/USDC quotes, fee and LP controls, and Token-2022 paths.
- On-curve swaps, graduation, DAMM v2 integration, and fee claims.
- Explore, portfolio, and token metadata workflows.
- Local-validator end-to-end lifecycle evidence and the Journey public-devnet proof, with their environments identified separately.

## Versioning Notes

- v0.1.0 names the original lifecycle MVP; v0.2.0 names the mature Market Studio and its audited evidence foundation; v0.3.0 names the Developer Preview release.
- Application release version, API `schemaVersion`, market `engineVersion`, fingerprint version, and robustness model version are independent compatibility concepts. v0.3.0 keeps the audited market engine at `0.2.0`.
- Fingerprint versioning stays separate from application versioning so historical designs remain verifiable. A new app version must not rewrite an existing deployment's fingerprint.
