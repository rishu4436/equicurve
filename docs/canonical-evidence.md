# Canonical evidence: Journey

One path a judge can read without opening the engine. This is the public-devnet Journey deployment. It is not Northline, Pylon, Cinder, or the local-validator bundle. No new transaction was sent to write this page.

The token is not a share unless the issuer's own documents say so. EquiCurve did not verify NAV or custody. The bonding price is not NAV.

## 01 Issuer brief

Saved brief: [`scripts/demo/local-brief.json`](../scripts/demo/local-brief.json). The same brief is copied in [`demo-evidence/local-validator/brief.json`](../demo-evidence/local-validator/brief.json).

| Field | Value |
| --- | --- |
| Asset kind | private-company |
| Objective | controlled-discovery |
| Quote | SOL |
| Target raise | 100 |
| Typical order | 0.2 |
| Participants | 20 |
| Supply | 1,000,000,000 |
| Creator fee | 70% |
| LP lock | 100% |
| Anti-sniper | on |
| Cohort paths | 4 |
| Seed | 60428 |
| Name | Journey (JRNY) |
| Metadata | https://example.com/jrny.json |
| Seed buy | 0 |

Asset kind is a market-design assumption. It is not a legal classification.

## 02 Requested constraints

`private-company` plus `controlled-discovery` requests this budget (`src/lib/market/constraints.ts`):

| Limit | Requested |
| --- | --- |
| Threshold gap | 5% maximum |
| Typical buy impact | 1,200 bps maximum |
| Whale buy impact | 1,800 bps maximum |
| Largest buy share | 55% maximum |
| Minimum retail fill | 25% |

The objective tightens the whale cap from the asset's 2,200 bps to 1,800 bps. Nothing else is tightened.

## 03 Search coverage

From [`demo-evidence/local-validator/policy-review.json`](../demo-evidence/local-validator/policy-review.json):

- Stage: coarse-to-fine
- Presets: short, flat, exponential, long, equity
- Price multiples: 3, 5.5, 8, 12
- Candidates evaluated: 20

The recorded note says the coarse anchors are the minimum, midpoint, and maximum of the permitted range, then one finer midpoint beside each promising anchor. The sample does not prove a global optimum.

## 04 Infeasible result

Zero of the 20 candidates passed every requested constraint. The blocking limit on the selected row is retail fill.

Recorded on that row:

| Measurement | Value | Limit |
| --- | --- | --- |
| Retail fill | 3.84% (`retailProgress` 0.0384) | 25% minimum |
| Opening buy | 26 bps | 1,200 bps maximum |
| Whale sample | 214 bps | 1,800 bps maximum |

The search copy says "retail sample fills 4%". Opening impact and whale impact are inside their caps. The row is a tradeoff. It is not a fully feasible recommendation.

## 05 Explicit constraint relaxation

This deployment did not record an accepted relaxation. `constraintsPassed` is false. The public catalog row has no `constraintPolicy`.

Current search does not widen a limit unless the issuer accepts that widening. An accepted budget is stored as `requested`, `applied`, and `relaxed`, and `constraintsPassed` stays false. Tests in `tests/constraintBudget.test.ts` lock that.

[`demo-evidence/local-validator/policy-review.json`](../demo-evidence/local-validator/policy-review.json) still contains the older sentence "Impact, concentration, and participation limits were relaxed because none of the curves passed them." That file is the historical local bundle. It was not rewritten. Current search does not do that.

## 06 Resulting candidate

The candidate that was deployed:

| Field | Value |
| --- | --- |
| Profile | Exponential · 3× |
| Policy | EQ-af7ef6d94314 |
| Model | 0.3.0 |
| SDK | 1.5.12 |
| Seed | 60428 |
| Migration threshold | 99999604415 lamports |

## 07 Fingerprint

The pool was deployed with fingerprint `16ac1e49b68f4a4c`.

That is the hash in [`demo-evidence/public-devnet/manifest.json`](../demo-evidence/public-devnet/manifest.json) and in the Journey row of `src/lib/registry/publicDeployments.json`. The catalog row stores the canonical config that hashes to it.

`scripts/demo/local-brief.json` now expects `d44dbb02bb2d68ef` for a fresh search of the same brief. That is a later search hash. It is not the hash of the deployed pool.

## 08 Wallet authorization

The create transaction was signed by creator `4upqVDwyy3mSgwdZptY3PUG4jGNLd35XsXX3tEkEoEX5`. The public-devnet readback records the same creator.

The Journey public-devnet folder does not include a `registry.json`. Northline, Pylon, and Cinder do. On a public cluster, current Create refuses to send until the creator signs the registry message. This page does not invent a registry signature that was not saved in the Journey folder.

## 09 Create transaction

| Field | Value |
| --- | --- |
| Network | Solana devnet |
| Mode | config-and-pool, one transaction |
| Signature | `5H79kPYiaEVzShy6LCg4V9af6zdRkNb6Nyt63vVNT11k2jT4gZkkC5zY5o7zGTY3Wpd6icALTyTRt4Qi5M3hNLZM` |
| Slot | 506262571 |
| Block time | 2026-10-01T11:50:07.000Z |
| Pool | `Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF` |
| Config | `FigS23YEaaQZH2VJZkqGVsRCpgsJN5HztuvbfGMo6Zmf` |
| Mint | `31wt342XAZMbdiwcd4Uyxf7UxQVBskZ44GYTNV6XH44c` |

- Pool: https://explorer.solana.com/address/Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF?cluster=devnet
- Transaction: https://explorer.solana.com/tx/5H79kPYiaEVzShy6LCg4V9af6zdRkNb6Nyt63vVNT11k2jT4gZkkC5zY5o7zGTY3Wpd6icALTyTRt4Qi5M3hNLZM?cluster=devnet

## 10 On-chain readback

[`demo-evidence/public-devnet/assertions.json`](../demo-evidence/public-devnet/assertions.json) records `ok: true`. The migration threshold, sqrt start price, creator fee 70, and LP lock 100 match the design. The readback was checked at 2026-10-01T11:50:09.075Z. Quote reserve was 0. The pool was not migrated.

## 11 Registry attestation

The committed catalog row is the Journey object in `src/lib/registry/publicDeployments.json`.

| Field | Value |
| --- | --- |
| constraintsPassed | false |
| readbackPassed | true |
| fingerprint check | true |
| pool configuration check | true |
| migration threshold check | true |
| readback check | true |
| constraintPolicy | absent |

This page does not re-read the live registry. The committed catalog is the artifact.

## 12 Robustness report

Robustness is not in the signed design, the catalog row, or the Journey evidence folder. It answers how this exact curve behaves when one assumption moves. It does not select another design.

The check is an envelope: whale size, typical trade, participants, sell pressure, and late capital, each at −25%, the base design, and +25%. Each cell lists all five budget limits, the measured value beside the limit, and the limits that block. Sell-pressure drawdown and late-capital progress are shown as path measurements. They are not budget limits. There is no robustness score.

## 13 Final verification

The four recorded checks on the Journey catalog row are true, and `assertions.json` is `ok: true`. `constraintsPassed` remains false because the retail-fill limit was not met. A passed readback does not turn a tradeoff into a feasible design.

Other committed proofs, if you want a second market: [Northline](../demo-evidence/public-devnet-northline/README.md), [Pylon](../demo-evidence/public-devnet-pylon/README.md), [Cinder](../demo-evidence/public-devnet-cinder/README.md).
