# EquiCurve walkthrough (reproducible)

Two ways to check EquiCurve end to end:

- **A. In the browser on public devnet**: what a judge or issuer sees, with a real wallet.
- **B. Scripted, on a local validator with the Meteora programs cloned from devnet**: the path the committed evidence ([e2e-devnet-evidence.md](e2e-devnet-evidence.md)) comes from.

> Evidence boundary: the full scripted lifecycle below was run on a local validator, not public devnet. The separate [canonical Journey evidence](canonical-evidence.md) records an existing public-devnet launch and readback; it does not claim the entire browser lifecycle below was performed publicly. The October 8 Market Studio hardening checks are browse/simulation-only, without wallet signing.

Nothing here touches mainnet. Keys used by the scripted suite live outside the repo (`E2E_KEYS_DIR`) and are never committed.

## Prerequisites

- Node 20+, `npm install`
- For A's transaction steps: a browser wallet (Phantom or Solflare; wallet-standard wallets may also be discovered) set to **devnet**, with devnet SOL. A SOL **Short raise** preset has a reference threshold of 3.090169943 SOL plus fees; a market design produced by search has its own displayed exact threshold.
- For B: the Solana CLI (`solana-test-validator`; the evidence run used Agave 4.2.2)

## A. Browser, public devnet

```bash
cp .env.example .env.local        # NEXT_PUBLIC_CLUSTER=devnet; set a dedicated devnet RPC if you have one
npm run dev                       # http://localhost:3000
```

