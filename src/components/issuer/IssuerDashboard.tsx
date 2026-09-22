"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM,
  explorerAddressUrl,
  explorerTxUrl,
} from "@/lib/constants";
import {
  fetchPoolFeeBreakdown,
  prepareClaimCreatorFees,
  prepareClaimPartnerFees,
  resolvePoolFeeRoles,
  type FeeBreakdown,
  type PoolFeeRoles,
} from "@/lib/dbc/claim";
import { toUserMessage } from "@/lib/errors";
import {
  launchesForCreatorOrPartner,
  listLaunches,
  pushActivity,
  type StoredLaunch,
} from "@/lib/local/launches";
import { signAndSendTransaction } from "@/lib/send";

function formatQuoteAmount(raw: string, quote: "SOL" | "USDC" = "SOL"): string {
  try {
    const decimals = quote === "USDC" ? 6 : 9;
    const n = Number(raw) / 10 ** decimals;
    if (!Number.isFinite(n)) return raw;
    return `${n.toFixed(quote === "USDC" ? 4 : 6)} ${quote}`;
  } catch {
    return raw;
  }
}

function shortPk(pk: string, n = 4): string {
  return pk.length > 12 ? `${pk.slice(0, n)}…${pk.slice(-n)}` : pk;
}

export function IssuerDashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [launches, setLaunches] = useState<StoredLaunch[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [fees, setFees] = useState<FeeBreakdown | null>(null);
  const [roles, setRoles] = useState<PoolFeeRoles | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [busyCreator, setBusyCreator] = useState(false);
  const [busyPartner, setBusyPartner] = useState(false);

  useEffect(() => {
    const all = listLaunches();
    if (wallet.publicKey) {
      setLaunches(launchesForCreatorOrPartner(wallet.publicKey.toBase58()));
    } else {
      setLaunches(all);
    }
  }, [wallet.publicKey]);

  useEffect(() => {
    if (launches.length && !selected) {
      setSelected(launches[0].pool);
      return;
    }
    if (
      selected &&
      launches.length > 0 &&
      !launches.some((l) => l.pool === selected)
    ) {
      setSelected(launches[0].pool);
    }
  }, [launches, selected]);

  const refreshFees = useCallback(async () => {
    if (!selected) {
      setFees(null);
      setRoles(null);
      return;
    }
    try {
      setFeeError(null);
      const pool = new PublicKey(selected);
      const [breakdown, poolRoles] = await Promise.all([
        fetchPoolFeeBreakdown(connection, pool),
        resolvePoolFeeRoles(connection, pool),
      ]);
      setFees(breakdown);
      setRoles(poolRoles);
    } catch (e) {
      setFeeError(toUserMessage(e));
      setFees(null);
      setRoles(null);
    }
  }, [connection, selected]);

  useEffect(() => {
    void refreshFees();
  }, [refreshFees]);

  const current = launches.find((l) => l.pool === selected);
  const quoteLabel: "SOL" | "USDC" =
    current?.quote === "USDC" ? "USDC" : "SOL";

  const walletPk = wallet.publicKey?.toBase58() ?? null;
  const isCreator = !!(walletPk && roles && roles.creator === walletPk);
  const isPartner = !!(walletPk && roles && roles.feeClaimer === walletPk);
  const sameWallet = !!(roles && roles.creator === roles.feeClaimer);

  const roleHint = useMemo(() => {
    if (!walletPk) {
      return "Connect a wallet to claim. Creator and partner feeClaimer are separate on-chain roles.";
    }
    if (!roles) return null;
    if (isCreator && isPartner) {
      return "This wallet is both creator and partner feeClaimer — you can claim either share.";
    }
    if (isCreator) {
      return `Connected as creator. Partner fees go to ${shortPk(roles.feeClaimer)}.`;
    }
    if (isPartner) {
      return `Connected as partner feeClaimer. Creator fees go to ${shortPk(roles.creator)}.`;
    }
    return `Connected wallet is neither creator (${shortPk(roles.creator)}) nor partner feeClaimer (${shortPk(roles.feeClaimer)}).`;
  }, [walletPk, roles, isCreator, isPartner]);

  async function onClaimCreator() {
    if (!wallet.publicKey) {
      toast.error("Connect the creator (deployer) wallet to claim creator fees.");
      return;
    }
    if (!selected) return;
    setBusyCreator(true);
    try {
      const { tx } = await prepareClaimCreatorFees({
        connection,
        creator: wallet.publicKey,
        pool: new PublicKey(selected),
      });
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      pushActivity({
        id: `${sig}-claim-creator`,
        pool: selected,
        kind: "claim",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success("Creator claim submitted — " + sig.slice(0, 8));
      window.open(explorerTxUrl(sig), "_blank");
      await refreshFees();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusyCreator(false);
    }
  }

  async function onClaimPartner() {
    if (!wallet.publicKey) {
      toast.error(
        "Connect the partner feeClaimer wallet to claim partner fees.",
      );
      return;
    }
    if (!selected) return;
    setBusyPartner(true);
    try {
      const { tx } = await prepareClaimPartnerFees({
        connection,
        feeClaimer: wallet.publicKey,
        pool: new PublicKey(selected),
      });
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      pushActivity({
        id: `${sig}-claim-partner`,
        pool: selected,
        kind: "claim",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success("Partner claim submitted — " + sig.slice(0, 8));
      window.open(explorerTxUrl(sig), "_blank");
      await refreshFees();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusyPartner(false);
    }
  }

  const busy = busyCreator || busyPartner;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-fg-primary">
          Issuer dashboard
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Trading fees split on-chain between{" "}
          <strong className="text-fg-primary">creator</strong> (
          <code className="text-accent-soft">claimCreatorTradingFee</code>) and{" "}
          <strong className="text-fg-primary">partner</strong> (
          <code className="text-accent-soft">claimPartnerTradingFee</code>
          ). Partner share accrues only to the config{" "}
          <code className="text-accent-soft">feeClaimer</code> set at Create —
          the deployer does not automatically receive it. Amounts use the pool
          quote mint decimals (SOL=9, USDC=6).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            k: "Creator unclaimed",
            v: fees
              ? formatQuoteAmount(fees.creatorUnclaimedQuote, quoteLabel)
              : "—",
          },
          {
            k: "Partner unclaimed",
            v: fees
              ? formatQuoteAmount(fees.partnerUnclaimedQuote, quoteLabel)
              : "—",
          },
          {
            k: "Creator claimed",
            v: fees
              ? formatQuoteAmount(fees.creatorClaimedQuote, quoteLabel)
              : "—",
          },
          {
            k: "Relevant launches",
            v: String(launches.length),
          },
        ].map((x) => (
          <div key={x.k} className="ec-card p-4">
            <p className="text-xs text-fg-muted">{x.k}</p>
            <p className="mt-1 font-mono text-lg text-fg-primary">{x.v}</p>
          </div>
        ))}
      </div>

      {launches.length === 0 ? (
        <div className="ec-card flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-fg-secondary">
            No local launches for this wallet as creator or partner feeClaimer.
            Create an offering (optionally set a partner feeClaimer) to populate
            this dashboard.
          </p>
          <Link href="/create" className="ec-btn-primary">
            Create offering
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="ec-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg-primary">
              Your launches
            </h2>
            <ul className="space-y-2">
              {launches.map((l) => {
                const asCreator = !!(
                  walletPk &&
                  l.creator.toLowerCase() === walletPk.toLowerCase()
                );
                const asPartner = !!(
                  walletPk &&
                  (l.feeClaimer ?? l.creator).toLowerCase() ===
                    walletPk.toLowerCase()
                );
                return (
                  <li key={l.pool}>
                    <button
                      type="button"
                      onClick={() => setSelected(l.pool)}
                      className={
                        selected === l.pool
                          ? "w-full rounded-input border border-accent/40 bg-accent/10 px-3 py-2 text-left text-sm"
                          : "w-full rounded-input border border-line bg-subtle px-3 py-2 text-left text-sm hover:border-accent/30"
                      }
                    >
                      <span className="font-medium text-fg-primary">
                        ${l.ticker}
                      </span>{" "}
                      <span className="text-fg-muted">{l.name}</span>
                      <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
                        {asCreator && (
                          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">
                            creator
                          </span>
                        )}
                        {asPartner && (
                          <span className="rounded bg-signal-ok/15 px-1.5 py-0.5 text-signal-ok">
                            partner
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-fg-muted">
                        {l.pool.slice(0, 12)}…
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-4">
            <div className="ec-card space-y-3 p-5">
              <h2 className="font-semibold text-fg-primary">
                Fee claims — {current ? `$${current.ticker}` : "select pool"}
              </h2>
              {roleHint && (
                <p className="rounded-input border border-line bg-subtle px-3 py-2 text-xs text-fg-secondary">
                  {roleHint}
                </p>
              )}
              {feeError && (
                <p className="text-xs text-signal-warn">{feeError}</p>
              )}
              {roles && (
                <dl className="grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
                  <div>
                    <dt className="text-fg-muted">On-chain creator</dt>
                    <dd>
                      <a
                        href={explorerAddressUrl(roles.creator)}
                        className="font-mono text-accent hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortPk(roles.creator, 6)}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Partner feeClaimer</dt>
                    <dd>
                      <a
                        href={explorerAddressUrl(roles.feeClaimer)}
                        className="font-mono text-accent hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortPk(roles.feeClaimer, 6)}
                      </a>
                      {sameWallet && (
                        <span className="ml-1 text-fg-muted">
                          (same as creator)
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              )}

              <div className="space-y-2 rounded-input border border-line bg-subtle/60 p-3">
                <p className="text-xs font-semibold text-fg-primary">
                  Creator share
                </p>
                {fees ? (
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-fg-muted">
                        Unclaimed quote ({quoteLabel})
                      </dt>
                      <dd className="font-mono text-fg-primary">
                        {formatQuoteAmount(
                          fees.creatorUnclaimedQuote,
                          quoteLabel,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Unclaimed base</dt>
                      <dd className="font-mono text-fg-primary">
                        {fees.creatorUnclaimedBase}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Total quote</dt>
                      <dd className="font-mono text-fg-primary">
                        {formatQuoteAmount(fees.creatorTotalQuote, quoteLabel)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">LP lock policy</dt>
                      <dd className="text-fg-primary">
                        ≥{current?.lockPct ?? 10}%
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-xs text-fg-muted">
                    {feeError
                      ? "Could not load creator fees."
                      : "No fee data yet — refresh after trades."}
                  </p>
                )}
                <button
                  type="button"
                  disabled={
                    busy || !wallet.publicKey || !selected || !isCreator
                  }
                  onClick={() => void onClaimCreator()}
                  className="ec-btn-primary"
                  title={
                    !wallet.publicKey
                      ? "Connect wallet"
                      : !isCreator
                        ? "Only the on-chain creator can claim this share"
                        : undefined
                  }
                >
                  {busyCreator ? "Claiming…" : "Claim creator fees"}
                </button>
                {!isCreator && wallet.publicKey && roles && (
                  <p className="text-[11px] text-fg-muted">
                    Disabled — connect as {shortPk(roles.creator)} (creator) to
                    claim this share.
                  </p>
                )}
              </div>

              <div className="space-y-2 rounded-input border border-accent/25 bg-accent/5 p-3">
                <p className="text-xs font-semibold text-fg-primary">
                  Partner share{" "}
                  <span className="font-normal text-fg-muted">
                    (feeClaimer)
                  </span>
                </p>
                {fees ? (
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-fg-muted">
                        Unclaimed quote ({quoteLabel})
                      </dt>
                      <dd className="font-mono text-fg-primary">
                        {formatQuoteAmount(
                          fees.partnerUnclaimedQuote,
                          quoteLabel,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Unclaimed base</dt>
                      <dd className="font-mono text-fg-primary">
                        {fees.partnerUnclaimedBase}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Total quote</dt>
                      <dd className="font-mono text-fg-primary">
                        {formatQuoteAmount(fees.partnerTotalQuote, quoteLabel)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Claimed quote</dt>
                      <dd className="font-mono text-fg-primary">
                        {formatQuoteAmount(
                          fees.partnerClaimedQuote,
                          quoteLabel,
                        )}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-xs text-fg-muted">
                    {feeError
                      ? "Could not load partner fees."
                      : "No fee data yet — partner share accrues as the pool trades."}
                  </p>
                )}
                <button
                  type="button"
                  disabled={
                    busy || !wallet.publicKey || !selected || !isPartner
                  }
                  onClick={() => void onClaimPartner()}
                  className="ec-btn-primary"
                  title={
                    !wallet.publicKey
                      ? "Connect wallet"
                      : !isPartner
                        ? "Only the on-chain feeClaimer can claim partner fees"
                        : undefined
                  }
                >
                  {busyPartner ? "Claiming…" : "Claim partner fees"}
                </button>
                {!isPartner && wallet.publicKey && roles && (
                  <p className="text-[11px] text-fg-muted">
                    Disabled — connect as {shortPk(roles.feeClaimer)}{" "}
                    (feeClaimer) to claim the partner share. Create-time
                    feeClaimer is authoritative on-chain.
                  </p>
                )}
                {isPartner && !isCreator && (
                  <p className="text-[11px] text-fg-muted">
                    You are the partner feeClaimer for this pool — creator fees
                    require the deployer wallet.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="ec-btn-secondary"
                  onClick={() => void refreshFees()}
                >
                  Refresh
                </button>
                {selected && (
                  <Link href={`/o/${selected}`} className="ec-btn-secondary">
                    View offering
                  </Link>
                )}
              </div>
            </div>

            <div className="ec-card space-y-2 p-5 text-xs text-fg-secondary">
              <p className="font-medium text-fg-primary">Program IDs</p>
              <p>
                DBC:{" "}
                <a
                  href={explorerAddressUrl(DBC_PROGRAM_ID.toBase58())}
                  className="font-mono text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {DBC_PROGRAM_ID.toBase58()}
                </a>
              </p>
              <p>
                DAMM v2:{" "}
                <a
                  href={explorerAddressUrl(DAMM_V2_PROGRAM.toBase58())}
                  className="font-mono text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {DAMM_V2_PROGRAM.toBase58()}
                </a>
              </p>
              <p className="text-fg-muted">
                Partner path uses real SDK{" "}
                <code className="text-accent-soft">claimPartnerTradingFee</code>{" "}
                /{" "}
                <code className="text-accent-soft">
                  claimPartnerTradingFee2
                </code>{" "}
                (transfer-hook pools). Devnet-ready — no mainnet funds required
                to exercise the flow.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
