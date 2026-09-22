# EquiCurve

**Fair on-chain discovery for tokenized equity / RWA on Solana** — Meteora Dynamic Bonding Curve (DBC) → graduate into DAMM v2.

Built for [Superteam Earn · Meteora DBC](https://superteam.fun/earn/listing/meteora-dbc) + Colosseum Crypto World's Fair sidetrack.

**Deadline:** 2026-10-13 · **Design approved:** 2026-09-22 · See [DESIGN.md](./DESIGN.md)

## Honesty (read this)

| Surface | Reality |
| --- | --- |
| **Explore (default)** | Only **your localStorage launches** + empty state. No unlabeled fake live markets. |
| **Show examples / `?demo=1`** | Static illustrative cards, badged **Illustrative · not live**. Trade disabled. |
| **Create → Launch** | Real DBC SDK. Quote is **SOL (WSOL) only**. Fee share, LP lock %, mint authority, optional seed buy map on-chain. |
| **Home stats** | Counts from this browser’s launches — not invented capital figures. |
| **Docs checklist** | Issuer attestation stored locally — not an upload vault. |
| **Token-2022 hooks** | Not in create path (Open SPL only; UI says coming soon). |

**Create → Launch** and **Trade / Graduate** call `@meteora-ag/dynamic-bonding-curve-sdk`. No mock on-chain success.

## Status

| Route | Status |
| --- | --- |
| `/` Home | Equity positioning + How it works + local launch strip |
| `/explore` | Tabs + real local launches; examples behind toggle / `?demo=1` |
| `/create` | 6-step wizard; fee / lock / mint / seed buy wired to SDK |
| `/presets` | Short raise · Flat · Exponential · Long (+ Equity-tuned) |
| `/o/[id]` | Progress chart, holders (mint supply + creator ATA), trade |
| `/o/[id]/graduate`, `/graduate/[pool]` | Real `migrateToDammV2` |
| `/trade/[pool]` | Quote & swap on curve (SOL) |
| `/portfolio` | Local activity / positions |
| `/issuer` | Fee claim over real claim SDK paths |
| `/trust` | Program IDs + copy aligned to what Create actually sets |
| `/docs` | Lifecycle docs |
| `/api/health` | Cluster + RPC host (no secrets) + slot ping |

Eligibility gate (geo / risk self-attest) gates Create + first trade.

## On-chain Create mapping

| Wizard control | SDK / config field |
| --- | --- |
| Quote | Always `WSOL` (SOL-only MVP) |
| Issuer fee % | `creatorTradingFeePercentage` (partner gets remainder) |
| LP lock % | `partnerPermanentLockedLiquidityPercentage` (≥10) |
| Mint renounce / retain | `TokenAuthorityOption.CreatorUpdateAuthority` / `CreatorUpdateAndMintAuthority` |
| Anti-sniper | `enableFirstSwapWithMinFee` |
| Seed buy (SOL &gt; 0) | `createConfigAndPoolWithFirstBuy` |
| Curve preset | `buildCurveWithMarketCap` (incl. **Short raise** for fast graduate demos) |

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

**Never commit private keys.** Devnet by default.

## Brand

- Background `#0B0F14` · elevated `#121821` · accent teal `#2DD4BF` · gold `#E8C547`
- Inter + JetBrains Mono — **not** neon casino / pump FOMO chrome

## Program IDs

- DBC: `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`
- DAMM v2: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`

(Also on `/trust`.)

## Known limits

- No USDC quote path yet (SOL/WSOL only)
- No Token-2022 transfer-hook create
- No holder indexer / historical price series (progress chart uses on-chain quote %)
- Explore has no global indexer — browser-local launches only
- Partner fee claimer is the deployer wallet in this MVP
- No mainnet traction / filmed submit assets yet

## Stack

Next.js 15 · TypeScript · Tailwind · Solana wallet adapter · `@meteora-ag/dynamic-bonding-curve-sdk`

## License

ISC — hackathon MVP for Rishu (@rishu4436).
