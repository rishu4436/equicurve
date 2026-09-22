"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function GraduateIndexPage() {
  const [pool, setPool] = useState("");
  const router = useRouter();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-white">Graduate</h1>
        <p className="mt-1 text-sm text-slate-400">
          Open the DAMM v2 graduation panel for a completed DBC pool.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (pool.trim()) router.push(`/graduate/${pool.trim()}`);
        }}
      >
        <input
          value={pool}
          onChange={(e) => setPool(e.target.value)}
          placeholder="Pool pubkey"
          className="w-full rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 font-mono text-sm outline-none ring-accent/40 focus:ring-2"
        />
        <button
          type="submit"
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950"
        >
          Open graduation panel
        </button>
      </form>
    </div>
  );
}
