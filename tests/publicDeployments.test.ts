import { describe, expect, it } from "vitest";
import {
  deploymentToRegistryLaunch,
  getPublicDeployment,
  listPublicDeployments,
} from "@/lib/registry/publicDeployments";

describe("public deployments", () => {
  it("keeps the Journey devnet proof as a verified Explore record", () => {
    const row = getPublicDeployment("Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF");
    expect(row).not.toBeNull();
    expect(row?.fingerprint).toBe("16ac1e49b68f4a4c");
    expect(row?.config).toBe("FigS23YEaaQZH2VJZkqGVsRCpgsJN5HztuvbfGMo6Zmf");
    expect(row?.mint).toBe("31wt342XAZMbdiwcd4Uyxf7UxQVBskZ44GYTNV6XH44c");
    expect(row?.transaction).toBe(
      "5H79kPYiaEVzShy6LCg4V9af6zdRkNb6Nyt63vVNT11k2jT4gZkkC5zY5o7zGTY3Wpd6icALTyTRt4Qi5M3hNLZM",
    );
    expect(row?.checks).toEqual({
      fingerprint: true,
      poolConfiguration: true,
      migrationThreshold: true,
      readback: true,
    });
    expect(row?.constraintsPassed).toBe(false);
    const launch = deploymentToRegistryLaunch(row!);
    expect(launch.authSigner).toBeNull();
    expect(launch.name).toBe("Journey");
    expect(listPublicDeployments().some((item) => item.pool === row?.pool)).toBe(true);
  });

  it("keeps a second public deployment with a different design", () => {
    const row = getPublicDeployment("FhxqSm5YQKyKhgqFwd8dMyYb2WGAA9HsQDrBSy3G4KWd");
    const journey = getPublicDeployment("Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF");
    expect(row?.name).toBe("Northline");
    expect(row?.ticker).toBe("NLIN");
    expect(row?.fingerprint).toBe("e1bfccfe19434469");
    expect(row?.profileName).toBe("Equity-tuned · 2×");
    expect(row?.migrationQuoteThresholdAtoms).toBe("8000245007");
    expect(row?.constraintsPassed).toBe(false);
    expect(row?.fingerprint).not.toBe(journey?.fingerprint);
    expect(row?.pool).not.toBe(journey?.pool);
    expect(deploymentToRegistryLaunch(row!).sector).toBe("RWA");
  });
});
