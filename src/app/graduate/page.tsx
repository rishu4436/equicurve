"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

export default function GraduateIndexPage() {
  const [pool, setPool] = useState("");
  const router = useRouter();

  return (
    <div className="mx-auto max-w-xl space-y-8 py-6 sm:py-12">
      <div>
        <p className="ec-eyebrow mb-3">The next chapter</p>
        <h1 className="ec-page-title">From curve to market.</h1>
        <p className="mt-3 text-sm text-fg-secondary">
          Open the DAMM v2 graduation panel for a completed DBC pool.
        </p>
      </div>
      <form
        className="ec-card space-y-4 p-6 sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (pool.trim()) router.push(`/graduate/${pool.trim()}`);
        }}
      >
        <label htmlFor="graduate-pool" className="ec-label block">Pool address</label>
        <input
          id="graduate-pool"
          value={pool}
          onChange={(e) => setPool(e.target.value)}
          placeholder="Paste a Solana pool address"
          className="ec-input font-mono"
        />
        <button
          type="submit"
          className="ec-btn-primary w-full"
        >
          Open graduation panel
        </button>
        <p className="text-center text-xs text-fg-muted"><Link href="/docs#graduate" className="text-accent hover:underline">Understand graduation →</Link></p>
      </form>
    </div>
  );
}
