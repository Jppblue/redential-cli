// Live progress for `redential explain` — a real run on a big repo can take
// tens of seconds with zero output otherwise, which reads as hung. This is a
// purely presentational, throttled stderr line-rewriter; it carries NO
// detection logic and is never imported by scan/submit/build-bundle (see
// those files' own zero-network/screen-vs-bundle boundaries, untouched by
// this file).
//
// CONTENT RULE (same paste-safety invariant as src/debug.ts's header
// comment, applied to this module's own output instead of --debug's): every
// byte this module ever writes is either one of the FIXED phase labels
// below or a plain integer/percentage. NEVER a path, file name, function
// name, email, or any other repo-derived string — enforced at compile time
// by ProgressPhase being a closed string-literal union (not `string`), so a
// caller physically cannot pass this module a git-derived label. Verified
// empirically too, in test/proof-graph/progress.test.ts (allowlist regex)
// and test/explain-command.test.ts (probes the real pipeline's own
// distinctive names/paths and asserts none of them reach stderr).
//
// STDOUT vs STDERR: always stderr, via the injectable `write` below —
// never the `log` callback that backs a command's stdout, matching
// scan-command.ts's own `progressWrite` (stderr-only huge-repo progress)
// and debug.ts's debugLog. `explain`'s stdout stays exactly the diagnostic
// text it already printed before this module existed.
//
// ENABLEMENT gates on `process.stdout.isTTY` (not stderr's), per the
// owner's spec: a piped/redirected STDOUT means the CLI's output is being
// consumed by something other than a human watching the terminal (a
// script, `| tee`, a CI log), and progress noise on stderr would be an
// unwanted addition to that stream even though the actual result travels
// on stdout. `enabled` in the options below is a direct override for
// tests, so both the on and off paths are exercisable without a real TTY.

/**
 * The complete, fixed set of phase labels this module will ever render.
 * Deliberately a closed union (not `string`) — see this file's header
 * comment. Adding a phase means adding a literal here, in full view of any
 * reviewer of this file, never a dynamically-constructed label.
 */
export type ProgressPhase =
  | "Scanning HEAD"
  | "Parsing files"
  | "Building graph"
  | "Finding anchors"
  | "Reading history"
  | "Analyzing structure";

export interface ProgressReporterOptions {
  /**
   * Explicit enable/disable, overriding the stdout-TTY default gate below.
   * The CLI itself passes `process.stdout.isTTY === true`; tests set this
   * explicitly (`true` or `false`) so both paths are deterministic without
   * a real TTY. Undefined (the CLI's normal case) falls back to the TTY
   * check.
   */
  enabled?: boolean;
  /**
   * Where progress bytes are written. ALWAYS meant to be stderr in
   * production — defaults to `process.stderr.write`, bound so `this`
   * inside the stream implementation stays correct. Tests inject a
   * collector instead of a real stream, same pattern as scan-command.ts's
   * `progressWrite`.
   */
  write?: (chunk: string) => void;
}

export interface ProgressReporter {
  /** Ends the previous phase's line (if any) and starts a new one, printed
   * immediately (never throttled — a phase transition is always real
   * movement, not something worth coalescing). */
  phase(name: ProgressPhase): void;
  /** Updates the current phase's line with a count, optionally out of a
   * known total. Throttled to at most one repaint per ~200ms; calls
   * between repaints are cheap no-ops that don't touch stderr at all. */
  tick(done: number, total?: number): void;
  /** Clears the current progress line in place (no trailing newline) so
   * whatever the command prints to stdout next isn't visually interleaved
   * with a stale progress line still sitting on the terminal. */
  done(): void;
}

// Repaint interval — see this file's header comment: display timing may
// vary run to run (it's driven by Date.now, wall-clock only), but that
// affects ONLY how often a line is repainted, never what a repaint prints
// (formatTick/the fixed phase labels are pure functions of their
// arguments) and never anything about infer.ts's actual classification
// output, which this module has no access to in the first place.
const THROTTLE_MS = 200;

const NOOP_REPORTER: ProgressReporter = {
  phase() {},
  tick() {},
  done() {},
};

function formatTickLine(label: ProgressPhase, done: number, total?: number): string {
  if (total === undefined) return `${label} ${done}`;
  const percent = total > 0 ? Math.floor((done / total) * 100) : 100;
  return `${label} ${done}/${total} (${percent}%)`;
}

/**
 * Builds a progress reporter. Returns a no-op implementation (every call
 * does nothing, no stderr write ever happens) when disabled — so callers
 * (explain-command.ts) can call phase()/tick()/done() unconditionally
 * without their own enabled-guarding.
 */
export function createProgressReporter(opts: ProgressReporterOptions = {}): ProgressReporter {
  const enabled = opts.enabled ?? process.stdout.isTTY === true;
  if (!enabled) return NOOP_REPORTER;

  const write = opts.write ?? ((chunk: string) => void process.stderr.write(chunk));

  let currentLabel: ProgressPhase | null = null;
  let hasWrittenLine = false;
  let lastRenderedLength = 0;
  let lastRepaint = 0;

  // Repaints in place: pads the new line to at least the previous line's
  // length so a shorter new line fully overwrites the old one's leftover
  // characters, then remembers the UNPADDED length for next time (padding
  // is a display-only artifact, not part of the tracked line).
  function repaint(line: string): void {
    const padded = line.padEnd(lastRenderedLength);
    write(`\r${padded}`);
    lastRenderedLength = line.length;
  }

  return {
    phase(name: ProgressPhase): void {
      if (hasWrittenLine) write("\n");
      currentLabel = name;
      lastRenderedLength = 0;
      lastRepaint = Date.now();
      repaint(name);
      hasWrittenLine = true;
    },

    tick(done: number, total?: number): void {
      if (currentLabel === null) return; // tick() before any phase() is a no-op, not an error
      const now = Date.now();
      if (now - lastRepaint < THROTTLE_MS) return; // coalesced: state simply isn't repainted this call
      lastRepaint = now;
      repaint(formatTickLine(currentLabel, done, total));
    },

    done(): void {
      if (hasWrittenLine) {
        write(`\r${" ".repeat(lastRenderedLength)}\r`);
      }
      hasWrittenLine = false;
      lastRenderedLength = 0;
      currentLabel = null;
    },
  };
}
