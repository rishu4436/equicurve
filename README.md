# EquiCurve

**Fair on-chain discovery for tokenized equity / RWA on Solana** — Meteora Dynamic Bonding Curve (DBC) → graduate into DAMM v2.

Built for [Superteam Earn · Meteora DBC](https://superteam.fun/earn/listing/meteora-dbc) + Colosseum Crypto World's Fair sidetrack.

**Deadline:** 2026-10-13 · **Design approved:** 2026-09-22 · See [DESIGN.md](./DESIGN.md)

## Honesty (read this)

| Surface | Reality |
| --- | --- |
| **Explore (default)** | **EquiCurve registry** (`GET /api/explore`) + this browser’s localStorage, deduped by pool. No unlabeled fake live markets. |
| **Show examples / `?demo=1`** | Static illustrative cards, badged **Illustrative · not live**. Trade disabled. |
| **Create → Launch** | Real DBC SDK. Quote **SOL (WSOL)** default; **USDC** when a known mint exists for the cluster. Fee share, LP lock %, mint authority, optional seed buy, optional partner feeClaimer map on-chain. |
| **Home stats** | Counts from this browser’s launches — not invented capital figures. |
| **Docs checklist** | Issuer attestation stored locally — not an upload vault. |
| **Token-2022 / hooks** | Create supports Open SPL, Token-2022 (no hook), and Token-2022 + transfer hook when `NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM` is set. Swap uses `swap2WithTransferHook` for hook pools. |
| **Offering price chart** | Live pools: swap-implied points from confirmed txs (`getSignaturesForAddress` + EvtSwap / balance deltas) + live spot from pool `sqrtPrice`. Points accumulate in localStorage. Dashed series = bonding **curve shape (not history)**. Demo/empty: curve shape only — no invented history. |

**Create → Launch** and **Trade / Graduate** call `@meteora-ag/dynamic-bonding-curve-sdk`. No mock on-chain success.

## Status

| Route | Status |
| --- | --- |
| `/` Home | Equity positioning + How it works + local launch strip |
| `/explore` | Tabs + shared registry + local launches; examples behind toggle / `?demo=1` |
| `/create` | 6-step wizard; fee / lock / mint / seed buy wired to SDK |
| `/presets` | Short raise · Flat · Exponential · Long (+ Equity-tuned) |
| `/o/[id]` | Offering detail + **in-app DAMM v2 post-grad ticket** (quote/swap2 + position fee claim) when graduated |
| `/o/[id]` (legacy note) | Historical price chart (swap txs + spot), holders, trade |
| `/o/[id]/graduate`, `/graduate/[pool]` | Real `migrateToDammV2` |
| `/trade/[pool]` | Quote & swap on curve (SOL) |
| `/portfolio` | Local activity / positions |
| `/issuer` | Fee claim over real claim SDK paths |
| `/trust` | Program IDs + copy aligned to what Create actually sets |
| `/settings` | Cluster, RPC host (env), registry backend (file/upstash), clear local storage |
| `/docs` | Lifecycle docs |
| `/api/health` | Cluster + RPC host (no secrets) + slot ping |
| `/api/metadata/[id]` | Hosted token metadata JSON (no fake domain) |
| `/api/launches` | Shared EquiCurve launch registry (GET / POST / PATCH) |
| `/api/explore` | Explore discovery: registry + best-effort RPC enrich (~45s cache) |

A self-attestation & risk-disclosure prompt is shown before Create / Trade. It is **not KYC**: it does not verify identity or location, does not enforce jurisdictional eligibility, and is stored only in the browser.

## On-chain Create mapping

| Wizard control | SDK / config field |
| --- | --- |
| Quote | `WSOL` default; USDC mint when selected & known for cluster |
| Issuer fee % | `creatorTradingFeePercentage` (partner gets remainder) |
| LP lock % | `partnerPermanentLockedLiquidityPercentage` (≥10) |
| Mint renounce / retain | `TokenAuthorityOption.CreatorUpdateAuthority` / `CreatorUpdateAndMintAuthority` |
| Anti-sniper | `enableFirstSwapWithMinFee` |
| Seed buy (SOL &gt; 0) | `createConfigAndPoolWithFirstBuy` |
| Transfer profile | `open-spl` → SPL `createConfigAndPool`; `token-2022` → Token2022 same builders; `transfer-hook` → `createConfigAndPoolWithTransferHook` (+ env program) |
| Curve preset | `buildCurveWithMarketCap` (incl. **Short raise** for fast graduate demos) |


### Post-grad DAMM v2 ticket

After DBC → DAMM v2 migration, `/o/[id]` renders an in-app **DAMM ticket** powered by `@meteora-ag/cp-amm-sdk`: pool identity (derived/stored address + explorer/Meteora links), ExactIn **quote + swap** (`getQuote2` / `swap2`), and **claim position fees** for wallet-owned positions. Add/remove liquidity UI is intentionally deferred (honest empty-state). No fabricated TVL/volume.

## Quick start

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_RPC_URL to a dedicated devnet RPC for demos
npm install
npm run dev
```

```bash
npm run typecheck
npm test        # vitest unit tests (amounts, validation, auth, registry, explore, graduation states, presets, errors, RPC retry)
npm run build
```

On-chain end-to-end suite (drives the same `src/lib` functions the UI uses, signing with local keypairs): `npm run e2e:devnet`. Needs an app instance for the `/api` routes (`E2E_APP_URL`, default `http://localhost:3011`) and keypairs under `E2E_KEYS_DIR` (default `/workspace/equicurve-e2e/keys`, never committed). `E2E_RPC_URL=http://127.0.0.1:8899` runs it against a local validator with the Meteora programs cloned from devnet. Evidence: [docs/e2e-devnet-evidence.md](docs/e2e-devnet-evidence.md).

Health check: `GET /api/health` → `{ ok, cluster, rpcHost, slot, registry: { backend } }` (host + backend name only — no API keys / tokens).

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_RPC_URL` | Recommended | Browser RPC (wallet txs + client reads). Defaults to public `api.devnet.solana.com` (rate-limited). Visible to users — use a key-restricted/domain-locked URL. |
| `RPC_URL` | Recommended | **Server-only** dedicated RPC for API routes (registry verification, Explore enrichment, health). Never exposed to the browser. Falls back to `NEXT_PUBLIC_RPC_URL`. |
| `NEXT_PUBLIC_CLUSTER` | No | `devnet` (default) / `mainnet-beta` / `testnet` |
| `NEXT_PUBLIC_POOL_CONFIG_KEY` | No | Reuse partner PoolConfig; else each launch creates config+pool |
| `NEXT_PUBLIC_DAMM_V2_CONFIG` | No | Optional sanity override only. Migration always uses `DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption]`; if this is set and differs, migration is refused with a clear message. |
| `NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM` | No | Executable Token-2022 transfer-hook program (no fake default) |
| `UPSTASH_REDIS_REST_URL` | No | With token → durable Upstash Redis registry (recommended on Vercel) |
| `UPSTASH_REDIS_REST_TOKEN` | No | REST token from Upstash console — never commit |

**Never commit private keys or Upstash tokens.** Devnet by default.

### Durable registry (Upstash) on Vercel

Local `next dev` uses `data/launches/registry.json` (file backend) when Upstash env is unset.

On serverless the filesystem is ephemeral. To keep Explore launches across deploys:

1. Create a **free** Redis database at [console.upstash.com](https://console.upstash.com/).
2. Open the DB → **REST API** → copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. In Vercel → Project → **Settings → Environment Variables**, add both (Production + Preview as needed).
4. Redeploy. Confirm via `GET /api/health` → `registry.backend: "upstash"` (also shown on `/settings`). Tokens are never returned by the API.

If Upstash is empty and a local registry file exists on that instance, the server may one-time seed Redis from the file (best-effort). An empty Upstash on a fresh deploy is fine — new Creates will populate it.

## Brand

- Background `#0B0F14` · elevated `#121821` · accent teal `#2DD4BF` · gold `#E8C547`
- Inter + JetBrains Mono — **not** neon casino / pump FOMO chrome

