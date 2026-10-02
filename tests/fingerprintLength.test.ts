import { describe, expect, it } from "vitest";
import { canonicalMarketConfig, marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { recordedConfigMatchesFingerprint, recordedFingerprintMatches } from "@/lib/dbc/deploymentReadback";
import { buildPresetConfig } from "@/lib/dbc/presets";
import { sha256Hex } from "@/lib/market/hash";
import { getRecordedDeployment } from "@/lib/registry/publicDeployments";

const JOURNEY = "Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF";

describe("config fingerprint length", () => {
  it("issues 32 hex characters and still accepts a stored 16-hex prefix", () => {
    const cfg = buildPresetConfig("short");
    const canonical = canonicalMarketConfig(cfg);
    const digest = sha256Hex(canonical);
    const id = marketConfigFingerprint(cfg);
    expect(id).toHaveLength(32);
    expect(id).toBe(digest.slice(0, 32));
    expect(recordedFingerprintMatches(canonical, digest.slice(0, 16))).toBe(true);
    expect(recordedConfigMatchesFingerprint(cfg, digest.slice(0, 16))).toBe(true);
    expect(recordedConfigMatchesFingerprint(cfg, id)).toBe(true);
    expect(recordedFingerprintMatches(canonical, digest)).toBe(false);

    const journey = getRecordedDeployment(JOURNEY);
    expect(journey?.fingerprint).toBe("16ac1e49b68f4a4c");
    expect(recordedFingerprintMatches(journey!.canonicalConfig, journey!.fingerprint)).toBe(true);
  });
});
