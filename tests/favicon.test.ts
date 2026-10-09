import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("application favicon", () => {
  it("provides the canonical Next App Router favicon asset", () => {
    const path = resolve("public/favicon.ico");
    expect(existsSync(path)).toBe(true);
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
  });
});
