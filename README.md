# EquiCurve

**Fair on-chain discovery for tokenized equity / RWA on Solana** — Meteora Dynamic Bonding Curve (DBC) → graduate into DAMM v2.

Built for [Superteam Earn · Meteora DBC](https://superteam.fun/earn/listing/meteora-dbc) + Colosseum Crypto World's Fair sidetrack.

**Deadline:** 2026-10-13 · **Design approved:** 2026-09-22 (as-is) · Authority: `equicurve-research/04-equicurve-design.md`

## What works (Slice A)

| Route | Status |
| --- | --- |
| `/` Home | Equity/RWA positioning, DBC→DAMM how-it-works, featured offerings, dual CTAs |
| `/explore` | Tabs Trending / New / Raising / Graduated + sector chips + OfferingCards |
| `/create` | **6-step wizard**: Basics → Offering → Curve → Fees & locks → Review → Launch |
| `/presets` | Official Flat / Exponential / Long (+ Equity-tuned) |
| `/trust` | Program IDs, LP lock ≥10%, mint policy skeleton |
| `/docs` | How DBC→DAMM works, risk, issuer/investor skeletons |
| `/o/[id]` | Offering detail (demo board or live pool address) + TradePanel |
| `/o/[id]/graduate`, `/trade/[pool]`, `/graduate/[pool]` | Restyled stubs over real swap / migrate SDK |
| `/portfolio`, `/issuer` | Skeletons for later slices |

**Create → Launch** calls real `@meteora-ag/dynamic-bonding-curve-sdk` (`partner.createConfigAndPool` or `creator.createPool`). No mock success.

## Demo path (≤3 min)

1. Open `/` — equity positioning + teal fintech chrome  
2. `/create` — fill Basics → Offering (self-attest docs) → pick **Long** → Fees (70/20/10, lock ≥10%) → Review acks → **Launch**  
3. Connect **devnet** wallet with SOL → sign DBC create  
4. Land on `/o/<pool>` / `/trade/<pool>` → quote & swap on curve  
5. `/graduate/<pool>` when threshold ready → DAMM v2 migrate  
6. `/trust` — program IDs for judges  

## Brand

- Background `#0B0F14` · elevated `#121821` · accent teal `#2DD4BF` · gold verified `#E8C547`  
- Inter + JetBrains Mono — **not** neon casino / pump FOMO chrome  

## Quick start

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_RPC_URL to a dedicated devnet RPC for demos
npm install
npm run dev
```

```bash
npm run typecheck
npm run build
```

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_RPC_URL` | Recommended | Defaults to public `api.devnet.solana.com` (rate-limited) |
| `NEXT_PUBLIC_CLUSTER` | No | `devnet` (default) / `mainnet-beta` / `testnet` |
| `NEXT_PUBLIC_POOL_CONFIG_KEY` | No | Reuse partner PoolConfig; else each launch creates config+pool |
| `NEXT_PUBLIC_DAMM_V2_CONFIG` | No | Defaults to published 100 bps DAMM v2 migration fee config |

**Never commit private keys.** Devnet by default. App never invents keys or spends funds without wallet signature.

## Judge / collaborator access

Repo: https://github.com/rishu4436/equicurve  

If private, grant **pull** to **`dannxbt`**.

> **Collaborator note:** Automatic invite for `dannxbt` (pull) via `gh api` returned 422 in this environment. Please invite manually: GitHub → Settings → Collaborators → Add **dannxbt** with Read.

## Program IDs

- DBC: `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`  
- DAMM v2: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`  

## Known gaps (Slices B–E)

- B: Live offering indexer, Disclosures/Holders/Activity tabs, eligibility gate modal polish  
- C: Issuer fee claim dashboard, portfolio positions from wallet history  
- D: Graduation ceremony morph animation, DAMM depth chart  
- E: Metadata hosting, AI assist (rules→LLM), community preset marketplace, mainnet demo  

## Stack

Next.js 15 · TypeScript · Tailwind · Solana wallet adapter · `@meteora-ag/dynamic-bonding-curve-sdk`

## License

ISC — hackathon MVP for Rishu (@rishu4436).
