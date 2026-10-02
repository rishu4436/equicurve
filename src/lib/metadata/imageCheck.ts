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

function ipv4Private(a: number, b: number): boolean {
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function octetChoices(part: string): number[] {
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const n = Number.parseInt(part, 16);
    return n >= 0 && n <= 255 ? [n] : [];
  }
  if (!/^\d+$/.test(part)) return [];
  const choices: number[] = [];
  const decimal = Number(part);
  if (decimal >= 0 && decimal <= 255) choices.push(decimal);
  if (/^0[0-7]+$/.test(part)) {
    const octal = Number.parseInt(part, 8);
    if (octal !== decimal && octal >= 0 && octal <= 255) choices.push(octal);
  }
  return choices;
}

function dottedAddressPrivate(host: string): boolean | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const choices = parts.map(octetChoices);
  if (choices.some((choice) => choice.length === 0)) return null;
  let combos: number[][] = [[]];
  for (const choice of choices) {
    const next: number[][] = [];
    for (const prefix of combos) for (const n of choice) next.push([...prefix, n]);
    combos = next;
  }
  return combos.some(([a, b]) => ipv4Private(a ?? -1, b ?? -1));
}

function dwordPrivate(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return false;
  return ipv4Private((value >>> 24) & 255, (value >>> 16) & 255);
}

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "::" || h === "::1" || h === "0:0:0:0:0:0:0:0" || h === "0:0:0:0:0:0:0:1") return true;
  const dotted = dottedAddressPrivate(h);
  if (dotted != null) return dotted;
  if (/^\d+$/.test(h)) return dwordPrivate(Number(h));
  if (/^0x[0-9a-f]+$/i.test(h)) return dwordPrivate(Number.parseInt(h, 16));
  if (/^0[0-7]+$/.test(h)) return dwordPrivate(Number.parseInt(h, 8));
  if (h.includes(":")) {
    // Loopback, link-local, unique-local, and every IPv4-mapped form.
    return /^(fe80|fc|fd|::ffff:)/.test(h) || /^(?:0:){4,5}ffff:/i.test(h);
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
