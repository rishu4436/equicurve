# EquiCurve local-validator evidence

This bundle is the output of `npm run demo:local` for `scripts/demo/local-brief.json`.

**Environment:** local validator. Local validator at 127.0.0.1:8899. Meteora programs on this ledger were cloned from devnet when the ledger was created. This is not a public-devnet deployment.

**Result:** PASSED. On-chain config matches the selected design.

**Seed:** 60428. Cohort path i uses seed (brief seed + i * 997) mod 2^32. The path file is cohort-paths.json.

The search result is a tradeoff when no candidate meets every constraint. The bundle keeps that candidate for inspection and does not relabel it as fully feasible.

Files: brief.json, assumptions.json, candidates.json, policy-review.json, selected-config.json, deployment.json, readback.json, assertions.json, environment.json, cohort-paths.json.
