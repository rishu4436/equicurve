type Entry<T> = { at: number; value: T };

/** Short-lived values with one in-flight load per key. */
export function createTtlSingleFlight<T>(ttlMs: number) {
  const values = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  return {
    peek(key: string, now = Date.now()): T | null {
      const hit = values.get(key);
      if (!hit || now - hit.at >= ttlMs) return null;
      return hit.value;
    },
    async get(key: string, load: () => Promise<T>, store: (value: T) => boolean = () => true): Promise<T> {
      const hit = this.peek(key);
      if (hit != null) return hit;
      const pending = inflight.get(key);
      if (pending) return pending;
      const work = (async () => {
        const value = await load();
        if (store(value)) values.set(key, { at: Date.now(), value });
        return value;
      })().finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, work);
      return work;
    },
    clear(): void {
      values.clear();
      inflight.clear();
    },
  };
}
