import { execFileSync, spawn } from "node:child_process";
import { debugLog } from "./debug.js";
import type { RepoInfo } from "./types.js";

export interface FileChurn {
  path: string;
  added: number;
  deleted: number;
}

export interface RawCommit {
  sha: string;
  email: string;
  authorDate: Date;
  signed: boolean;
  churn: FileChurn[];
  // 2+ parents. `--numstat` already emits no per-file churn for merges (so
  // they contribute nothing to language/category shares); skill detection
  // mirrors that and skips them too, rather than reading a combined diff.
  isMerge: boolean;
}

function git(repoPath: string, args: string[]): string {
  // argv only — NEVER repoPath/cwd (would reveal an employer/project name
  // if pasted into a public issue) and never the command's own output.
  debugLog(`git ${args.join(" ")}`);
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const RECORD_SEP = "\x01";
const FIELD_SEP = "\x02";

// A repo with no commits yet ("unborn HEAD") is the one `git log` failure
// getAllCommits/getCommitCount treat as "empty repository" (returning
// [] / 0) rather than surfacing — every other failure (corrupt repo, git
// missing, permissions) is a real problem and must not be swallowed the
// same way, or a huge-repo maxBuffer-style bug just gets replaced by a
// different silently-wrong "no commits" result. Matched on stderr, not
// exit code alone, since both cases exit 128.
const EMPTY_REPO_PATTERN = /does not have any commits yet|bad default revision/;

function parseCommitRecord(record: string): RawCommit {
  const lines = record.split("\n");
  const [sha, email, authorDateIso, signatureStatus, parents] = lines[0].split(FIELD_SEP);
  const churn: FileChurn[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addedRaw, deletedRaw, ...pathParts] = parts;
    churn.push({
      path: pathParts.join("\t"),
      added: addedRaw === "-" ? 0 : parseInt(addedRaw, 10),
      deleted: deletedRaw === "-" ? 0 : parseInt(deletedRaw, 10),
    });
  }
  return {
    sha,
    email,
    authorDate: new Date(authorDateIso),
    // Only a fully verified good signature ("G") counts as signed. "U"
    // (good but untrusted/unmatched key), "B" (bad), "X"/"Y"/"R"
    // (expired/expired-key/revoked-key) and "E" (can't check) all mean
    // the signature doesn't actually establish anything — see
    // docs/schema.md's `signed` section for why.
    signed: signatureStatus === "G",
    churn,
    isMerge: parents.trim().split(/\s+/).filter(Boolean).length > 1,
  };
}

export interface GetAllCommitsOptions {
  /** Limits the walk to commits at or after this date (`git log --since`,
   * committer-date-based) — see src/since.ts. Undefined walks full history. */
  since?: Date;
  /** Invoked once per commit as it's parsed off the stream, in `--reverse`
   * (oldest-first) order — drives scan-command.ts's stderr progress line.
   * Never receives anything beyond a running count: no sha, path, or email. */
  onProgress?: (count: number) => void;
}

/**
 * All commits reachable from HEAD, oldest first (or, with `since` set, all
 * commits at or after that date). Returns [] for a repo with no commits
 * yet, rather than throwing — any OTHER git failure rejects instead of
 * silently returning [], so it isn't mistaken for an empty repo.
 *
 * Streams `git log`'s stdout via `spawn` and parses commit records
 * incrementally as chunks arrive, instead of buffering the whole output
 * (as the previous `execFileSync`-based version did) and instead of
 * holding it all at once — for a huge repo, whole-output buffering would
 * both blow past Node's default 1MB child-process maxBuffer (silently
 * swallowed by the old try/catch as an empty repo) and hold everything in
 * memory at once. Commit records here only ever carry numstat *counts*,
 * never diff content, so the accumulated array stays cheap even at tens of
 * thousands of commits — see getCommitsAddedLines for the actual diff
 * content path, which is batched separately.
 */
