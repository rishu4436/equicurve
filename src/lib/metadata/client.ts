import type { SignedLaunchBody } from "@/lib/auth/launchAuth";
import { isPlaceholderMetadataUri } from "@/lib/constants";

export type MetadataUriResult = {
  uri: string;
  source: "custom" | "hosted" | "data-uri";
  note?: string;
};

function dataUri(meta: NonNullable<SignedLaunchBody["payload"]["metadata"]> | {
  name: string;
  symbol: string;
  description: string;
  image: string;
}): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify(meta))}`;
}

/**
 * Custom https override → used as-is. Otherwise, with a creator-signed launch
 * payload, write app-hosted JSON at /api/metadata/<mint>. Without a signature
 * (wallet can't signMessage / user declined) or on write failure, fall back
 * to an inline data: URI.
 */
export async function resolveMetadataUri(args: {
  customUri: string;
  signed: SignedLaunchBody | null;
  fallback: { name: string; symbol: string; description: string; image?: string };
}): Promise<MetadataUriResult> {
  const trimmed = args.customUri.trim();
  if (trimmed && !isPlaceholderMetadataUri(trimmed)) {
    return { uri: trimmed, source: "custom" };
  }
  const meta = args.signed?.payload.metadata;
  const inline = dataUri(meta ?? { ...args.fallback, image: args.fallback.image ?? "" });
  if (!args.signed || !meta) {
    return { uri: inline, source: "data-uri", note: "No wallet signature — using inline data: URI metadata." };
  }
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!origin) throw new Error("no origin");
    const id = encodeURIComponent(args.signed.payload.mint);
    const res = await fetch(`${origin}/api/metadata/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.signed),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error || `metadata HTTP ${res.status}`);
    }
    return { uri: `${origin}/api/metadata/${id}`, source: "hosted" };
  } catch (e) {
    return {
      uri: inline,
      source: "data-uri",
      note: `Hosted metadata write failed (${e instanceof Error ? e.message : "error"}) — using inline data: URI.`,
    };
  }
}
