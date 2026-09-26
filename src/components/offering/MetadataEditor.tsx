"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageUrlField } from "@/components/create/ImageUrlField";
import { signLaunchPayload, type LaunchAuthPayload } from "@/lib/auth/launchAuth";
import { getCluster } from "@/lib/constants";
import { toUserMessage } from "@/lib/errors";
import type { TokenMetadataJson } from "@/lib/metadata/store";

/**
 * Creator-only editor for the hosted metadata JSON. Name, symbol and mint are
 * immutable after launch (shown read-only); description, image and website
 * are updated with a wallet-signed `action: "update"` payload that the server
 * verifies against the on-chain creator / stored owner.
 */
export function MetadataEditor({ pool, mint, creator }: { pool: string; mint: string; creator: string | null }) {
  const wallet = useWallet();
  const [meta, setMeta] = useState<TokenMetadataJson | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);

  const isCreator = !!wallet.publicKey && !!creator && wallet.publicKey.toBase58() === creator;

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/metadata/${mint}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "No hosted metadata for this mint (custom or inline URI)." : `HTTP ${r.status}`);
        return (await r.json()) as TokenMetadataJson;
      })
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
        setDescription(m.description ?? "");
        setImage(m.image ?? "");
        setWebsite(m.external_url ?? "");
      })
      .catch((e) => !cancelled && setLoadErr(e instanceof Error ? e.message : "load failed"));
    return () => {
      cancelled = true;
    };
  }, [mint]);

  if (!isCreator) return null;

  async function save() {
    if (!meta || !wallet.publicKey || !wallet.signMessage) {
      toast.error("Your wallet must support message signing to update metadata.");
      return;
    }
    setBusy(true);
    try {
      const payload: LaunchAuthPayload = {
        v: 1,
        action: "update",
        cluster: getCluster(),
        pool,
        mint,
        metadata: {
          name: meta.name,
          symbol: meta.symbol,
          description: description.trim(),
          image: image.trim(),
          ...(website.trim() ? { external_url: website.trim() } : {}),
        },
      };
      const signed = await signLaunchPayload({ payload, signer: wallet.publicKey.toBase58(), signMessage: wallet.signMessage });
      const res = await fetch(`/api/metadata/${mint}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signed),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; unchanged?: boolean };
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      toast.success(j.unchanged ? "No changes." : "Metadata updated (signed).");
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-card border border-line p-4" data-testid="metadata-editor">
      <p className="text-sm font-semibold text-fg-primary">Edit token metadata (creator)</p>
      {loadErr && <p className="text-xs text-fg-muted">{loadErr}</p>}
      {meta && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-fg-muted">Name (fixed)</dt>
              <dd className="text-fg-primary">{meta.name}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Symbol (fixed)</dt>
              <dd className="font-mono text-fg-primary">{meta.symbol}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Mint (fixed)</dt>
              <dd className="truncate font-mono text-fg-primary">{mint}</dd>
            </div>
          </dl>
          <label className="block space-y-1.5">
            <span className="ec-label">Description</span>
            <textarea className="ec-input min-h-[64px]" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <ImageUrlField value={image} onChange={setImage} />
          <label className="block space-y-1.5">
            <span className="ec-label">Website</span>
            <input className="ec-input" value={website} onChange={(e) => setWebsite(e.target.value.trim())} placeholder="https://" />
          </label>
          <button type="button" className="ec-btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Signing…" : "Sign & save metadata"}
          </button>
          <p className="text-[10px] text-fg-muted">
            Free message signature, no transaction. Wallets and explorers may cache the old JSON for a while.
          </p>
        </>
      )}
    </div>
  );
}
