import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergePricePoints } from "@/lib/local/priceHistory";
import { liveSpotPoint } from "@/components/offering/PriceHistoryChart";

describe("price history merge", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    });
  });

  it("deduplicates signatures and orders equal timestamps by slot", () => {
    const points = mergePricePoints("pool", [
      { t: 1000, slot: 3, price: 3, sig: "c", source: "swap" },
      { t: 1000, slot: 1, price: 1, sig: "a", source: "swap" },
      { t: 1000, slot: 1, price: 1, sig: "a", source: "swap" },
      { t: 1000, slot: 2, price: 2, sig: "b", source: "swap" },
      { t: 1100, price: 4, source: "spot" },
    ]);
    expect(points.map((point) => point.sig ?? point.source)).toEqual(["a", "b", "c", "spot"]);
  });
});

describe("price chart live marker", () => {
  const history = [
    { t: 10, price: 1, source: "swap" as const, sig: "a" },
    { t: 20, price: 2, source: "spot" as const },
  ];
  it("uses the latest observed spot time and archives it after migration", () => {
    expect(liveSpotPoint(history, 3)).toEqual([{ x: 20, y: 3 }]);
    expect(liveSpotPoint(history, 3, true)).toEqual([]);
  });
});
