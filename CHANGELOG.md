# Changelog

All notable EquiCurve changes are documented here.

The project follows Semantic Versioning while pre-1.0. During the 0.x series,
minor releases may introduce new public developer surfaces; breaking API
changes must be documented explicitly.

## [Unreleased]

Planned work belongs in [ROADMAP.md](./ROADMAP.md) and is not considered shipped. No public developer API or standalone SDK is released by this documentation update.

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

- The web app and engine version together until public API/SDK extraction. v0.1.0 names the original lifecycle MVP; v0.2.0 names the mature Market Studio and its audited evidence foundation.
- Future v0.3.x developer APIs will expose `schemaVersion` and `engineVersion`; compatibility and breaking changes will be documented explicitly.
- Fingerprint versioning stays separate from application versioning so historical designs remain verifiable. A new app version must not rewrite an existing deployment's fingerprint.
