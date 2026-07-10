/**
 * Informational only — same "warn, never block" stance as
 * public-remote.ts's publicHostWarning. A shallow clone (`git clone
 * --depth N`, or CI checkout actions that default to one) is missing
 * history before its shallow boundary entirely: `repo.age_days`, span,
 * and commit counts would all silently understate the repo's real
 * activity with no indication why, unless the user is told. Never a
 * reason to refuse scanning — a partial-but-honest bundle beats none.
 */
export function shallowRepoWarning(): string {
  return (
    "Note: this repository is a shallow clone — commit history before the shallow boundary " +
    "isn't available locally, so age, span, and commit counts in this bundle may understate " +
    "your real activity. Run `git fetch --unshallow` first for a complete picture — continuing " +
    "with what's available."
  );
}
