import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDebugEnabled } from "../../src/debug.js";
import { saveCredentials } from "../../src/credentials.js";
import { executeScanCommand } from "../../src/scan-command.js";
import { cleanup, commit, createRepo } from "../support/fixtures.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
  setDebugEnabled(false); // module-level state — must not leak across test files
});

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "redential-config-"));
  dirs.push(dir);
  return dir;
}

/**
 * `--debug` is a diagnostics channel users are expected to paste into
 * public GitHub issues — this proves that channel can never carry the two
 * things that would make that dangerous: the stored session token, or the
 * bundle content itself (the bundle is already printed deliberately on
 * stdout — see other tests — but debug output on STDERR is a second,
 * easy-to-overlook place a secret-shaped value could leak from if a
 * future debugLog call got careless).
 */
describe("--debug output never contains the token or bundle content", () => {
  it("stderr debug lines never contain the stored access_token", async () => {
    const dir = createRepo();
    dirs.push(dir);
    commit(dir, {
      message: "x",
      authorName: "You",
      authorEmail: "you@example.com",
      files: { "a.ts": "console.log(1)\n" },
    });
    const configDir = tempConfigDir();
    const DISTINCTIVE_FAKE_TOKEN = "xxx-EXAMPLE-FAKE-ACCESS-TOKEN-do-not-log-me-xxx";
    saveCredentials(
      { access_token: DISTINCTIVE_FAKE_TOKEN, site_url: "https://example.test", obtained_at: "now" },
      configDir
    );

    setDebugEnabled(true);
    const stderrWrites: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(chunk.toString());
      return true;
    });

    try {
      await executeScanCommand({
        repoPath: dir,
        author: ["you@example.com"],
        yes: true,
        toolVersion: "test",
        configDir,
        log: () => {},
        warn: () => {},
      });
    } finally {
      spy.mockRestore();
    }

    const allStderr = stderrWrites.join("");
    expect(allStderr).not.toContain(DISTINCTIVE_FAKE_TOKEN);
    // A sanity check that debug output actually fired at all — otherwise
    // the assertion above would trivially pass on an empty string.
    expect(stderrWrites.some((line) => line.startsWith("[debug]"))).toBe(true);
  });

  it("stderr debug lines never contain bundle field values (repo_fingerprint, author_identity_hashes, commit shas)", async () => {
    const dir = createRepo();
    dirs.push(dir);
    commit(dir, {
      message: "x",
      authorName: "You",
      authorEmail: "you@example.com",
      files: { "a.ts": "console.log(1)\n" },
    });
    const configDir = tempConfigDir();

    setDebugEnabled(true);
    const stderrWrites: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(chunk.toString());
      return true;
    });
    const stdoutLogs: string[] = [];

    try {
      await executeScanCommand({
        repoPath: dir,
        author: ["you@example.com"],
        yes: true,
        toolVersion: "test",
        configDir,
        log: (m) => stdoutLogs.push(m),
        warn: () => {},
      });
    } finally {
      stderrSpy.mockRestore();
    }

    const bundle = JSON.parse(stdoutLogs[0]);
    const allStderr = stderrWrites.join("");
    expect(allStderr).not.toContain(bundle.repo.repo_fingerprint);
    expect(allStderr).not.toContain(bundle.integrity.merkle_root);
    for (const hash of bundle.identity.author_identity_hashes) {
      expect(allStderr).not.toContain(hash);
    }
  });

  it("--debug never changes stdout — piped JSON stays byte-identical", async () => {
    const dir = createRepo();
    dirs.push(dir);
    commit(dir, {
      message: "x",
      authorName: "You",
      authorEmail: "you@example.com",
      files: { "a.ts": "console.log(1)\n" },
    });
    const configDir = tempConfigDir();

    setDebugEnabled(false);
    const withoutDebug: string[] = [];
    await executeScanCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      toolVersion: "test",
      configDir,
      log: (m) => withoutDebug.push(m),
      warn: () => {},
    });

    setDebugEnabled(true);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const withDebug: string[] = [];
    try {
      await executeScanCommand({
        repoPath: dir,
        author: ["you@example.com"],
        yes: true,
        toolVersion: "test",
        configDir,
        log: (m) => withDebug.push(m),
        warn: () => {},
      });
    } finally {
      spy.mockRestore();
    }

    const stripVolatile = (raw: string) => {
      const b = JSON.parse(raw);
      delete b.created_at;
      delete b.attestation.confirmed_at;
      return b;
    };
    expect(withDebug.map(stripVolatile)).toEqual(withoutDebug.map(stripVolatile));
  });
});
