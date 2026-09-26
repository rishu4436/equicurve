# EquiCurve walkthrough (reproducible)

Two ways to check EquiCurve end to end:

- **A. In the browser on public devnet**: what a judge or issuer sees, with a real wallet.
- **B. Scripted, on a local validator with the Meteora programs cloned from devnet**: the path the committed evidence ([e2e-devnet-evidence.md](e2e-devnet-evidence.md)) comes from.

> Honesty note: path B is what was actually run for the committed evidence (the public devnet faucet was rate-limited for this machine). Path A uses the same code and program IDs, but has not been recorded end to end on public devnet in this repo.

Nothing here touches mainnet. Keys used by the scripted suite live outside the repo (`E2E_KEYS_DIR`) and are never committed.

## Prerequisites

- Node 20+, `npm install`
- For A: a browser wallet (Phantom, Solflare or Backpack) set to **devnet**, with devnet SOL. Graduating a SOL **Short raise** needs about 3.1 SOL through the curve (threshold 3.090169943 SOL) plus fees, possibly spread over two wallets.
- For B: the Solana CLI (`solana-test-validator`; the evidence run used Agave 4.2.2)

## A. Browser, public devnet

```bash
cp .env.example .env.local        # NEXT_PUBLIC_CLUSTER=devnet; set a dedicated devnet RPC if you have one
npm run dev                       # http://localhost:3000
```

1. **Read the positioning.** Home, `/trust` and `/docs` show the three layers: token launch (on-chain), equity representation (the issuer's legal framework; no shareholder rights are created), RWA verification (off-chain). `/trust` lists the trust assumptions and program IDs.
2. **Pick a preset.** `/presets` shows each preset's threshold in **SOL and USDC**, price multiple, fee schedule, and who each preset suits.
3. **Create** (`/create`, connect your wallet):
   - Basics: name, symbol, description, an https image URL. The field checks type and size and shows a preview.
   - Offering: self-attested checklist (stored locally, not reviewed).
   - Curve: choose **SOL** quote and **Short raise**. The wizard shows the migration threshold, **3.090169943 SOL**.
   - Fees & locks: creator fee % (the actual creator / partner / protocol split is shown), LP lock ≥ 10%.
   - **Review**: every on-chain setting grouped as Token / Curve / Fees / Liquidity / Authorities / Seed buy / Network. It covers the quote mint, token program, supply, decimals, curve points, threshold atoms, fee split, lock %, mint authority, feeClaimer, the exact seed buy in atoms, and the 0.001 SOL pool creation fee. Edit links go back to each step.
   - **Launch**: sign. The receipt lists config, pool, mint and each transaction signature with explorer links. States go from `estimate`/`pending` to `confirmed` once they are read back from chain.
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
