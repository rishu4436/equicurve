# Judge screens and capture provenance

The six original PNGs below are **historical, pre-redesign captures from October 2, 2026**, not the current Market Studio UI. The dev server was `http://127.0.0.1:3010`. No new transaction was signed or sent. The October 8 redesign supersedes their presentation; [canonical Journey evidence](../canonical-evidence.md) remains the authoritative historical judge path.

## Current Market Studio captures — October 8, 2026

| File | Source and evidence |
| --- | --- |
| `2026-10-08-01-home.jpg` | Production homepage: illustrative preview and historical Journey proof |
| `2026-10-08-02-goals.jpg` | Local Create wizard: 100 SOL raise, 0.2 SOL typical order, 20 participants; declarations unchecked |
| `2026-10-08-03-conflict.jpg` | Local MarketDesignStep: Journey brief, 8 synthetic paths, 20 candidates, none fully feasible |
| `2026-10-08-04-negotiation.jpg` | Explicitly accepted retail-budget change, displayed as 25% → 3.8%; original failure remains disclosed |
| `2026-10-08-05-robustness.jpg` | Same selected 32-character fingerprint; 8 of 10 shocks inside the accepted budget |
| `2026-10-08-06-journey.jpg` | Existing production Journey deployment and its four readback checks |

Screens 03–05 use the actual MarketDesignStep and wizard state-update functions in a temporary local component fixture, with the Journey brief and no wallet or deployment action. The fixture was removed before the final build. This exercises synthetic analysis without accepting personal/issuer declarations on someone else's behalf. The displayed 3.8% suggestion retains its existing internal precision (3.84%). These are current UI captures, not evidence of a new public-devnet launch. Production captures show the Market Studio UI at `45f79aa`; this hardening pass does not change that UI.

## Historical October 2 captures

| File | What it shows |
| --- | --- |
| `01-hero.png` | Homepage thesis and the recorded Journey proof |
| `02-issuer-brief-constraints.png` | Journey brief: private-company, controlled discovery, 100 SOL, 0.20 SOL, 20 participants, and the requested limits |
| `03-constraint-conflict.png` | 20 candidates evaluated, 0 fully feasible, Exponential · 3× held for comparison |
| `04-constraint-negotiation.png` | The issuer edits each limit. The retail suggestion is Use 3.8% |
| `05-robustness-envelope.png` | Shocks of the selected curve. No score, and the curve is not replaced |
| `06-verified-deployment.png` | Existing Journey pool. Fingerprint `16ac1e49b68f4a4c`. Four readback checks passed. Constraints were not met |

The October 2 wizard used 8 cohort paths and displayed the then-short fingerprint `d44dbb02bb2d68ef`. Current new designs use 32-character fingerprints (for example `d44dbb02bb2d68ef00e9e714da519e58`). Neither is the historical deployed Journey fingerprint, which remains `16ac1e49b68f4a4c`. The homepage panel uses the deployed fingerprint.

In the October 2 check, the wallet list opened on the deploy step (Phantom and Solflare). Neither wallet was selected. The launch control stayed "Connect wallet to launch". Explore then listed Journey, Northline, Pylon, and Cinder, each marked deployment verified from a chain read. These statements describe that historical check, not a fresh transaction or a guarantee of current RPC availability.
