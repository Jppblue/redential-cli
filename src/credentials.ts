import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG_DIR } from "./config.js";

export interface Credentials {
  access_token: string;
  /** The SITE_URL the token was issued by — lets submit refuse a stale
   * token if REDENTIAL_SITE_URL later points somewhere else, instead of
   * silently sending a bearer token to a different host. */
  site_url: string;
  obtained_at: string;
}

function credentialsPath(configDir: string = DEFAULT_CONFIG_DIR): string {
  return join(configDir, "credentials.json");
}

/** Never in the scanned repo's cwd — always the device-local config dir. */
export function readCredentials(configDir: string = DEFAULT_CONFIG_DIR): Credentials | null {
  const path = credentialsPath(configDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Credentials;
}

/** 0600 — same permission pattern as salt.ts's device salt. */
export function saveCredentials(credentials: Credentials, configDir: string = DEFAULT_CONFIG_DIR): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(credentialsPath(configDir), JSON.stringify(credentials), { mode: 0o600 });
}

/** True if a credentials file existed and was removed; false if there was nothing to do. */
export function deleteCredentials(configDir: string = DEFAULT_CONFIG_DIR): boolean {
  const path = credentialsPath(configDir);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}
