import { buildBundleInteractively, type BuildBundleOptions } from "./build-bundle.js";
import { AuthError, SubmitError } from "./errors.js";
import { getSiteUrl } from "./config.js";
import { readCredentials } from "./credentials.js";
import { getRemoteUrl } from "./git.js";
import { checkVisibilityGate, postBundle } from "./submit.js";
import { promptConfirmUpload } from "./prompt.js";
import { checkForUpdate } from "./version-check.js";
import { bundleContentHash, saveLastSubmission } from "./submission-record.js";

export type SubmitCommandOptions = BuildBundleOptions & {
  /** Separate from `yes` (authorization-to-scan) on purpose — this is
   * consent to upload, a materially different and riskier action. */
  confirmUpload: boolean;
  log?: (message: string) => void;
  promptConfirmUploadFn?: () => Promise<boolean>;
  // Injectable for tests, so the visibility gate doesn't need a real
  // network call to github.com to exercise the blocked/unblocked paths.
  probeFn?: Parameters<typeof checkVisibilityGate>[1];
  // Injectable so tests don't make a real request to the npm registry;
  // defaults to the real checkForUpdate (src/version-check.ts).
  checkForUpdateFn?: () => Promise<void>;
};

/**
 * `submit`'s actual behavior, independent of commander wiring. Builds the
 * bundle through the exact same path `scan` uses, prints it (byte-for-byte
 * what gets uploaded — see submit.ts's postBundle), then gates on: a
 * matching stored session, explicit upload confirmation, and the remote
 * visibility check.
 */
export async function executeSubmitCommand(opts: SubmitCommandOptions): Promise<void> {
  const log = opts.log ?? console.log;
  const warn = opts.warn ?? console.error;

  const siteUrl = getSiteUrl();
  const credentials = readCredentials(opts.configDir);
  if (!credentials) {
    throw new AuthError("Not logged in. Run `redential login` first.");
  }
  if (credentials.site_url !== siteUrl) {
    throw new AuthError("Stored session belongs to a different site. Run `redential login` again.");
  }

  const bundle = await buildBundleInteractively(opts);
  const bundleJson = JSON.stringify(bundle, null, 2);
  log(bundleJson);

  const confirmedUpload = opts.confirmUpload || (await (opts.promptConfirmUploadFn ?? promptConfirmUpload)());
  if (!confirmedUpload) {
    log("Aborted — nothing was uploaded.");
    return;
  }

  const visibility = opts.probeFn
    ? await checkVisibilityGate(getRemoteUrl(opts.repoPath), opts.probeFn)
    : await checkVisibilityGate(getRemoteUrl(opts.repoPath));
  if (visibility.message) warn(visibility.message);
  if (visibility.blocked) {
    throw new SubmitError("Submit refused: see the message above.");
  }

  const result = await postBundle(siteUrl, credentials.access_token, bundleJson);
  log(`Uploaded. Bundle id: ${result.id}`);

  // Local-only bookkeeping so a future `scan`'s wrapped summary can tell
  // "already uploaded, nothing new to submit" from "not submitted yet" —
  // see submission-record.ts. Never sent anywhere; best-effort in spirit
  // but not wrapped in try/catch like checkForUpdate below, since a
  // failure here (e.g. an unwritable config dir) would be a real local
  // problem worth surfacing, not a network blip to swallow.
  saveLastSubmission(
    { site_url: siteUrl, bundle_hash: bundleContentHash(bundle), submitted_at: new Date().toISOString() },
    opts.configDir
  );

  // Best-effort only, after the upload itself has already fully succeeded
  // — never allowed to turn a successful submit into a failure
  // (checkForUpdate never throws by contract).
  await (opts.checkForUpdateFn ?? (() => checkForUpdate({ log: warn, currentVersion: opts.toolVersion })))();
}
