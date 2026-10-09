import { describe, expect, it } from "vitest";
import { transactionNotice } from "@/lib/transactionUi";

describe("transaction notification", () => {
  it("includes purpose, readable signature, and the configured cluster explorer link", () => {
    const notice = transactionNotice("1234567890abcdef", "Buy confirmed");
    expect(notice.message).toContain("Buy confirmed");
    expect(notice.shortSignature).toBe("12345678…");
    expect(notice.explorerUrl).toContain("cluster=devnet");
  });
});
