import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, commit, createRepo, setRemote } from "./support/fixtures.js";
import { startMockServer, type MockServer } from "./support/mock-server.js";
import { saveCredentials } from "../src/credentials.js";
import { executeSubmitCommand } from "../src/submit-command.js";
import { AuthError, SubmitError } from "../src/errors.js";

const dirs: string[] = [];
const servers: MockServer[] = [];
const originalSiteUrl = process.env.REDENTIAL_SITE_URL;

afterEach(async () => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
  while (servers.length > 0) await servers.pop()!.close();
  process.env.REDENTIAL_SITE_URL = originalSiteUrl;
});

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "redential-config-"));
  dirs.push(dir);
  return dir;
}

// Injected into every test that reaches a successful upload — without it,
// the default checkForUpdate would make a real request to the npm
// registry on every test run. version-check.test.ts covers checkForUpdate
// itself.
const noCheckForUpdate = async () => {};

function repoWithOneCommit(remote?: string): string {
  const dir = createRepo();
  dirs.push(dir);
  if (remote) setRemote(dir, remote);
  commit(dir, {
    message: "x",
    authorName: "You",
    authorEmail: "you@example.com",
    files: { "a.ts": "1\n" },
  });
  return dir;
}

describe("executeSubmitCommand", () => {
  it("refuses when there is no stored session", async () => {
    const dir = repoWithOneCommit();
    const configDir = tempConfigDir();
    await expect(
      executeSubmitCommand({
        repoPath: dir,
        author: ["you@example.com"],
        yes: true,
        confirmUpload: true,
        toolVersion: "0.1.0",
        configDir,
        log: () => {},
        warn: () => {},
      })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("refuses when the stored session belongs to a different site", async () => {
    const dir = repoWithOneCommit();
    const configDir = tempConfigDir();
    saveCredentials({ access_token: "t", site_url: "https://old.example", obtained_at: "now" }, configDir);
    process.env.REDENTIAL_SITE_URL = "https://new.example";

    await expect(
      executeSubmitCommand({
        repoPath: dir,
        author: ["you@example.com"],
        yes: true,
        confirmUpload: true,
        toolVersion: "0.1.0",
        configDir,
        log: () => {},
        warn: () => {},
      })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("prints the bundle, uploads on confirmation, and sends it with a bearer token", async () => {
    const server = await startMockServer((req) => {
      if (req.url === "/api/cli/bundles") return { status: 200, body: { id: "bundle-123" } };
      return { status: 404, body: {} };
    });
    servers.push(server);
    process.env.REDENTIAL_SITE_URL = server.url;

    const dir = repoWithOneCommit();
    const configDir = tempConfigDir();
    saveCredentials({ access_token: "secret-tok", site_url: server.url, obtained_at: "now" }, configDir);

    const logs: string[] = [];
    await executeSubmitCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      confirmUpload: true,
      toolVersion: "0.1.0",
      configDir,
      log: (m) => logs.push(m),
      warn: () => {},
      checkForUpdateFn: noCheckForUpdate,
    });

    expect(server.requests).toHaveLength(1);
    const req = server.requests[0];
    expect(req.headers.authorization).toBe("Bearer secret-tok");

    const printedBundleLine = logs.find((l) => l.trim().startsWith("{"));
    expect(printedBundleLine).toBeDefined();
    expect(req.body).toBe(printedBundleLine);

    expect(logs.some((l) => l.includes("bundle-123"))).toBe(true);
  });

  it("aborts without uploading when the user declines the upload prompt", async () => {
    const server = await startMockServer(() => ({ status: 200, body: { id: "should-not-be-called" } }));
    servers.push(server);
    process.env.REDENTIAL_SITE_URL = server.url;

    const dir = repoWithOneCommit();
    const configDir = tempConfigDir();
    saveCredentials({ access_token: "t", site_url: server.url, obtained_at: "now" }, configDir);

    const logs: string[] = [];
    await executeSubmitCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      confirmUpload: false,
      toolVersion: "0.1.0",
      configDir,
      log: (m) => logs.push(m),
      warn: () => {},
      promptConfirmUploadFn: async () => false,
    });

    expect(server.requests).toHaveLength(0);
    expect(logs.some((l) => l.includes("Aborted"))).toBe(true);
  });

  it("refuses and never uploads when the visibility gate confirms a public remote", async () => {
    const server = await startMockServer(() => ({ status: 200, body: { id: "should-not-be-called" } }));
    servers.push(server);
    process.env.REDENTIAL_SITE_URL = server.url;

    const dir = repoWithOneCommit("https://github.com/acme/example.git");
    const configDir = tempConfigDir();
    saveCredentials({ access_token: "t", site_url: server.url, obtained_at: "now" }, configDir);

    const warnings: string[] = [];
    await expect(
      executeSubmitCommand({
        repoPath: dir,
        author: ["you@example.com"],
        yes: true,
        confirmUpload: true,
        toolVersion: "0.1.0",
        configDir,
        log: () => {},
        warn: (m) => warnings.push(m),
        probeFn: async () => ({ status: 200 }),
      })
    ).rejects.toBeInstanceOf(SubmitError);

    expect(server.requests).toHaveLength(0);
    expect(warnings.some((w) => w.includes("GitHub App"))).toBe(true);
  });

  it("proceeds when the visibility gate finds the remote is not publicly reachable", async () => {
    const server = await startMockServer((req) => {
      if (req.url === "/api/cli/bundles") return { status: 200, body: { id: "ok" } };
      return { status: 404, body: {} };
    });
    servers.push(server);
    process.env.REDENTIAL_SITE_URL = server.url;

    const dir = repoWithOneCommit("https://github.com/acme/example.git");
    const configDir = tempConfigDir();
    saveCredentials({ access_token: "t", site_url: server.url, obtained_at: "now" }, configDir);

    await executeSubmitCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      confirmUpload: true,
      toolVersion: "0.1.0",
      configDir,
      log: () => {},
      warn: () => {},
      probeFn: async () => ({ status: 404 }),
      checkForUpdateFn: noCheckForUpdate,
    });

    expect(server.requests).toHaveLength(1);
  });

  it("calls checkForUpdateFn only after a successful upload, not on abort or refusal", async () => {
    const server = await startMockServer((req) => {
      if (req.url === "/api/cli/bundles") return { status: 200, body: { id: "bundle-456" } };
      return { status: 404, body: {} };
    });
    servers.push(server);
    process.env.REDENTIAL_SITE_URL = server.url;

    const dir = repoWithOneCommit();
    const configDir = tempConfigDir();
    saveCredentials({ access_token: "t", site_url: server.url, obtained_at: "now" }, configDir);

    let called = false;
    await executeSubmitCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      confirmUpload: true,
      toolVersion: "0.1.0",
      configDir,
      log: () => {},
      warn: () => {},
      checkForUpdateFn: async () => {
        called = true;
      },
    });

    expect(called).toBe(true);
  });

  it("does not call checkForUpdateFn when the user declines the upload prompt", async () => {
    const server = await startMockServer(() => ({ status: 200, body: { id: "should-not-be-called" } }));
    servers.push(server);
    process.env.REDENTIAL_SITE_URL = server.url;

    const dir = repoWithOneCommit();
    const configDir = tempConfigDir();
    saveCredentials({ access_token: "t", site_url: server.url, obtained_at: "now" }, configDir);

    let called = false;
    await executeSubmitCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      confirmUpload: false,
      toolVersion: "0.1.0",
      configDir,
      log: () => {},
      warn: () => {},
      promptConfirmUploadFn: async () => false,
      checkForUpdateFn: async () => {
        called = true;
      },
    });

    expect(called).toBe(false);
  });
});
