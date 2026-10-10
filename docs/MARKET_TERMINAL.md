# Market Terminal V2

Market Terminal V2 keeps the current market number separate from the historical
chart. The terminal reads the verified active venue server-side; the chart joins
confirmed DBC and post-migration DAMM v2 swaps and never supplies the
terminal's current price.

## Active venue resolution

The market lifecycle comes from the existing DBC pool and config reads. A
raising or completed, not-yet-migrated pool uses DBC while the DBC pool is the
verified venue. A migrated pool is `DAMM v2` only after the expected destination
is derived from the pool's migration configuration and the destination account
is fetched and verified for the same base and quote mints. A migrated pool with
a destination that has not appeared is `Pending`; a failed or incomplete read
is `Unknown`.

The metrics endpoint is pool-identity based:

`GET /api/markets/[pool]/metrics`

It resolves the base mint internally. The holders endpoint remains mint based:
`/api/markets/[mint]/holders`.

## Current price

For DBC, the resolver reuses the verified DBC virtual-pool `sqrtPrice` path in
`fetchSpotPrice`. It reads the base and quote mint decimals from chain and
publishes quote per base token only when the pool, orientation, and decimals
are readable.

For DAMM v2, the resolver derives the expected destination, fetches its pool
state, verifies both mints, reads both mint decimals, and reuses the existing
CP-AMM `sqrtPrice` conversion. A historical DBC swap is never used as the
current price after DAMM v2 becomes the verified active venue.

## Valuation and supply

FDV is current active-venue price multiplied by verified mint total supply.
Total supply is read from `getTokenSupply` and kept as an exact decimal string
until display.

Market Cap is current active-venue price multiplied by verified circulating
supply. EquiCurve does not yet have a defensible circulating-supply
methodology that accounts for treasury, protocol locks, curve inventory, DAMM
reserves, and beneficial ownership. Therefore circulating supply and Market Cap
are explicitly unavailable in Phase 1; FDV is never substituted into Market
Cap.

## Denomination and USD reference

The terminal has two independent controls: `Price` / `MCap` and `USD` / `SOL`.
SOL is the default denomination. SOL markets use the quote price directly and
may add a short-lived server-side CoinGecko SOL/USD reference for USD display.
The reference has a three-second timeout, a thirty-second cache, and an
observation timestamp. If it fails, SOL remains available and USD is shown as
unavailable.

For supported USDC quote markets, the current project semantics treat USDC as
USD-equivalent for USD display. A USDC market does not invent a SOL conversion
without a canonical USDC/SOL source.

## Liquidity, holders, and unavailable data

Phase 1 reports liquidity only for a verified DAMM v2 quote vault. DBC virtual
reserves are not presented as normalized liquidity. Holders use the existing RPC
token supply and largest-token-account reads. A failed secondary read marks the
metrics object partial while independent values remain available.

Phase 2 computes 24-hour volume and change from the confirmed history endpoint
only when its bounded scan reaches the trailing 24-hour boundary. Unknown
values render as `—` and are never replaced with zero.

## Chart and formatting

`GET /api/markets/[pool]/history?mode=trades|candles&timeframe=5m|15m|1h|4h|1d|all`
is the reusable server history read. Its identity is the canonical DBC pool;
the server resolves the launched base/quote mints and the verified DAMM v2
destination internally.

The normalized trade model stores signature, confirmed slot and block time,
venue, launched base mint, quote mint, buy/sell side, exact atom quantities,
exact UI quantities, quote-per-base execution price, source, and a verified
flag. DBC trades come from the existing Meteora event parser. DAMM v2 trades
come from confirmed transactions for the expected, decoded CP-AMM pool and
are accepted only when the verified base and quote vaults have unambiguous
opposite balance deltas. LP changes, fee claims, account creation, unrelated
CPI, failed transactions, and ambiguous transfers are skipped.

The two venues are joined only when the base mint, quote mint, decimal basis,
and verified pool identities agree. Trades are ordered by block time, slot, and
signature and deduplicated by signature. The migration boundary uses an exact
migration transaction when one is available. Otherwise the response exposes a
transition region around the last DBC and first verified DAMM trade and does
not claim a precise migration timestamp.

Candles use quote-per-base prices and contain open, high, low, close, exact
base volume, exact quote volume, trade count, and contributing venues. Empty
buckets are omitted. The line mode plots confirmed normalized trade prices;
the Candles mode plots the same trades aggregated into OHLCV buckets. Volume
bars use quote volume and the same buckets. Supported windows are 5m, 15m,
1h, 4h, 1D, and ALL; ALL adapts to one-hour, four-hour, or daily buckets based
on the observed span.

History scans are bounded to eight signature pages, 400 signatures, 400 parsed
transactions, and eight seconds per venue. A scan is complete only after it
crosses the requested boundary or reaches the end of the account history. A
ceiling or RPC failure marks coverage partial. Confirmed history is cached for
ten seconds per pool/window/mode, while failures are not retained as a long
lived result.

24-hour volume is the sum of confirmed quote-side swap amounts across the
canonical DBC and DAMM lifecycle. It is `0` only when coverage proves the full
window and no trade occurred; otherwise it is `null`. 24-hour change compares
the current active-venue spot with the most recent confirmed trade at or before
the 24-hour boundary. Without that reference trade it is `null`.

The current price remains independent: verified DBC `sqrtPrice` while DBC is
active, or verified DAMM v2 `sqrtPrice` after migration. It is shown as a
separate spot overlay and is never appended as a historical trade. MCap mode
keeps the chart explicitly as Price history because circulating supply is
unavailable; FDV remains a header metric only. Historical USD is disabled for
SOL-quoted markets because applying today's SOL/USD reference to old swaps
would be misleading. USDC quote history may be shown as USD-equivalent under
the existing policy.

Price formatting uses explicit `SOL`, `USD`, and `lamports` labels. The
ambiguous `ℓ` notation is not used. Tiny prices retain significant digits, for
example `0.00000001366 SOL` or `13.66 lamports`.

No orderbook, depth, heatmap, PnL overlay, technical indicators, websocket
stream, fast polling, or multi-market comparison is included in this phase.
