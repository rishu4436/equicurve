import { getCluster } from "@/lib/constants";
import { getRegistryLaunch } from "@/lib/registry/store";
import { isRegistryVerified } from "@/lib/registry/normalize";
import { getScheduledLaunchStore } from "@/lib/schedule/store";
import { walletSchema, isValidPublicKey } from "@/lib/validation";
import type { CommunityMarket } from "./types";

export type MarketResolveResult =
  | { ok: true; market: CommunityMarket }
  | { ok: false; status: 404 | 503; code: string; error: string };

/**
 * Resolve the stable identity and canonical creator used by community writes.
 * Live markets require a server-verified registry row. Upcoming markets use
 * the durable schedule id until a pool exists on-chain.
 */
export async function resolveCommunityMarket(marketId: string): Promise<MarketResolveResult> {
  const cluster = getCluster();
  if (isValidPublicKey(marketId)) {
    const row = await getRegistryLaunch(marketId);
    if (!row || row.cluster !== cluster || !isRegistryVerified(row) || !walletSchema.safeParse(row.creator).success) {
      return { ok: false, status: 404, code: "market_not_verified", error: "This live market is not available for creator updates until its canonical creator is verified." };
    }
    return { ok: true, market: { id: row.pool, kind: "live", creatorWallet: row.creator, cluster: row.cluster } };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(marketId)) {
    try {
      const schedule = await getScheduledLaunchStore().get(marketId);
      if (!schedule || schedule.cluster !== cluster || !walletSchema.safeParse(schedule.creatorWallet).success || ["cancelled", "launched", "invalidated"].includes(schedule.status)) {
        return { ok: false, status: 404, code: "schedule_not_found", error: "Upcoming market not found or no longer active." };
      }
      return { ok: true, market: { id: schedule.id, kind: "scheduled", creatorWallet: schedule.creatorWallet, cluster: schedule.cluster } };
    } catch {
      return { ok: false, status: 503, code: "market_storage_unavailable", error: "Upcoming market storage is unavailable." };
    }
  }
  return { ok: false, status: 404, code: "invalid_market", error: "Market identity is invalid." };
}
