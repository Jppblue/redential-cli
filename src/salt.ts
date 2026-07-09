import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DEFAULT_CONFIG_DIR } from "./config.js";

/**
 * Device-local salt, persisted once per machine (same 0600 pattern as
 * credentials.json — see that file's comment for why `mode` is a no-op on
 * Windows and what protects the file there instead). Its only job is to
 * prevent rainbow-table lookups on repo_fingerprint / author_identity_hashes
 * — not to anchor identity to an account, which is `login`'s job in a later
 * milestone.
 */
export function getOrCreateSalt(configDir: string = DEFAULT_CONFIG_DIR): string {
  const saltPath = join(configDir, "salt");
  if (existsSync(saltPath)) {
    return readFileSync(saltPath, "utf8").trim();
  }
  mkdirSync(configDir, { recursive: true });
  const salt = randomBytes(32).toString("hex");
  writeFileSync(saltPath, salt, { mode: 0o600 });
  return salt;
}