## Program IDs

- DBC: `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`
- DAMM v2: `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`

(Also on `/trust`.)

## Registry trust model

- **Register (`POST /api/launches`)** takes only a wallet-signed payload `{ payload: { v, action, cluster, pool, mint, profile, metadata }, auth: { signer, signature, issuedAt } }` (strict schema — unknown keys such as `status` or `creator` are rejected). The server verifies the ed25519 signature (≤20 min old), re-reads the pool on-chain, requires `payload.mint` = on-chain base mint and signer = on-chain pool creator, and derives **every** chain field (creator, config, quote, lock, status, migration) from chain. Older authorizations are rejected (409).
- **Refresh (`PATCH /api/launches`)** accepts only `{ pool }`; the server re-reads chain state (status / graduation / DAMM v2 pool). Clients can never set status.
- **Metadata (`PUT /api/metadata/<mint>`)** uses the same signed payload. Before launch (mint not on-chain) the signer becomes the owner; afterwards only the owner / on-chain creator can edit.
- Wallets without `signMessage` (or a declined prompt) still launch; the offering stays local-only and metadata is inlined as a `data:` URI.
- Rate limits are in-memory per server instance (best-effort, not a WAF).

## Verification states (Explore / offering page)

Each live offering shows **Verified on-chain**, **Not found on-chain**, **RPC unavailable** or **Not checked**, with the cluster and "last checked" time. Status/progress are shown as verified only when read on-chain in that response; otherwise status is marked *unverified* and progress is **unknown** (never 0%).