export function getAllCommits(repoPath: string, opts: GetAllCommitsOptions = {}): Promise<RawCommit[]> {
  const args = [
    "log",
    "--reverse",
    "--numstat",
    `--format=${RECORD_SEP}%H${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%G?${FIELD_SEP}%P`,
  ];
  if (opts.since) args.push(`--since=${opts.since.toISOString()}`);
  // Format string omitted — it's noisy separator bytes, not useful signal.
  debugLog(`git log --reverse --numstat${opts.since ? ` --since=${opts.since.toISOString()}` : ""} (streaming)`);

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: repoPath, stdio: ["ignore", "pipe", "pipe"] });
    const commits: RawCommit[] = [];
    let buffer = "";
    let stderr = "";
    let count = 0;

    // `buffer` always starts with its own leading RECORD_SEP once git has
    // written anything (the format string opens with it) — that leading
    // byte marks where the CURRENT record starts, not part of its content,
    // so every slice below strips it via `.slice(1, ...)`/`.slice(1)`.
    const consumeCompleteRecords = (final: boolean) => {
      for (;;) {
        const idx = buffer.indexOf(RECORD_SEP, 1);
        if (idx === -1) {
          if (final && buffer.trim().length > 0) {
            commits.push(parseCommitRecord(buffer.slice(1)));
            count++;
            opts.onProgress?.(count);
            buffer = "";
          }
          return;
        }
        const record = buffer.slice(1, idx);
        buffer = buffer.slice(idx);
        if (record.trim().length > 0) {
          commits.push(parseCommitRecord(record));
          count++;
          opts.onProgress?.(count);
        }
      }
    };

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      consumeCompleteRecords(false);
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderr += chunk;
    });
    // A spawn-level failure (e.g. `git` itself isn't on PATH) is a real
    // problem, not an empty repo — same "don't swallow real errors into a
    // misleading no-commits result" rationale as the exit-code branch
    // below.
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        if (EMPTY_REPO_PATTERN.test(stderr)) {
          resolve([]);
        } else {
          reject(new Error(`git log failed (exit ${code}): ${stderr.trim() || "unknown error"}`));
        }
        return;
      }
      consumeCompleteRecords(true);
      resolve(commits);
    });
  });
}

/** Fast total for the progress denominator — same `since` window as
 * getAllCommits, so "N/Total" is consistent with what's actually walked. */
export function getCommitCount(repoPath: string, since?: Date): number {
  const args = ["rev-list", "--count", "HEAD"];
  if (since) args.push(`--since=${since.toISOString()}`);
  try {
    const count = parseInt(git(repoPath, args).trim(), 10);
    return Number.isNaN(count) ? 0 : count;
  } catch {
    return 0;
  }
}

/** First line of `rev-list --max-parents=0`; multi-root histories are out of scope. */
export function getRootCommitSha(repoPath: string): string {
  return git(repoPath, ["rev-list", "--max-parents=0", "HEAD"]).trim().split("\n")[0];
}

/**
 * The root commit's own author date — always the TRUE start of the repo's
 * history, independent of any `--since` window applied elsewhere. Used for
 * `repo.age_days`, which must keep meaning "how old is this repo", not
 * "how old is the analyzed window" (see docs/schema.md and docs/scan.md's
 * `--since` section).
 */
export function getRootCommitDate(repoPath: string, rootSha: string): Date {
  return new Date(git(repoPath, ["show", "-s", "--format=%aI", rootSha]).trim());
}

/** Raw `origin` remote URL, read purely from local git config — null if there's none. */
export function getRemoteUrl(repoPath: string): string | null {
  try {
    return git(repoPath, ["remote", "get-url", "origin"]).trim();
  } catch {
    return null;
  }
}

export function getRemoteHostType(repoPath: string): RepoInfo["host_type"] {
  const url = getRemoteUrl(repoPath);
  if (!url) return "none";
  if (/github\.com/.test(url)) return "github";
  if (/gitlab\.com/.test(url)) return "gitlab";
  if (/bitbucket\.org/.test(url)) return "bitbucket";
  return "other";
}

/**
 * True for a shallow clone (`--depth N`) — history before the shallow
 * boundary simply doesn't exist locally, which would silently understate
 * `repo.age_days`, span, and commit counts with no indication why. Never a
 * reason to block scanning (same "warn, never block" stance as
 * publicHostWarning) — just something the user should know about. Fails
 * open (false) on any error, matching every other git.ts boolean-ish
 * probe: an inconclusive read must never look like "definitely not
 * shallow" being asserted with confidence it doesn't have, but blocking
 * scan on an advisory check would be worse than a missed warning.
 */
