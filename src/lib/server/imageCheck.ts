import { lookup } from "node:dns/promises";
import { checkImageUrl, type ImageCheckResult } from "@/lib/metadata/imageCheck";

/** Server-side image check with DNS-rebinding guard (Node only). */
export function serverCheckImage(url: string): Promise<ImageCheckResult> {
  return checkImageUrl(url, {
    resolveHost: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  });
}
