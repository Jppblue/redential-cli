// Verbose diagnostic logging for `--debug` — the one deliberate exception
// to this codebase's everywhere-dependency-injection style (every other
// cross-cutting concern — log/warn/progressWrite/promptXFn — is threaded
// explicitly through options objects). Full DI here would mean adding a
// debugLog parameter to essentially every function in git.ts, scan.ts, and
// skill-detect.ts; a verbose-flag toggle is the standard CLI idiom instead
// (cf. Node's own `util.debuglog`). Module-level state, set once at CLI
// startup — tests that enable it MUST reset it in `afterEach`, or it leaks
// across test files sharing the same process.
//
// Paste-safety is the hard constraint: users paste `--debug` output into
// public GitHub issues. Every call site in this codebase logs ONLY git
// argv (shas, dates, flags — never a path or email), phase timings, and
// counts. NEVER a repo path (reveals an employer/project name), diff
// content, candidate email, token, or bundle field value — see
// test/privacy/debug-output.test.ts, which asserts this end to end.
let enabled = false;

export function setDebugEnabled(value: boolean): void {
  enabled = value;
}

export function isDebugEnabled(): boolean {
  return enabled;
}

/** No-op unless enabled — callers don't need to guard with isDebugEnabled()
 * themselves. Always stderr, never the `log` callback that backs stdout —
 * `scan --debug | jq` must stay byte-identical to `scan | jq`. */
export function debugLog(message: string): void {
  if (!enabled) return;
  process.stderr.write(`[debug] ${message}\n`);
}