export function isShallowRepository(repoPath: string): boolean {
  try {
    return git(repoPath, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    return false;
  }
}

/**
 * The effective (local-overriding-global) `git config user.email` — used
 * ONLY to pre-select a candidate author identity already returned by
 * `listAuthors` (build-bundle.ts); never trusted as an authorization
 * signal by itself (the existing confirm-attestation step still applies
 * regardless of how the author was chosen). Null if unset or unreadable.
 */
export function getConfiguredUserEmail(repoPath: string): string | null {
  try {
    const email = git(repoPath, ["config", "user.email"]).trim();
    return email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

export interface AddedLines {
  path: string;
  addedLines: string;
}

/**
 * Lines a single (non-merge — caller's responsibility to skip those,
 * matching `getAllCommits`' own numstat behavior) commit ADDED, grouped by
 * file — the input to skill-detection pattern matching (src/skill-detect.ts).
 * Never removed/context lines: we care what was introduced, not what a diff
 * happened to touch. `--no-color`/`--no-ext-diff`/`core.quotepath=off` keep
 * the user's own git config (color.ui, an external diff tool, quoted
 * non-ASCII paths) from corrupting this parser — this reads local git
 * output, but the shape of that output must stay ours to depend on.
 */
export function getCommitAddedLines(repoPath: string, sha: string): AddedLines[] {
  let out: string;
  try {
    out = git(repoPath, [
      "-c",
      "core.quotepath=off",
      "show",
      sha,
      "--unified=0",
      "--format=",
      "--no-color",
      "--no-ext-diff",
    ]);
  } catch {
    return [];
  }

  // Diff CONTENT lines mirror the file's own line endings — a CRLF-authored
  // file's "+" lines each carry a trailing \r once this only splits on "\n"
  // below. That \r would otherwise leak into every downstream regex in
  // import-detect.ts (JS's `^`/`$` under the `m` flag treat a bare \r as
  // its own line terminator, independent of \n) and, worse, potentially
  // into a matched package name itself. This can happen on any OS that
  // scans a CRLF-authored file, not just Windows — normalize once, up
  // front, rather than special-case every parser downstream.
  out = out.replace(/\r\n/g, "\n");

  const files: AddedLines[] = [];
  let currentPath: string | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    if (currentPath) files.push({ path: currentPath, addedLines: currentLines.join("\n") });
  };
  for (const line of out.split("\n")) {
    if (line.startsWith("+++ b/")) {
      flush();
      currentPath = line.slice("+++ b/".length);
      currentLines = [];
    } else if (line.startsWith("+++ /dev/null")) {
      // Deleted file — nothing was added to it.
      flush();
      currentPath = null;
      currentLines = [];
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      currentLines.push(line.slice(1));
    }
  }
  flush();
  return files;
}

const SHOW_HEADER_PATTERN = /^\x01([0-9a-f]{40})$/;

/**
 * Batched form of getCommitAddedLines: fetches added-line diff content for
 * MANY commits in a single `git show <sha...>` process instead of one
 * process per commit — the dominant cost at huge-repo scale is subprocess
 * spawn count, not git's own diff work. Callers (skill-detect.ts) chunk
 * their sha list themselves, so at most one chunk's worth of diff text is
 * ever held in memory at a time — see docs/scan.md's "huge repositories"
 * section.
 *
 * Streams stdout and parses line-by-line rather than buffering the whole
 * process output (same maxBuffer rationale as getAllCommits — a batch's
 * combined diff can easily exceed 1MB). Record boundaries are anchored to
 * whole lines matching `\x01<40 hex chars>` (the `--format=\x01%H` header
 * git emits once per commit) rather than a raw byte search: unlike
 * getAllCommits' numstat records, this stream carries arbitrary user file
 * content, and diff body lines always start with `+`/`-`/` `/`@`/`d`/`i`
 * (unified-diff syntax) — never with the bare `\x01` byte at position 0 —
 * so a content line can never be mistaken for a header.
 *
 * Never throws: a git failure (e.g. an unresolvable sha) resolves with
 * whatever was already parsed, matching getCommitAddedLines' own
 * fail-quiet-to-no-diff-data behavior — skill detection missing a match is
 * not a privacy problem, only a completeness one.
 */
export function getCommitsAddedLines(repoPath: string, shas: string[]): Promise<Map<string, AddedLines[]>> {
  const result = new Map<string, AddedLines[]>();
  if (shas.length === 0) return Promise.resolve(result);

  const args = [
    "-c",
    "core.quotepath=off",
    "show",
    ...shas,
    "--unified=0",
    `--format=${RECORD_SEP}%H`,
    "--no-color",
    "--no-ext-diff",
  ];
  debugLog(`git show <${shas.length} shas> --unified=0 (batched diff fetch)`);

  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: repoPath, stdio: ["ignore", "pipe", "pipe"] });
    let currentSha: string | null = null;
    let currentPath: string | null = null;
    let currentLines: string[] = [];
    let files: AddedLines[] = [];
    let leftover = "";

    const flushFile = () => {
      if (currentPath) files.push({ path: currentPath, addedLines: currentLines.join("\n") });
      currentPath = null;
      currentLines = [];
    };
    const flushCommit = () => {
      flushFile();
      if (currentSha) result.set(currentSha, files);
      files = [];
    };

    const processLine = (rawLine: string) => {
      // Same CRLF normalization as getCommitAddedLines, applied per-line
      // since this parses incrementally instead of over the whole buffer.
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const header = SHOW_HEADER_PATTERN.exec(line);
      if (header) {
        flushCommit();
        currentSha = header[1];
      } else if (line.startsWith("+++ b/")) {
        flushFile();
        currentPath = line.slice("+++ b/".length);
      } else if (line.startsWith("+++ /dev/null")) {
        flushFile();
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        currentLines.push(line.slice(1));
      }
    };

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      const combined = leftover + chunk;
      const lines = combined.split("\n");
      leftover = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });
    child.stderr!.on("data", () => {
      // Intentionally discarded — see the doc comment: a git failure here
      // degrades to "no diff data for the affected commits", never thrown.
    });
    child.on("error", () => resolve(result));
    child.on("close", () => {
      if (leftover.length > 0) processLine(leftover);
      flushCommit();
      resolve(result);
    });
  });
}
