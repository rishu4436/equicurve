"use client";

import { useEffect, useState } from "react";
import type { ImageCheckResult } from "@/lib/metadata/imageCheck";

type Status = { state: "idle" } | { state: "checking" } | { state: "done"; result: ImageCheckResult };

/**
 * Token image URL with a server-side check (https, public host, image type,
 * ≤ 2 MB) and a live preview. The same check runs again when the signed
 * metadata is written, so this is a preview, not the gate.
 */
export function ImageUrlField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    const url = value.trim();
    if (!url) {
      setStatus({ state: "idle" });
      return;
    }
    if (!/^https:\/\//i.test(url)) {
      setStatus({ state: "done", result: { ok: false, code: "not_https", error: "Image URL must use https://." } });
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setStatus({ state: "checking" });
      try {
        const res = await fetch(`/api/image-check?url=${encodeURIComponent(url)}`, { cache: "no-store" });
        const j = (await res.json()) as ImageCheckResult;
        if (!cancelled) setStatus({ state: "done", result: j });
      } catch {
        if (!cancelled)
          setStatus({ state: "done", result: { ok: false, code: "unreachable", error: "Image check failed (network)." } });
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  const ok = status.state === "done" && status.result.ok;
  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="ec-label">Token image URL (optional)</span>
        <input
          className="ec-input font-mono text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="https://… (png, jpeg, gif, webp or avif, max 2 MB)"
          data-testid="image-url"
        />
      </label>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-card border border-line bg-subtle text-[10px] text-fg-muted">
          {ok ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Token image preview" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            "preview"
          )}
        </div>
        <p className="text-xs text-fg-muted">
          {status.state === "idle" && "Shown in wallets and explorers via the hosted metadata JSON."}
          {status.state === "checking" && "Checking image (HEAD request from the server)…"}
          {status.state === "done" &&
            (status.result.ok ? (
              <span className="text-signal-grad">
                OK · {status.result.contentType}
                {status.result.bytes != null ? ` · ${(status.result.bytes / 1024).toFixed(0)} KB` : " · size not reported"}
              </span>
            ) : (
              <span className="text-signal-danger">{status.result.error}</span>
            ))}
        </p>
      </div>
    </div>
  );
}
