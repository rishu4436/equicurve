# EquiCurve — Market Studio redesign

Implemented October 8, 2026. Scope: the presentation and interaction layer of the existing Next.js app.

## Design

- Charcoal surfaces, mint accent, clearer type hierarchy, consistent spacing, and larger form controls.
- New landing page with an interactive, explicitly illustrative curve preview, a three-step introduction, canonical Journey evidence, curve library, and final action.
- Desktop resources menu and complete mobile navigation; network identity remains visible.
- Creation workspace with a desktop step rail, a compact mobile step navigator, draft summary, and full-width market comparisons.
- One creator fee slider plus a numeric input and allocation bar; the existing fee-split calculation supplies the values.
- Expandable advanced settings, metric explanations, model notes, and exact robustness results. All existing options remain available.
- Shared chart presentation with labeled axes, consistent colors, pointer and keyboard inspection, and accessible data tables.
- Historical swap prices and theoretical curve shapes use separate charts and axes. Spot observations are labeled live or cached. Missing data remains unavailable.
- Updated discovery cards, trading tickets, review summaries, graduation progress, portfolio empty state, issuer dashboard, settings, and documentation navigation.
- One coordinated disclosure dialog for nested gates, focus containment and restoration, visible focus states, and reduced-motion support.

## Preserved behavior

No changes to `src/lib`, API routes, wallet providers, package dependencies, or lockfile. Transaction construction, signing, quote freshness, validation, constraint policies, simulation, fingerprinting, readback, defaults, and deployment predicates remain in the existing implementation.

An AST comparison against the original checkout confirmed 44 non-JSX functions in the creation, constraint, robustness, trading, graduation, and issuer components were unchanged. Presentation state was added for navigation, charts, and disclosure coordination.

## Validation

- Existing test suite: 39 files, 271 tests passed.
- ESLint: passed without warnings.
- TypeScript validation: passed.
- Production build: passed, including route generation and type/lint checks.
- Desktop and mobile browser checks, including 1440px, 390px, and a 320px landing-page check.
- All 15 page routes inspected; mobile overflow fixed in the create workspace and Trust Center.
- Tested preview selection, mobile navigation destinations, one-dialog behavior, the disabled acceptance state, fee allocation updates, simulation results, chart keyboard inspection, and the robustness matrix.
- No wallet connected, risk attestations accepted, transaction signed, or deployment performed during verification.

The public devnet RPC occasionally returned HTTP 429 during live-pool checks. The UI preserved the unavailable/unknown states and disabled transaction controls. This redesign does not alter RPC or data-fetch behavior.

Local verification completed before publication.
