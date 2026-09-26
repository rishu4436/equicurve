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
      const jitter = Math.floor(Math.random() * base * 0.25);
      await doSleep(base * 2 ** attempt + jitter);
    }
  }
  throw lastErr;
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
