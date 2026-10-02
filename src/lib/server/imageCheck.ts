import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import {
  checkImageUrl,
  isPrivateHost,
  type ImageCheckResult,
  type PinnedFetchArgs,
} from "@/lib/metadata/imageCheck";

/**
 * Resolves the image host once. If every address is public, the TLS socket
 * connects to the first of those addresses. The URL hostname is only the Host
 * header and the TLS server name, so a later DNS answer cannot move the
 * connection onto a private address.
 */
export function serverCheckImage(url: string): Promise<ImageCheckResult> {
  return checkImageUrl(url, {
    resolveHost: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
    fetchPinned: pinnedImageFetch,
  });
}

export type PinnedRequestOptions = https.RequestOptions & { autoSelectFamily: false };

/** Socket options for one already-validated address. */
export function pinnedRequestOptions(
  target: URL,
  address: string,
  method: "HEAD" | "GET",
  headers: Record<string, string>,
): PinnedRequestOptions {
  const family = address.includes(":") ? 6 : 4;
  const servername = isIP(target.hostname) ? undefined : target.hostname;
  return {
    method,
    host: address,
    port: target.port ? Number(target.port) : 443,
    path: `${target.pathname}${target.search}`,
    servername,
    family,
    setHost: false,
    autoSelectFamily: false,
    headers: { ...headers, host: target.host },
    lookup: (_hostname, _options, callback) => {
      callback(null, address, family);
    },
  };
}

/** HTTPS request to `addresses[0]`. Refuses a private or empty answer before connecting. */
export function pinnedImageFetch(args: PinnedFetchArgs): Promise<Response> {
  const address = args.addresses[0];
  if (!address || args.addresses.some((ip) => isPrivateHost(ip))) {
    return Promise.reject(Object.assign(new Error("Refusing a private image address."), { name: "PrivateAddress" }));
  }
  const target = new URL(args.url);
  const options = pinnedRequestOptions(target, address, args.method, args.headers);
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, signal: args.signal }, (incoming) => {
      incoming.resume();
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(key, item);
        else if (value != null) headers.set(key, value);
      }
      resolve(new Response(null, { status: incoming.statusCode ?? 0, headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
