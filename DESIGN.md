# EquiCurve design

EquiCurve is a constrained market-design engine for Meteora DBC launches. An issuer supplies a brief and explicit limits, compares a finite set of real DBC configurations, and signs the selected configuration only after review.

## Principles

- Keep issuer choices explicit and reversible before signing.
- Separate synthetic analysis, issuer claims, stored records, and current on-chain reads.
- Preserve unknown values as unknown; never turn failed reads into zero progress or successful verification.
- Show conflicts and tradeoffs rather than inventing an overall quality score.
- Keep the same candidate facts and signing conditions on phone and desktop.

## Evidence hierarchy

Illustrations explain shape; deterministic simulations describe synthetic scenarios; wallet signatures attest an issuer's profile and design; chain reads establish current pool facts. Deployment readback compares those facts against the recorded configuration. Each surface identifies its source and limits.

The [canonical Journey evidence](docs/canonical-evidence.md) is a historical public-devnet record. Local-validator lifecycle evidence is separately labelled. Neither implies mainnet usage or legal compliance.

## Market-design workflow

The six steps are **Asset → Market goals → Terms → Market design → Policy review → Deploy**. The underlying sequence is brief → explicit constraints → finite candidate search → synthetic scenarios → hard constraints → Pareto frontier → explicit conflict → issuer-controlled negotiation → selected-design robustness → exact Meteora config → fingerprint → wallet signing → deployment → on-chain readback → registry / Explore.

When no candidate passes, the interface keeps the conflict visible and deployment blocked. A suggested constraint value changes only the selected limit after an explicit issuer action and recalculates the search. Collapsing an accepted budget changes presentation only; it does not relax any other limit.

## Simulation and selection

Simulation is deterministic synthetic stress analysis, not prediction. Cohort paths, shocks, and graduation fractions describe the supplied model assumptions. Search evaluates a finite candidate set, not a global optimum. Pareto membership and objective ranking apply only to evaluated candidates.

Robustness measures shocks of the selected design without silently substituting a new curve. Theoretical curve shapes remain separate from historical swap-price charts.

## Fingerprints and deployment verification

A deterministic fingerprint binds the reviewed configuration to deployment and readback. A mismatch blocks deployment. New designs use 32-character fingerprints; Journey's historical `16ac1e49b68f4a4c` remains valid historical evidence and is never rewritten to match a newer simulation.

**Deployment verified does not mean constraints passed.** It means the on-chain configuration matches the recorded design. Journey's constraints-not-met disclosure remains alongside its successful readback. Verification does not prove fair value, shareholder rights, asset backing, or regulatory compliance.

Registry registration and refresh require a readable configuration and an explicit WSOL or known USDC quote mint. Missing configuration evidence fails closed; an unsupported mint is not labelled SOL.

## Market Studio visual system

The October 8, 2026 UI uses base `#0D1215`, elevated `#151C20`, and mint accent `#6DE0C5`, with Inter for prose and JetBrains Mono for addresses and exact values. Cards use 16px corners; inputs use 10px corners. Restrained contrast, visible keyboard focus, reduced-motion support, responsive candidate cards/tables, expandable explanations, and inspectable charts keep dense information readable. The homepage market preview is explicitly illustrative.

## Non-goals

No price prediction, global-optimality claim, silent constraint relaxation, automated investment advice, invented liquidity or volume, identity verification, securities compliance, asset custody, shareholder-rights enforcement, or new on-chain program. The app configures and interacts with Meteora DBC and DAMM v2 on Solana.
