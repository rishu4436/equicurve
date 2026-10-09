# Market Passport and Live Design Monitor

The Market Passport is a permanent read-only record joining the issuer's
selected EquiCurve design with observable deployment and market state. It is a
query over canonical registry, scheduled-launch, on-chain DBC, DAMM, holder,
and confirmed history sources; it does not create a second market-state store.

## Fingerprint semantics

The design fingerprint deterministically identifies the canonical EquiCurve
market configuration represented by the signed design. It is not a fingerprint
stored on-chain. A verified deployment says that the on-chain DBC configuration
matches the canonical configuration represented by this fingerprint.

## Design assumptions and observations

Issuer design assumptions are shown separately from live observations. Target
raise, quote, selected preset/profile, requested budgets, accepted relaxations,
and stored simulation coverage are design records. Quote progress, migration,
LP lock, token-account distribution, and confirmed parsed swaps are observations
with a server `checkedAt` timestamp. Missing reads remain `null` or `unknown`.

## Monitor states

Monitor checks use only: `inside`, `near`, `outside`, `matched`, `mismatch`,
`unknown`, and `informational`. For numeric upper bounds, `inside` is at or
below 90% of the selected maximum, `near` is above 90% through 100%, and
`outside` is above 100%. Categorical checks never use `near`.

The initial checks cover configuration match, migration target, LP lock,
participation, largest observed token-account share, and confirmed swap count.
Participation and swap count are informational when the current read path
cannot defensibly compare them to a design limit. Trade impact is not compared
unless both sides use the same metric definition.

The largest observed token account share is a distribution observation. Token
accounts may not map one-to-one to beneficial owners.

## Robustness and lifecycle

Robustness is deterministic simulation coverage under selected assumptions. It
is not a probability, chance of success, performance forecast, credit rating,
investment recommendation, or fair-value assessment. Lifecycle and venue use
the existing DBC snapshot and DAMM destination verification: Raising, Curve
complete, Migrated, DAMM v2 active, Pending, or Unknown.

Live Design Monitor compares observable state with selected design parameters.
It is not a prediction, credit rating, investment recommendation, or fair-value
assessment.

## Failure and scheduled behavior

Holder failures make only holder-derived checks unknown. History failures make
swap-derived checks unknown. Core pool/config failures make deployment
verification unknown while the design record remains readable. A scheduled
Passport shows the design fingerprint, assumptions, accepted relaxations,
robustness, and launch time; deployment and live observations are explicitly
not applicable until a pool exists on-chain.

The Passport API is bounded, public read-only, deterministic for the same
read inputs, and uses `Cache-Control: no-store` while live reads are included.
The current local implementation reads the existing bounded file/registry
adapters. A production adapter can later add indexed reads without changing
these public semantics.

Scheduled identities do not yet migrate durably to a live pool identity. The
Passport keeps the scheduled view pre-launch and leaves the later linkage as a
follow-up instead of guessing across records.
