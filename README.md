# EquiCurve

**Fair on-chain discovery for tokenized equity / RWA on Solana** — Meteora Dynamic Bonding Curve (DBC) → graduate into DAMM v2.

Built for [Superteam Earn · Meteora DBC](https://superteam.fun/earn/listing/meteora-dbc) + Colosseum Crypto World's Fair sidetrack.

**Deadline:** 2026-10-13 · **Design approved:** 2026-09-22 (as-is) · See [DESIGN.md](./DESIGN.md)

## Status (Slices A–E)

| Route | Status |
| --- | --- |
| `/` Home | Equity positioning + **≤3 min demo strip** (Create → Trade → Graduate → Trust) |
| `/explore` | Tabs Trending / New / Raising / Graduated + `?tab=` deep links + local launches |
| `/create` | **6-step wizard** on real DBC SDK (Basics → Offering → Curve → Fees → Review → Launch) |
| `/presets` | Official Flat / Exponential / Long (+ Equity-tuned) |
| `/o/[id]` | Offering depth: Overview, Disclosures, Holders, Activity, On-chain + TradePanel |
| `/o/[id]/graduate`, `/graduate/[pool]` | Graduation ceremony + real `migrateToDammV2`; TX + explorer prominent |
| `/trade/[pool]` | Quote & swap on curve |
| `/portfolio` | Local activity / positions from browser launches |
| `/issuer` | Fee claim dashboard over real claim SDK paths |
| `/trust` | **Real Trust Center** — DBC + DAMM v2 IDs, LP lock ≥10%, mint policy, audits, risk |
| `/docs` | Create → Trade → Graduate, preset glossary, env setup |
| `/api/health` | Cluster + RPC host (no secrets) + slot ping |

**Create → Launch** and **Trade / Graduate** call `@meteora-ag/dynamic-bonding-curve-sdk`. No mock on-chain success.

Eligibility gate (geo / risk self-attest) gates Create + first trade for Slice B trust beat.

## Demo script (≤3 min)

Matches design §9 — film in this order:

| Time | Screen | Action |
| --- | --- | --- |
| 0:00–0:20 | `/` | Equity positioning + teal chrome; point at demo strip |
| 0:20–0:50 | `/create` | Long preset + fee split + LP lock ≥10% + DAMM badge |
| 0:50–1:10 | Review → Launch | Sign real DBC create; land on `/o/<pool>` |
| 1:10–1:50 | Offering | Buy on curve; ProgressRing; On-chain tab; Disclosures |
| 1:50–2:35 | Graduate | When threshold ready → migrate; **show TX + explorer**; DAMM note |
| 2:35–2:50 | `/issuer` or `/trust` | Fee claim **or** program IDs for judges |
| 2:50–3:00 | Close | Dual Colosseum + Earn; team |

**B-roll:** Explore Raising/Graduated; Presets; eligibility gate.

### What Rishu needs for the live demo

1. **Dedicated devnet RPC URL** in `.env.local` (`NEXT_PUBLIC_RPC_URL`) — public RPC will rate-limit mid-film  
2. **Wallet** (Phantom/Solflare) on **devnet**  
3. **Seed SOL** on that wallet (create + several buys + migrate fees)  
4. Optional: pre-create a partner `NEXT_PUBLIC_POOL_CONFIG_KEY` to speed launches  

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

Health check: `GET /api/health` → `{ ok, cluster, rpcHost, slot }` (host only — no API keys).

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

> **Collaborator note:** Automatic invite for `dannxbt` (pull) via `gh api` returned 422 in this environment. Please invite **manually**: GitHub → Settings → Collaborators → Add **dannxbt** with Read.

## Program IDs

- DBC: `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`  
- DAMM v2: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`  

(Also listed with explorer links on `/trust`.)

## Remaining blockers for Earn / Colosseum submit

- [ ] Film ≤3 min demo + ≤3 min pitch on **dedicated RPC** with funded wallet  
- [ ] Manual GitHub invite for **`dannxbt`** (pull) if repo is private  
- [ ] Fill Superteam Earn + Colosseum forms before **2026-10-13 12:29 IST**  
- [ ] Optional but strong: one featured **mainnet** offering for traction criterion  
- [ ] Metadata hosting / AI assist / community presets = post-MVP polish  

## Stack

Next.js 15 · TypeScript · Tailwind · Solana wallet adapter · `@meteora-ag/dynamic-bonding-curve-sdk`

## License

ISC — hackathon MVP for Rishu (@rishu4436).
