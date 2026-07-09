import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Same directory for the device salt (salt.ts) and the session token
 * (credentials.ts). Derived purely from `os.homedir()` — no env var reads,
 * no new dependency (e.g. `env-paths`) — but the relative path is
 * platform-appropriate rather than hardcoding the POSIX `.config`
 * convention everywhere: `~/.config/redential` isn't the Windows
 * convention (no dotfile-under-home idiom there), so `win32` gets
 * `%USERPROFILE%\AppData\Roaming\redential` instead, matching where
 * Windows apps conventionally keep per-user app data. There is no prior
 * Windows install to migrate from — this is the first version of the CLI
 * to run on Windows at all. See docs/login-submit.md for the full
 * per-platform path and what actually protects the token there.
 */
export const DEFAULT_CONFIG_DIR =
  process.platform === "win32"
    ? join(homedir(), "AppData", "Roaming", "redential")
    : join(homedir(), ".config", "redential");

/**
 * Public by design (CLAUDE.md: "solo SITE_URL (pública)"). Overridable via
 * REDENTIAL_SITE_URL so tests and staging can point the CLI at a local
 * mock server instead of the real site.
 */
export function getSiteUrl(): string {
  const raw = process.env.REDENTIAL_SITE_URL ?? "https://www.redential.com";
  return raw.replace(/\/$/, "");
}
