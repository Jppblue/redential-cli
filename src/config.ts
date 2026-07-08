import { homedir } from "node:os";
import { join } from "node:path";

/** Same directory for the device salt (salt.ts) and the session token (credentials.ts). */
export const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "redential");

/**
 * Public by design (CLAUDE.md: "solo SITE_URL (pública)"). Overridable via
 * REDENTIAL_SITE_URL so tests and staging can point the CLI at a local
 * mock server instead of the real site.
 */
export function getSiteUrl(): string {
  const raw = process.env.REDENTIAL_SITE_URL ?? "https://www.redential.com";
  return raw.replace(/\/$/, "");
}