1. **Read the positioning.** Home, `/trust` and `/docs` show the three layers: token launch (on-chain), equity representation (the issuer's legal framework; no shareholder rights are created), RWA verification (off-chain). `/trust` lists the trust assumptions and program IDs.
2. **Pick a preset.** `/presets` shows each preset's threshold in **SOL and USDC**, price multiple, fee schedule, and who each preset suits.
3. **Create** (`/create`, connect your wallet):
   - **Asset**: name, symbol, description, and an https image URL. The field checks type and size and shows a preview; advanced metadata controls remain available.
   - **Market goals**: asset kind, objective, quote, raise target, typical trade, participants, supply, seed buy, transfer profile, and the self-attested disclosure checklist (stored locally, not reviewed). The asset/objective set the initial constraints; the explicit budget editor is in Market design. To reproduce Journey's conflict use the recorded brief in [canonical evidence](canonical-evidence.md); synthetic analysis is not prediction.
   - **Terms**: creator fee % (actual creator / partner / protocol split), fee claimer, LP lock ≥ 10%, anti-sniper and mint-authority settings.
   - **Market design**: simulate the finite candidate set. Review conflicts, compare candidates and explicitly negotiate a limit with **Use 3.8% & recalculate** where the Journey retail proposal is shown. Constraints never change silently. Inspect robustness of the selected fingerprint. A preset's reference threshold is not a substitute for the selected design's exact threshold.
   - **Policy review**: every on-chain setting grouped as Token / Curve / Fees / Liquidity / Authorities / Seed buy / Network. It covers quote mint, token program, supply, decimals, curve points, threshold atoms, fee split, lock %, mint authority, feeClaimer, exact seed buy atoms, and the 0.001 SOL pool creation fee. Edit links return to the corresponding step. New designs use 32-character fingerprints; Journey retains historical `16ac1e49b68f4a4c`.
   - **Deploy**: connect and sign only when intentionally performing a funded devnet launch. The receipt lists config, pool, mint and transaction signatures with explorer links. States move from `estimate`/`pending` to `confirmed` only after chain readback. Browse-only hardening stops before this action.
4. **Trade on the curve** (`/o/<pool>`): enter an amount → **Review**. The summary shows exact input, estimated output, minimum output, fee and slippage. Wait more than 15 s and press Confirm: the app re-quotes and asks you to confirm again.
5. **Buy past the threshold**: enter more than the "remaining" shown on the Graduation card. The review shows a **partial fill** notice (only the fillable part is taken and the rest stays in your wallet), and the buy completes the curve. Before PASS 3 this failed with DBC error 6033.
6. **Graduate**: the Graduation card shows threshold, raised, exact remaining, and the expected DAMM v2 pool. Press Migrate (any wallet can). The DAMM v2 pool is shown as **verified** only after its account is fetched.
7. **Trade on DAMM v2**: the DAMM ticket on the same page quotes and swaps, with the same pre-sign summary.
8. **Claims**: `/issuer` shows creator and partner trading fees for your pools. Wrong wallets are refused before signing. DAMM LP position fees can be claimed from the ticket.
9. **Metadata**: on the offering Overview tab, the creator can edit description, image and links (signed). Name and symbol are locked.
10. **Explore / Portfolio**: Explore marks registry rows **verified** only after chain verification. Portfolio separates on-chain wallet balances from locally recorded activity.

## B. Scripted, localnet with cloned Meteora programs

```bash
# 1. Validator with DBC, DAMM v2, Metaplex + DAMM v2 configs cloned from devnet (run in its own terminal; it keeps running)
scripts/e2e/start-localnet.sh

# 2. The 6-dec "USDC" stand-in mint keypair (the suite creates the mint on first run)
export E2E_KEYS_DIR=/workspace/equicurve-e2e/keys; mkdir -p $E2E_KEYS_DIR
[ -f $E2E_KEYS_DIR/usdc-standin-mint.json ] || solana-keygen new --no-bip39-passphrase -s -o $E2E_KEYS_DIR/usdc-standin-mint.json
QUOTE6=$(solana-keygen pubkey $E2E_KEYS_DIR/usdc-standin-mint.json)

# 3. A second app instance for the API routes, pointed at the validator
#    (a separate copy so it doesn't share .next with your dev server)
mkdir -p /tmp/eq-e2e-app && tar --exclude=./node_modules --exclude=./.next --exclude=./.git -cf - . | (cd /tmp/eq-e2e-app && tar xf -)
ln -sfn "$PWD/node_modules" /tmp/eq-e2e-app/node_modules
cat > /tmp/eq-e2e-app/.env.local <<ENV
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899
RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_CLUSTER=devnet
NEXT_PUBLIC_USDC_MINT_OVERRIDE=$QUOTE6
ENV
(cd /tmp/eq-e2e-app && npx next dev -p 3011 &)

# 4. Run the suite, then re-fetch every signature straight away
#    (the test validator's ledger is size-limited, so old signatures age out)
E2E_RPC_URL=http://127.0.0.1:8899 npm run e2e:devnet
E2E_RPC_URL=http://127.0.0.1:8899 npm run e2e:report > /tmp/table.md
```

The suite funds its keypairs from the local faucet, creates the 6-decimal stand-in quote mint, then runs:

| Scenario | What it proves |
| --- | --- |
| S1–S4 | Creates (SOL / stand-in USDC, SPL / Token-2022, with and without seed buy) and 26–28 on-chain field checks per pool against the wizard inputs |
| S5 | Registry authorization: creator-signed POST listed, wrong signer 403, spoofed status 400, declined signature → local only |
| S6 | DBC buy/sell exact vs quote, slippage failures mapped (preflight and landed) |
| S7 | Creator and partner fee claims, wrong wallet refused |
| S8 | Short raise → completion (final buy deliberately 1.5× the remaining curve → **partial fill**) → migrate → DAMM v2 verified → registry `graduated`; SOL short preset threshold = wizard value (3.09 SOL) |
| S9 | DAMM v2 quote + swap both directions and both token orders, position fee claim |
| S10 | Expired blockhash, insufficient funds, degraded RPC → *unknown*, never 0% or complete |

Expected result: every step PASS except the S3 transfer-hook sub-case, which is SKIPPED because no transfer-hook program is available.

To run the same suite on **public devnet**, fund the keypairs in `E2E_KEYS_DIR` (about 1 SOL in total for the non-graduating scenarios; the SOL short-raise scenario runs on localnet only). Point the app instance's RPC at devnet and omit `E2E_RPC_URL`. Explorer links then use `?cluster=devnet`.

## Unit tests and build

```bash
npx tsc --noEmit
npm test          # vitest
npm run build
```
