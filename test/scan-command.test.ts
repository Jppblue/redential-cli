import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, commit, createRepo } from "./support/fixtures.js";
import { validateAgainstSchema } from "./support/schema-validate.js";
import { executeScanCommand } from "../src/scan-command.js";

const schema = JSON.parse(
  readFileSync(new URL("../schema/bundle.v1.json", import.meta.url), "utf8")
);

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
});

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "redential-config-"));
  dirs.push(dir);
  return dir;
}

function repoWithOneCommit(): string {
  const dir = createRepo();
  dirs.push(dir);
  commit(dir, {
    message: "x",
    authorName: "You",
    authorEmail: "you@example.com",
    files: { "a.ts": "console.log(1)\n" },
  });
  return dir;
}

describe("executeScanCommand", () => {
  it("prints ONLY the raw JSON bundle when stdout is not a TTY (isTTY omitted)", async () => {
    const dir = repoWithOneCommit();
    const logs: string[] = [];
    await executeScanCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      toolVersion: "test",
      configDir: tempConfigDir(),
      log: (m) => logs.push(m),
    });

    expect(logs).toHaveLength(1);
    const bundle = JSON.parse(logs[0]);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("prints ONLY the raw JSON bundle when isTTY is explicitly false", async () => {
    const dir = repoWithOneCommit();
    const logs: string[] = [];
    await executeScanCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      toolVersion: "test",
      configDir: tempConfigDir(),
      log: (m) => logs.push(m),
      isTTY: false,
    });

    expect(logs).toHaveLength(1);
    expect(() => JSON.parse(logs[0])).not.toThrow();
  });

  it("prepends the human-readable summary before the JSON when isTTY is true", async () => {
    const dir = repoWithOneCommit();
    const logs: string[] = [];
    await executeScanCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      toolVersion: "test",
      configDir: tempConfigDir(),
      log: (m) => logs.push(m),
      isTTY: true,
    });

    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("YOUR PRIVATE REPO, WRAPPED");
    expect(logs[0]).toContain("Nothing left your machine. Verify: github.com/Jppblue/redential-cli");
    const bundle = JSON.parse(logs[1]);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("--json forces JSON-only output even when isTTY is true", async () => {
    const dir = repoWithOneCommit();
    const logs: string[] = [];
    await executeScanCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      toolVersion: "test",
      configDir: tempConfigDir(),
      log: (m) => logs.push(m),
      isTTY: true,
      json: true,
    });

    expect(logs).toHaveLength(1);
    expect(() => JSON.parse(logs[0])).not.toThrow();
  });

  it("the JSON printed in TTY mode is byte-identical to what non-TTY mode prints", async () => {
    const dir = repoWithOneCommit();
    const configDir = tempConfigDir();

    const nonTtyLogs: string[] = [];
    await executeScanCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      toolVersion: "test",
      configDir,
      log: (m) => nonTtyLogs.push(m),
      isTTY: false,
    });

    const ttyLogs: string[] = [];
    await executeScanCommand({
      repoPath: dir,
      author: ["you@example.com"],
      yes: true,
      toolVersion: "test",
      configDir,
      log: (m) => ttyLogs.push(m),
      isTTY: true,
    });

    // Both scans read the same fixture repo/config dir; only `created_at`/
    // `attestation.confirmed_at` (wall-clock `now`) can legitimately differ
    // between the two calls, so compare with those stripped.
    const stripVolatile = (raw: string) => {
      const b = JSON.parse(raw);
      delete b.created_at;
      delete b.attestation.confirmed_at;
      return b;
    };
    expect(stripVolatile(ttyLogs[1])).toEqual(stripVolatile(nonTtyLogs[0]));
  });
});