## Graduation states

`/o/[id]` and `/o/[id]/graduate` read `isMigrated`, `migrationProgress`, quote reserve and `migrationQuoteThreshold` from the DBC pool/config accounts and show: **Status unknown** (read failed) · **Not eligible** (below threshold, locker pending, or config not DAMM v2 / unknown fee option) · **Eligible** · **Migration submitted** · **Migration confirmed** · **DAMM v2 pool verified**. The migrate transaction is built only after re-checking eligibility on-chain, success is shown only after the tx confirms **and** the DAMM v2 pool account is fetched (and holds this offering's mints). The DAMM ticket treats the pool as live only after that fetch — a derived address is not proof.

## Explore discovery model

| Piece | Role |
| --- | --- |
| **EquiCurve registry** | On successful Create, client `POST /api/launches` with a creator-signed payload (see trust model). Honest label: *not a full chain indexer*. |
| **Storage backends** | **file** (default): `data/launches/registry.json` for `next dev`. **upstash**: when `UPSTASH_REDIS_REST_*` are set — durable across Vercel deploys. Active backend is exposed as `registry.backend` on `/api/health`, `/api/launches`, `/api/explore` (no tokens). |
| **`GET /api/explore`** | Returns registry offerings with per-offering verification state; on-chain progress = quote reserve / migration threshold from the pool + config accounts (first 24 offerings, 4 concurrent, 8s timeout each), **~45s in-memory cache**. |
| **localStorage** | Still kept so a single browser works offline from the registry; Explore merges and dedupes by pool. |
| **Shared PoolConfig GPA** | If `NEXT_PUBLIC_POOL_CONFIG_KEY` is set, supplemental `getPoolsByConfig` (memcmp filter) — not a full-program scan. |
| **Meteora DBC Data API** | `https://dbc.datapi.meteora.ag/pools` exists and indexes ~all DBC pools, but **cannot filter EquiCurve-created** offerings. We do **not** dump that feed onto Explore (would be unlabeled meme markets). |
| **Show examples** | Separate illustrative toggle / `?demo=1` — never mixed in as live. |

**Limits:** file backend is ephemeral on many serverless hosts (use Upstash for durability); public RPC may rate-limit enrichment; never invents pools.

## Known limits

- USDC quote requires the known Circle mint on the active cluster (devnet/mainnet); testnet has none. On non-mainnet clusters `NEXT_PUBLIC_USDC_MINT_OVERRIDE` can point at a self-minted 6-decimal stand-in (used by the e2e suite)
- Seed buy in USDC needs a funded USDC ATA
- Transfer-hook create needs a real executable `NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM` (no default/fake hook)
- Mint+update authority retain only on transfer-hook profiles
- Price chart: swap-implied history from recent pool txs + live spot; dashed overlay is curve shape (not history). Thin history until enough swaps exist; no indexer / no oracle
- Holders list is mint supply + creator ATA + `getTokenLargestAccounts` (no full indexer)
- Activity mixes RPC `getSignaturesForAddress` with browser-local rows
- Explore uses an **EquiCurve registry** (file or Upstash; not a full chain indexer) plus localStorage; optional filtered `getPoolsByConfig` when `NEXT_PUBLIC_POOL_CONFIG_KEY` is set
- No mainnet traction / filmed submit assets yet

## Stack

Next.js 15 · TypeScript · Tailwind · Solana wallet adapter · `@meteora-ag/dynamic-bonding-curve-sdk` · optional `@upstash/redis`

## License

ISC — hackathon MVP for Rishu (@rishu4436).
