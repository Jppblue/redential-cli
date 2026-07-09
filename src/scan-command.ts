import { buildBundleInteractively, type BuildBundleOptions } from "./build-bundle.js";
import { formatSummary } from "./summary.js";
import { getSiteUrl } from "./config.js";
import { readCredentials } from "./credentials.js";
import { bundleContentHash, readLastSubmission } from "./submission-record.js";
import type { Bundle } from "./types.js";

export type ScanCommandOptions = BuildBundleOptions & {
  log?: (message: string) => void;
  // True when stdout is an interactive terminal — cli.ts passes
  // `process.stdout.isTTY`. Determines whether the human-readable summary
  // is appended; tests set this explicitly instead of relying on a real
  // TTY. Undefined behaves like `false` (JSON-only), matching a piped
  // stdout so `scan | jq` never sees anything but the bundle.
  isTTY?: boolean;
  // Forces JSON-only output even when stdout is a TTY.
  json?: boolean;
  // True to render the summary with the ASCII/no-color fallback theme
  // (see summary.ts's shouldUsePlainOutput) instead of ANSI + Unicode
  // box-drawing. cli.ts computes this from process.platform/process.env;
  // tests set it explicitly, same pattern as isTTY.
  plain?: boolean;
};

/**
 * Local-only session/submission state for the wrapped summary's closing
 * next-step hint (see summary.ts's three CTA states). Reads only the CLI's
 * own config dir — same files login/submit already read/write — never the
 * network, never the repo again. Computed lazily by the caller, only when
 * the summary will actually be printed, so the common piped/`--json` path
 * never touches these files.
 */
function nextStepsState(bundle: Bundle, configDir: string | undefined): {
  hasSession: boolean;
  alreadySubmittedIdentical: boolean;
} {
  const siteUrl = getSiteUrl();
  const credentials = readCredentials(configDir);
  const hasSession = credentials !== null && credentials.site_url === siteUrl;
  if (!hasSession) return { hasSession: false, alreadySubmittedIdentical: false };

  const lastSubmission = readLastSubmission(configDir);
  const alreadySubmittedIdentical =
    lastSubmission !== null &&
    lastSubmission.site_url === siteUrl &&
    lastSubmission.bundle_hash === bundleContentHash(bundle);
  return { hasSession: true, alreadySubmittedIdentical };
}

/**
 * The `scan` command's actual behavior, independent of commander wiring —
 * exists mainly so the public-host warning ("warn, never block") is
 * testable without spawning the built CLI.
 *
 * Output contract: piped/redirected stdout (or `--json`) always gets ONLY
 * the raw bundle JSON, byte-identical to before the summary existed, so
 * `scan | jq` keeps working. A real TTY (and no `--json`) gets the same
 * JSON printed first, then the human-readable "wrapped" summary below it
 * — JSON first so the summary is what's left on screen once the JSON has
 * scrolled up. The summary is pure formatting over the bundle `runScan`
 * already computed, not a second data source.
 */
export async function executeScanCommand(opts: ScanCommandOptions): Promise<void> {
  const log = opts.log ?? console.log;
  const bundle = await buildBundleInteractively(opts);
  const bundleJson = JSON.stringify(bundle, null, 2);

  log(bundleJson);
  if (opts.isTTY && !opts.json) {
    log(formatSummary(bundle, { plain: opts.plain, ...nextStepsState(bundle, opts.configDir) }));
  }
}
