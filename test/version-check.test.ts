import { afterEach, describe, expect, it } from "vitest";
import { startMockServer, type MockServer } from "./support/mock-server.js";
import { checkForUpdate } from "../src/version-check.js";

const servers: MockServer[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.close();
});

describe("checkForUpdate", () => {
  it("logs a one-line upgrade notice when the registry reports a newer version", async () => {
    const logs: string[] = [];
    await checkForUpdate({
      currentVersion: "0.1.0",
      log: (m) => logs.push(m),
      fetchFn: async () => ({ version: "0.2.0" }),
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toBe(
      "A newer version of @redential/cli is available: 0.2.0 (you have 0.1.0). Run `npm install -g @redential/cli` to update."
    );
  });

  it("logs nothing when already on the latest version", async () => {
    const logs: string[] = [];
    await checkForUpdate({
      currentVersion: "0.1.0",
      log: (m) => logs.push(m),
      fetchFn: async () => ({ version: "0.1.0" }),
    });
    expect(logs).toHaveLength(0);
  });

  it("logs nothing when the installed version is newer than the registry's (local/dev build)", async () => {
    const logs: string[] = [];
    await checkForUpdate({
      currentVersion: "0.5.0",
      log: (m) => logs.push(m),
      fetchFn: async () => ({ version: "0.4.0" }),
    });
    expect(logs).toHaveLength(0);
  });

  it("logs nothing and does not throw when fetchFn resolves to null (network failure)", async () => {
    const logs: string[] = [];
    await expect(
      checkForUpdate({
        currentVersion: "0.1.0",
        log: (m) => logs.push(m),
        fetchFn: async () => null,
      })
    ).resolves.toBeUndefined();
    expect(logs).toHaveLength(0);
  });

  it("logs nothing and does not throw when fetchFn itself throws", async () => {
    const logs: string[] = [];
    await expect(
      checkForUpdate({
        currentVersion: "0.1.0",
        log: (m) => logs.push(m),
        fetchFn: async () => {
          throw new Error("boom");
        },
      })
    ).resolves.toBeUndefined();
    expect(logs).toHaveLength(0);
  });

  it("logs nothing and does not throw on a malformed version string from the registry", async () => {
    const logs: string[] = [];
    await checkForUpdate({
      currentVersion: "0.1.0",
      log: (m) => logs.push(m),
      fetchFn: async () => ({ version: "not-a-version" }),
    });
    expect(logs).toHaveLength(0);
  });

  it("logs nothing when the registry response has no version field", async () => {
    const logs: string[] = [];
    await checkForUpdate({
      currentVersion: "0.1.0",
      log: (m) => logs.push(m),
      fetchFn: async () => ({}),
    });
    expect(logs).toHaveLength(0);
  });

  it("performs a real HTTP GET against registryUrl (via src/http-client.ts's getJson) when fetchFn isn't overridden", async () => {
    const server = await startMockServer((req) => {
      expect(req.method).toBe("GET");
      return { status: 200, body: { version: "9.9.9" } };
    });
    servers.push(server);

    const logs: string[] = [];
    await checkForUpdate({
      currentVersion: "0.1.0",
      log: (m) => logs.push(m),
      registryUrl: `${server.url}/pkg/latest`,
    });

    expect(server.requests).toHaveLength(1);
    expect(logs[0]).toContain("9.9.9");
  });

  it("resolves without throwing when the real HTTP path times out or the host is unreachable", async () => {
    await expect(
      checkForUpdate({
        currentVersion: "0.1.0",
        log: () => {},
        registryUrl: "http://127.0.0.1:1/unreachable",
        timeoutMs: 200,
      })
    ).resolves.toBeUndefined();
  });
});
