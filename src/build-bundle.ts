import { runScan, listAuthors, type AuthorCandidate } from "./scan.js";
import { ScanError } from "./errors.js";
import { promptAuthors, promptConfirmAttestation, promptUseGitIdentity } from "./prompt.js";
import { getConfiguredUserEmail, getRemoteUrl, isShallowRepository } from "./git.js";
import { publicHostWarning } from "./public-remote.js";
import { shallowRepoWarning } from "./shallow-repo.js";
import type { Bundle } from "./types.js";

export interface BuildBundleOptions {
  repoPath: string;
  author: string[];
  yes: boolean;
  toolVersion: string;
  configDir?: string;
  // Injectable for tests; defaults to the real interactive prompts.
  promptAuthorsFn?: (candidates: AuthorCandidate[]) => Promise<string[]>;
  promptConfirmFn?: () => Promise<boolean>;
  // Injectable for tests; defaults to the real interactive prompt. Only
  // ever called when `git config user.email` matches one of 2+ candidates
  // — see the "author pre-selection" comment below.
  promptUseGitIdentityFn?: (candidate: AuthorCandidate) => Promise<boolean>;
  warn?: (message: string) => void;
  // Raw --since spec, forwarded to runScan (src/since.ts parses it). See
  // scan-command.ts / docs/scan.md for the CLI-facing behavior.
  since?: string;
  // Forwarded to runScan — see ScanOptions.onProgress.
  onProgress?: (scanned: number, total: number) => void;
}

/**
 * Shared by `scan` and `submit`: author selection, authorization
 * confirmation, and the actual scan. `submit` calls this directly instead
 * of re-deriving the bundle another way, so the bundle it uploads is
 * produced by the exact same code path `scan` prints (principle 4,
 * "User-reviewed").
 */
export async function buildBundleInteractively(opts: BuildBundleOptions): Promise<Bundle> {
  const warn = opts.warn ?? console.error;

  const publicHostNote = publicHostWarning(getRemoteUrl(opts.repoPath));
  if (publicHostNote) warn(publicHostNote);
  if (isShallowRepository(opts.repoPath)) warn(shallowRepoWarning());

  let authors = opts.author;
  if (authors.length === 0) {
    const candidates = await listAuthors(opts.repoPath);
    if (candidates.length === 0) {
      throw new ScanError("This repository has no commits yet — nothing to scan.");
    }

    // Author pre-selection: with 2+ candidates, offer the repo's own git
    // identity as a fast default BEFORE the full list — most repos have
    // one obvious "you". A single candidate already gets its own Y/n
    // confirmation inside promptAuthors below; asking the same question
    // twice in a row would be redundant, so this only fires for 2+.
    // Declining, or no match at all, falls through to the FULL,
    // unmodified list — never silently dropping the matched entry, since
    // "no" often means "that one plus others" for a multi-identity repo.
    let preselected = false;
    if (candidates.length > 1) {
      const gitEmail = getConfiguredUserEmail(opts.repoPath);
      const matched = gitEmail ? candidates.find((c) => c.email === gitEmail) : undefined;
      if (matched) {
        const useIt = await (opts.promptUseGitIdentityFn ?? promptUseGitIdentity)(matched);
        if (useIt) {
          authors = [matched.email];
          preselected = true;
        }
      }
    }

    if (!preselected) {
      authors = await (opts.promptAuthorsFn ?? promptAuthors)(candidates);
    }
  }

  let confirmed = opts.yes;
  if (!confirmed) {
    confirmed = await (opts.promptConfirmFn ?? promptConfirmAttestation)();
  }

  return runScan({
    repoPath: opts.repoPath,
    authors,
    confirmed,
    toolVersion: opts.toolVersion,
    configDir: opts.configDir,
    since: opts.since,
    onProgress: opts.onProgress,
  });
}
