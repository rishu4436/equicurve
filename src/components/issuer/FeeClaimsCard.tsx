"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  fetchPoolFeeBreakdown,
  prepareClaimCreatorFees,
  prepareClaimPartnerFees,
  resolvePoolFeeRoles,
  hasClaimableFees,
  type FeeBreakdown,
  type PoolFeeRoles,
} from "@/lib/dbc/claim";
import { toUserMessage } from "@/lib/errors";
import { pushActivity } from "@/lib/local/launches";
import { transactionNotice } from "@/lib/transactionUi";
import { signAndSendTransaction } from "@/lib/send";
import { formatQuoteAtoms } from "@/lib/amounts";

/** Exact atoms → display (string math; no float precision loss). */
function formatQuoteAmount(raw: string, quote: "SOL" | "USDC"): string {
  try {
    return formatQuoteAtoms(raw, quote);
  } catch {
    return raw;
  }
}

function shortPk(pk: string): string {
  return pk.length > 12 ? `${pk.slice(0, 4)}…${pk.slice(-4)}` : pk;
}

type Props = {
  pool: string;
  quote?: "SOL" | "USDC";
};

/**
 * Compact creator vs partner fee claim panel for offering detail.
 * Mirrors Issuer dashboard; disables the wrong-role button with an explanation.
 */
export function FeeClaimsCard({ pool, quote = "SOL" }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [fees, setFees] = useState<FeeBreakdown | null>(null);
  const [roles, setRoles] = useState<PoolFeeRoles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCreator, setBusyCreator] = useState(false);
  const [busyPartner, setBusyPartner] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const pk = new PublicKey(pool);
      const [b, r] = await Promise.all([
        fetchPoolFeeBreakdown(connection, pk),
        resolvePoolFeeRoles(connection, pk),
      ]);
      setFees(b);
      setRoles(r);
    } catch (e) {
      setError(toUserMessage(e));
      setFees(null);
      setRoles(null);
    }
  }, [connection, pool]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const walletPk = wallet.publicKey?.toBase58() ?? null;
  const isCreator = !!(walletPk && roles && roles.creator === walletPk);
  const isPartner = !!(walletPk && roles && roles.feeClaimer === walletPk);
  const creatorClaimable = hasClaimableFees(fees, "creator");
  const partnerClaimable = hasClaimableFees(fees, "partner");

  async function claimCreator() {
    if (!wallet.publicKey) {
      toast.error("Connect the creator wallet to claim.");
      return;
    }
    setBusyCreator(true);
    try {
      const { tx } = await prepareClaimCreatorFees({
        connection,
        creator: wallet.publicKey,
        pool: new PublicKey(pool),
      });
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      pushActivity({
        id: `${sig}-claim-creator`,
        pool,
        kind: "claim",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      const txNotice = transactionNotice(sig, "Creator fee claim confirmed");
      toast.success(txNotice.message, { action: { label: "Explorer", onClick: () => window.open(txNotice.explorerUrl, "_blank", "noopener,noreferrer") } });
      await refresh();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusyCreator(false);
    }
  }

  async function claimPartner() {
    if (!wallet.publicKey) {
      toast.error("Connect the partner feeClaimer wallet to claim.");
      return;
    }
    setBusyPartner(true);
    try {
      const { tx } = await prepareClaimPartnerFees({
        connection,
        feeClaimer: wallet.publicKey,
        pool: new PublicKey(pool),
      });
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      pushActivity({
        id: `${sig}-claim-partner`,
        pool,
        kind: "claim",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      const txNotice = transactionNotice(sig, "Partner fee claim confirmed");
      toast.success(txNotice.message, { action: { label: "Explorer", onClick: () => window.open(txNotice.explorerUrl, "_blank", "noopener,noreferrer") } });
      await refresh();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusyPartner(false);
    }
  }

  const busy = busyCreator || busyPartner;

  return (
    <div className="ec-card space-y-3 p-5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-fg-primary">Trading fee claims</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Creator vs partner (feeClaimer) are separate SDK paths. Quote
            decimals: {quote === "USDC" ? "6 (USDC)" : "9 (SOL)"}.
          </p>
        </div>
        <button
          type="button"
          className="ec-btn-secondary text-xs"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-xs text-signal-warn">{error}</p>}

      {roles && (
        <p className="text-xs text-fg-secondary">
          Creator {shortPk(roles.creator)}
          {" · "}
          Partner feeClaimer {shortPk(roles.feeClaimer)}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-input border border-line bg-subtle px-2 py-2">
          <p className="text-fg-muted">Creator unclaimed</p>
          <p className="font-mono text-fg-primary">
            {fees
              ? formatQuoteAmount(fees.creatorUnclaimedQuote, quote)
              : "—"}
          </p>
        </div>
        <div className="rounded-input border border-accent/25 bg-accent/5 px-2 py-2">
          <p className="text-fg-muted">Partner unclaimed</p>
          <p className="font-mono text-fg-primary">
            {fees
              ? formatQuoteAmount(fees.partnerUnclaimedQuote, quote)
              : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="ec-btn-primary"
          disabled={busy || !wallet.publicKey || !isCreator || !creatorClaimable}
          onClick={() => void claimCreator()}
        >
          {busyCreator ? "Claiming…" : creatorClaimable ? "Claim creator fees" : "No creator fees to claim"}
        </button>
        {!isCreator && wallet.publicKey && roles && (
          <p className="text-xs text-fg-muted">
            Creator claim disabled — connect as {shortPk(roles.creator)}.
          </p>
        )}
        <button
          type="button"
          className="ec-btn-primary"
          disabled={busy || !wallet.publicKey || !isPartner || !partnerClaimable}
          onClick={() => void claimPartner()}
        >
          {busyPartner ? "Claiming…" : partnerClaimable ? "Claim partner fees" : "No partner fees to claim"}
        </button>
        {!isPartner && wallet.publicKey && roles && (
          <p className="text-xs text-fg-muted">
            Partner claim disabled — connect as feeClaimer{" "}
            {shortPk(roles.feeClaimer)}. Deployer does not get partner share
            unless they are also feeClaimer.
          </p>
        )}
        {!wallet.publicKey && (
          <p className="text-xs text-fg-muted">
            Connect the creator or feeClaimer wallet to claim.
          </p>
        )}
      </div>

      <Link href="/issuer" className="text-xs text-accent hover:underline">
        Open issuer dashboard →
      </Link>
    </div>
  );
}
