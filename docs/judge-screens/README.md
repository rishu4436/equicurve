# Judge screens

Six captures from a local click-through on 2026-10-02. The dev server was `http://127.0.0.1:3010`. No new transaction was signed or sent.

| File | What it shows |
| --- | --- |
| `01-hero.png` | Homepage thesis and the recorded Journey proof |
| `02-issuer-brief-constraints.png` | Journey brief: private-company, controlled discovery, 100 SOL, 0.20 SOL, 20 participants, and the requested limits |
| `03-constraint-conflict.png` | 20 candidates evaluated, 0 fully feasible, Exponential · 3× held for comparison |
| `04-constraint-negotiation.png` | The issuer edits each limit. The retail suggestion is Use 3.8% |
| `05-robustness-envelope.png` | Shocks of the selected curve. No score, and the curve is not replaced |
| `06-verified-deployment.png` | Existing Journey pool. Fingerprint `16ac1e49b68f4a4c`. Four readback checks passed. Constraints were not met |

The wizard used 8 cohort paths, so that live search fingerprinted `d44dbb02bb2d68ef`. The deployed pool is `16ac1e49b68f4a4c`. The homepage panel uses the deployed fingerprint.

The wallet list opened on the deploy step (Phantom and Solflare). Neither wallet was selected. The launch control stayed "Connect wallet to launch". Explore listed Journey, Northline, Pylon, and Cinder, each marked deployment verified from a chain read.
