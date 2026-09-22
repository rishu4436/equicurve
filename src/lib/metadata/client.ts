import { isPlaceholderMetadataUri } from "@/lib/constants";

export type MetadataDraft = {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  website?: string;
};

/**
 * Prefer app-hosted /api/metadata/[id]. Falls back to a data: URI if the
 * write fails. Custom non-placeholder URIs are returned as-is.
 */
export async function resolveMetadataUri(
  customUri: string,
  draft: MetadataDraft,
): Promise<string> {
  const trimmed = customUri.trim();
  if (trimmed && !isPlaceholderMetadataUri(trimmed)) {
    return trimmed;
  }

  const payload = {
    name: draft.name,
    symbol: draft.symbol,
    description:
      draft.description?.trim() ||
      `${draft.name} (${draft.symbol}) — EquiCurve DBC offering`,
    image: draft.image?.trim() || "",
    external_url: draft.website?.trim() || undefined,
  };

  try {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    if (!origin) throw new Error("no origin");
    const res = await fetch(
      `${origin}/api/metadata/${encodeURIComponent(draft.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);
    return `${origin}/api/metadata/${encodeURIComponent(draft.id)}`;
  } catch {
    return `data:application/json,${encodeURIComponent(JSON.stringify(payload))}`;
  }
}
