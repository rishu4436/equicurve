/**
 * Server-side image URL check for token metadata (https only, image content
 * type, bounded size). Uses HEAD, falling back to a 1-byte ranged GET when
 * HEAD is not allowed. Guards against SSRF: only public hostnames, no
 * IP literals in private ranges, no credentials, manual redirects (max 3),
 * short timeout.
 */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const;

export type ImageCheckResult =
  | { ok: true; contentType: string; bytes: number | null; finalUrl: string }
  | { ok: false; code: "not_https" | "private_host" | "bad_status" | "bad_type" | "too_large" | "unreachable" | "invalid_url"; error: string };

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (h.includes(":")) {
    // IPv6 literal: block loopback / link-local / unique-local / mapped.
    return /^(fe80|fc|fd|::ffff:)/.test(h);
  }
  return false;
}

/** Static URL checks (no network). */
export function precheckImageUrl(raw: string): ImageCheckResult | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, code: "invalid_url", error: "Image must be a valid URL." };
  }
  if (u.protocol !== "https:") return { ok: false, code: "not_https", error: "Image URL must use https://." };
  if (u.username || u.password) return { ok: false, code: "invalid_url", error: "Image URL must not contain credentials." };
  if (isPrivateHost(u.hostname)) return { ok: false, code: "private_host", error: "Image host must be public." };
  return null;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function checkImageUrl(
  raw: string,
  opts: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    maxRedirects?: number;
    /** Resolve a hostname to IPs (DNS-rebinding guard); omitted in tests. */
    resolveHost?: (hostname: string) => Promise<string[]>;
  } = {},
): Promise<ImageCheckResult> {
  const pre = precheckImageUrl(raw);
  if (pre) return pre;
  const hostOk = async (u: string): Promise<ImageCheckResult | null> => {
    if (!opts.resolveHost) return null;
    try {
      const ips = await opts.resolveHost(new URL(u).hostname);
      if (ips.some(isPrivateHost)) return { ok: false, code: "private_host", error: "Image host resolves to a private address." };
      return null;
    } catch {
      return { ok: false, code: "unreachable", error: "Image host could not be resolved." };
    }
  };
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const maxRedirects = opts.maxRedirects ?? 3;

  const once = async (url: string, method: "HEAD" | "GET"): Promise<Response> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await f(url, {
        method,
        redirect: "manual",
        signal: ctl.signal,
        headers: method === "GET" ? { Range: "bytes=0-0" } : {},
      });
    } finally {
      clearTimeout(t);
    }
  };

  let url = raw;
  let res: Response | null = null;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const denied = await hostOk(url);
      if (denied) return denied;
      res = await once(url, "HEAD");
      if (res.status === 405 || res.status === 501 || res.status === 403) res = await once(url, "GET");
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        const next = new URL(loc, url).toString();
        const bad = precheckImageUrl(next);
        if (bad) return bad;
        url = next;
        res = null;
        continue;
      }
      break;
    }
  } catch (e) {
    return { ok: false, code: "unreachable", error: `Image URL could not be fetched (${e instanceof Error ? e.name : "error"}).` };
  }
  if (!res) return { ok: false, code: "unreachable", error: "Too many redirects." };
  if (!(res.status === 200 || res.status === 206)) {
    return { ok: false, code: "bad_status", error: `Image URL returned HTTP ${res.status}.` };
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, code: "bad_type", error: `Image must be ${IMAGE_TYPES.join(", ")} (got "${type || "unknown"}").` };
  }
  let bytes: number | null = null;
  const range = res.headers.get("content-range");
  const m = range ? /\/(\d+)$/.exec(range) : null;
  if (m) bytes = Number(m[1]);
  else if (res.status === 200 && res.headers.get("content-length")) bytes = Number(res.headers.get("content-length"));
  if (bytes != null && Number.isFinite(bytes) && bytes > IMAGE_MAX_BYTES) {
    return { ok: false, code: "too_large", error: `Image is ${(bytes / 1024 / 1024).toFixed(1)} MB; max 2 MB.` };
  }
  return { ok: true, contentType: type, bytes: bytes != null && Number.isFinite(bytes) ? bytes : null, finalUrl: url };
}
