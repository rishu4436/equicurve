/**
 * Hosted metadata edit policy.
 *
 * Identity is fixed at launch: the metadata id IS the mint, and `name` /
 * `symbol` match what the DBC create instruction wrote on-chain, so they can
 * never change afterwards (a renamed token would mislead holders).
 * The creator may still update presentation fields with a wallet-signed
 * `action: "update"` payload: description, image, external_url.
 */
import type { TokenMetadataJson } from "./store";

export const IMMUTABLE_METADATA_FIELDS = ["name", "symbol"] as const;
export const EDITABLE_METADATA_FIELDS = ["description", "image", "external_url"] as const;

export type PolicyResult = { ok: true } | { ok: false; code: string; error: string };

export function checkMetadataEdit(args: {
  action: "launch" | "update";
  existing: TokenMetadataJson | null;
  existingPool: string | null;
  next: TokenMetadataJson;
  pool: string;
}): PolicyResult {
  const { action, existing, next } = args;
  if (!existing) {
    if (action === "update") {
      return { ok: false, code: "no_record", error: "Nothing to update: no hosted metadata exists for this mint yet." };
    }
    return { ok: true };
  }
  for (const f of IMMUTABLE_METADATA_FIELDS) {
    if (existing[f] !== next[f]) {
      return {
        ok: false,
        code: "identity_immutable",
        error: `"${f}" is fixed at launch and cannot be changed (only ${EDITABLE_METADATA_FIELDS.join(", ")} are editable).`,
      };
    }
  }
  if (args.existingPool && args.existingPool !== args.pool) {
    return { ok: false, code: "pool_immutable", error: "Metadata is bound to its launch pool; payload.pool cannot change." };
  }
  // Identity unchanged: a "launch" payload replayed with the same identity is
  // treated like an update of the editable fields.
  return { ok: true };
}
