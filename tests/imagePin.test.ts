import https from "node:https";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { pinnedImageFetch, pinnedRequestOptions } from "@/lib/server/imageCheck";

describe("pinned image connection", () => {
  it("keeps the URL hostname for Host and SNI and forces lookup to the validated address", () => {
    const target = new URL("https://cdn.example:8443/a.png?x=1");
    const options = pinnedRequestOptions(target, "8.8.8.8", "HEAD", { Range: "bytes=0-0" });
    expect(options.host).toBe("8.8.8.8");
    expect(options.port).toBe(8443);
    expect(options.path).toBe("/a.png?x=1");
    expect(options.servername).toBe("cdn.example");
    expect(options.setHost).toBe(false);
    expect(options.autoSelectFamily).toBe(false);
    expect(options.family).toBe(4);
    expect(options.headers).toMatchObject({ host: "cdn.example:8443", Range: "bytes=0-0" });

    const lookup = options.lookup;
    expect(lookup).toBeTypeOf("function");
    if (!lookup) return;
    lookup("attacker.example", { all: true }, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe("8.8.8.8");
      expect(family).toBe(4);
    });

    const v6 = pinnedRequestOptions(new URL("https://cdn.example/a.png"), "2001:4860:4860::8888", "GET", {});
    expect(v6.host).toBe("2001:4860:4860::8888");
    expect(v6.family).toBe(6);
    expect(v6.servername).toBe("cdn.example");
    expect(v6.headers).toMatchObject({ host: "cdn.example" });

    const literal = pinnedRequestOptions(new URL("https://8.8.8.8/a.png"), "8.8.8.8", "HEAD", {});
    expect(literal.servername).toBeUndefined();
    expect(literal.headers).toMatchObject({ host: "8.8.8.8" });
  });

  it("refuses a private address before opening a socket", async () => {
    await expect(
      pinnedImageFetch({
        url: "https://cdn.example/a.png",
        method: "HEAD",
        headers: {},
        addresses: ["127.0.0.1"],
        signal: AbortSignal.timeout(50),
      }),
    ).rejects.toThrow(/private image address/);
  });

  it("opens the socket to the pinned address and sends that hostname as SNI", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as net.AddressInfo).port;
    let sawSni = false;
    server.on("connection", (socket) => {
      socket.on("data", (buf) => {
        if (buf.toString("latin1").includes("cdn.example")) sawSni = true;
        socket.destroy();
      });
    });
    const target = new URL(`https://cdn.example:${port}/a.png`);
    const options = pinnedRequestOptions(target, "127.0.0.1", "HEAD", {});
    await new Promise<void>((resolve) => {
      const req = https.request({ ...options, timeout: 2000 }, () => resolve());
      req.on("error", () => resolve());
      req.on("timeout", () => {
        req.destroy();
        resolve();
      });
      req.end();
    });
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    expect(sawSni).toBe(true);
  });
});
