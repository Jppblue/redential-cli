import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup } from "./support/fixtures.js";
import { saveCredentials } from "../src/credentials.js";
import { runLogout } from "../src/logout.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
});

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "redential-config-"));
  dirs.push(dir);
  return dir;
}

describe("runLogout", () => {
  it("deletes an existing credentials file", () => {
    const configDir = tempConfigDir();
    saveCredentials({ access_token: "t", site_url: "https://x", obtained_at: "now" }, configDir);
    const credPath = join(configDir, "credentials.json");
    expect(existsSync(credPath)).toBe(true);

    const logs: string[] = [];
    runLogout({ configDir, log: (m) => logs.push(m) });

    expect(existsSync(credPath)).toBe(false);
    expect(logs.some((l) => l.includes("Logged out"))).toBe(true);
  });

  it("is a no-op (not an error) when nothing is stored", () => {
    const configDir = tempConfigDir();
    const logs: string[] = [];
    expect(() => runLogout({ configDir, log: (m) => logs.push(m) })).not.toThrow();
    expect(logs.some((l) => l.includes("Not logged in"))).toBe(true);
  });
});
