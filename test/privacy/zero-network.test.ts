import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// node:http/https export non-configurable properties in this runtime, so
// vi.spyOn on the real module throws ("Cannot redefine property"). vi.mock
// replaces the module in the resolution graph instead of mutating it —
// vi.hoisted keeps the mock fns reachable both from the (hoisted) factory
// and from the test body below.
const mocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  httpGet: vi.fn(),
  httpsRequest: vi.fn(),
  httpsGet: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("node:http", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, request: mocks.httpRequest, get: mocks.httpGet };
});
vi.mock("node:https", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, request: mocks.httpsRequest, get: mocks.httpsGet };
});
// global fetch isn't a module import, so it can't be vi.mock'd — stub it
// directly on globalThis for the duration of this suite instead.
const realFetch = globalThis.fetch;
globalThis.fetch = mocks.fetch as unknown as typeof fetch;

import { cleanup, commit, createRepo, setRemote } from "../support/fixtures.js";
import { runScan, listAuthors } from "../../src/scan.js";
import { isKnownPublicHost } from "../../src/public-remote.js";
import { getRemoteUrl } from "../../src/git.js";
import { readFileSync, readdirSync } from "node:fs";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "redential-config-"));
  dirs.push(dir);
  return dir;
}

describe("zero network calls during scan", () => {
  it("never touches http/https across listAuthors, the guardrail check, and runScan", () => {
    const dir = createRepo();
    dirs.push(dir);
    setRemote(dir, "https://github.com/acme/example.git");
    commit(dir, {
      message: "x",
      authorName: "You",
      authorEmail: "you@example.com",
      files: { "a.ts": "1\n" },
    });
    const configDir = tempConfigDir();

    isKnownPublicHost(getRemoteUrl(dir));
    listAuthors(dir);
    runScan({
      repoPath: dir,
      authors: ["you@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(mocks.httpRequest).not.toHaveBeenCalled();
    expect(mocks.httpGet).not.toHaveBeenCalled();
    expect(mocks.httpsRequest).not.toHaveBeenCalled();
    expect(mocks.httpsGet).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  // Only login.ts and submit.ts are allowed to reach the network (principle
  // 1: "the only network calls are login (device flow) and submit"), and
  // only through http-client.ts's fetch wrapper. Every other file in src/ —
  // including scan's whole dependency graph — must stay clean, and stays an
  // allowlist (not an enumeration of scan's files) so a new file added to
  // src/ is network-free by default unless explicitly opted in here.
  const NETWORK_ALLOWED_FILES = new Set(["http-client.ts", "login.ts", "submit.ts"]);

  it("has no reference to fetch/http/https network APIs outside the allowlisted files", () => {
    const srcUrl = new URL("../../src/", import.meta.url);
    const files = readdirSync(srcUrl).filter((f) => f.endsWith(".ts") && !NETWORK_ALLOWED_FILES.has(f));
    const networkPattern = /\bfetch\(|node:https?['"]|require\(['"]https?['"]\)/;
    for (const file of files) {
      const contents = readFileSync(new URL(file, srcUrl), "utf8");
      expect(contents, `${file} should not reference a network API`).not.toMatch(networkPattern);
    }
  });
});
