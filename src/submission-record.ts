import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DEFAULT_CONFIG_DIR } from "./config.js";
import type { Bundle } from "./types.js";

export interface SubmissionRecord {
  site_url: string;
  bundle_hash: string;
  submitted_at: string;
}

function recordPath(configDir: string): string {
  return join(configDir, "last-submission.json");
}

/**
 * A content fingerprint of `bundle`, local-only, used by `scan`'s closing
 * next-step hint to answer "has this exact bundle content already been
 * uploaded?" — never sent anywhere, never salted (this isn't a privacy
 * boundary like `repo_fingerprint`/`author_identity_hashes`, just a local
 * equality check over data the user already reviewed).
 *
 * Strips the three fields derived from wall-clock `now` rather than from
 * repo state + author selection + CLI version — without this, `scan` run
 * a second later (or a day later, for `repo.age_days`) would never match
 * even though re-submitting would upload nothing new:
 * - `created_at` / `attestation.confirmed_at`: the scan timestamp itself.
 * - `repo.age_days`: increments with pure passage of time.
 * Everything else in the bundle is deterministic given the same repo
 * state, author selection, and CLI version — including `tool_version` and
 * `detected_skills` on purpose: a CLI upgrade (new signatures, new churn
 * rules) can genuinely change what would be uploaded, so it should NOT be
 * treated as still-identical.
 */
export function bundleContentHash(bundle: Bundle): string {
  const { created_at, attestation, repo, ...rest } = bundle;
  const canonical = {
    ...rest,
    repo: { host_type: repo.host_type, repo_fingerprint: repo.repo_fingerprint },
    attestation: { authorized_confirmation: attestation.authorized_confirmation },
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Never in the scanned repo's cwd — always the device-local config dir, same as credentials.json. */
export function readLastSubmission(configDir: string = DEFAULT_CONFIG_DIR): SubmissionRecord | null {
  const path = recordPath(configDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SubmissionRecord;
}

/**
 * Written after a successful upload — see submit-command.ts. Not a secret
 * (just a hash of already-reviewed, already-uploaded content), so unlike
 * credentials.json/salt this is written without `mode: 0600`.
 */
export function saveLastSubmission(record: SubmissionRecord, configDir: string = DEFAULT_CONFIG_DIR): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(recordPath(configDir), JSON.stringify(record));
}
