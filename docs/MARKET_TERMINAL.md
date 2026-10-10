# Market Terminal V2

Market Terminal V2 keeps the current market number separate from the historical
chart. The terminal reads the verified active venue server-side; the chart is a
DBC swap-history view and never supplies the terminal's current price.

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

24-hour volume and change remain unavailable until a history aggregation phase
defines a defensible cross-venue methodology. Unknown values render as `—` and
are never replaced with zero.

## Chart and formatting

The chart remains confirmed DBC swap history plus an optional DBC spot
observation while the market is on DBC. After migration it is labeled
“Historical DBC swaps” with “DBC history · market now trades on DAMM v2”. DAMM
history is not joined in this phase.

Price formatting uses explicit `SOL`, `USD`, and `lamports` labels. The
ambiguous `ℓ` notation is not used. Tiny prices retain significant digits, for
example `0.00000001366 SOL` or `13.66 lamports`.

Phase 1 does not implement candles, volume bars, timeframes, trade markers, or
unified DBC and DAMM history. Those belong to Market Terminal V2 Phase 2.
