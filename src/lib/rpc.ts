/**
 * RPC resilience helpers: bounded retry with exponential backoff for READS,
 * per-call timeout, transient-error classification, and a concurrency limiter.
 *
 * Never wrap transaction *sends* in withRpcRetry — resending a signed tx is
 * handled by sendRawTransaction's own maxRetries + blockhash expiry.
 */

export class RpcTimeoutError extends Error {
  constructor(ms: number) {
    super(`RPC request timed out after ${ms}ms`);
    this.name = "RpcTimeoutError";
  }
}

const TRANSIENT_RE =
  /\b(429|502|503|504)\b|too many requests|rate.?limit|bad gateway|service unavailable|gateway timeout|timed out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|failed to fetch|network ?error|NetworkError/i;

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/** True for rate limits, 5xx, timeouts and network failures. */
export function isTransientRpcError(e: unknown): boolean {
  if (e instanceof RpcTimeoutError) return true;
  return TRANSIENT_RE.test(errorMessage(e));
}

export function isRateLimitError(e: unknown): boolean {
  return /\b429\b|too many requests|rate.?limit/i.test(errorMessage(e));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        t = setTimeout(() => rej(new RpcTimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export type RetryOptions = {
  /** Extra attempts after the first (default 2 → 3 total). */
  retries?: number;
  /** First backoff in ms (default 250; doubles each retry, +jitter). */
  baseDelayMs?: number;
  /** Per-attempt timeout (default 10s). 0 disables. */
  timeoutMs?: number;
  /** Override which errors are retried. */
  shouldRetry?: (e: unknown) => boolean;
  /** Injected for tests. */
  sleepFn?: (ms: number) => Promise<void>;
};

/** Retry a read-only RPC call on transient failures with backoff. */
export async function withRpcRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const base = opts.baseDelayMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const shouldRetry = opts.shouldRetry ?? isTransientRpcError;
  const doSleep = opts.sleepFn ?? sleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const p = fn();
      return timeoutMs > 0 ? await withTimeout(p, timeoutMs) : await p;
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !shouldRetry(e)) throw e;
      await doSleep(base * 2 ** attempt);
    }
  }
  throw lastErr;
}

/**
 * Try explicitly configured same-cluster sources for a read. Each source gets
 * the bounded retry policy above; non-transient failures stop immediately.
 */
export async function withRpcFallback<S, T>(
  sources: readonly S[],
  read: (source: S) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  if (sources.length === 0) throw new Error("No RPC endpoints are configured.");
  let lastError: unknown;
  for (let index = 0; index < sources.length; index++) {
    try {
      return await withRpcRetry(() => read(sources[index]!), opts);
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error) || index === sources.length - 1) throw error;
    }
  }
  throw lastError;
}

export type RpcIdentitySource = {
  rpcEndpoint: string;
  getGenesisHash(): Promise<string>;
};

const verifiedClusterEndpoints = new Map<string, Promise<void>>();

export async function verifyRpcCluster(
  source: RpcIdentitySource,
  expectedGenesisHash: string,
): Promise<void> {
  const key = `${source.rpcEndpoint}|${expectedGenesisHash}`;
  const cached = verifiedClusterEndpoints.get(key);
  if (cached) return cached;
  const check = withRpcRetry(() => source.getGenesisHash(), { retries: 1, timeoutMs: 5_000 })
    .then((actual) => {
      if (actual !== expectedGenesisHash) {
        throw new Error(
          `RPC cluster mismatch for ${source.rpcEndpoint}: expected genesis ${expectedGenesisHash}, received ${actual}.`,
        );
      }
    })
    .catch((error) => {
      verifiedClusterEndpoints.delete(key);
      throw error;
    });
  verifiedClusterEndpoints.set(key, check);
  return check;
}

/** Bounded fallback for reads after every endpoint proves the expected cluster identity. */
export function withVerifiedRpcFallback<S extends RpcIdentitySource, T>(
  sources: readonly S[],
  expectedGenesisHash: string,
  read: (source: S) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  return withRpcFallback(
    sources,
    async (source) => {
      await verifyRpcCluster(source, expectedGenesisHash);
      return read(source);
    },
    opts,
  );
}

const inFlightReads = new Map<string, Promise<unknown>>();

/** Coalesce identical concurrent read-only requests without caching settled chain data. */
export function dedupeRpcRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = inFlightReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = read().finally(() => {
    if (inFlightReads.get(key) === pending) inFlightReads.delete(key);
  });
  inFlightReads.set(key, pending);
  return pending;
}

/** Map with a fixed concurrency limit, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}
