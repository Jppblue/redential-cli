const KNOWN_PUBLIC_HOSTS = [/github\.com/, /gitlab\.com/, /bitbucket\.org/];

/**
 * Heuristic only — NOT a network-verified "is this actually publicly
 * fetchable" check (that would require a request, and `scan` never makes
 * one). True accessibility depends on the repo's own visibility setting on
 * that host, which only the host itself knows. This only recognizes
 * well-known public-hosting domains and rules out URLs carrying embedded
 * credentials (a strong signal of gated, non-public access).
 *
 * Known host != publicly accessible: the CLI's PRIMARY use case is a
 * private employer repo hosted on github.com, so this must never block
 * scanning — see publicHostWarning below and docs/privacy-tests.md.
 *
 * The real, network-backed check lives in submit.ts's checkVisibilityGate:
 * an anonymous HEAD request made directly to the remote URL itself (never
 * to Redential's servers), gated on isKnownPublicHost being true here
 * first. `scan` never calls it — only `submit`, which already makes
 * network calls, may.
 */
export function isKnownPublicHost(remoteUrl: string | null): boolean {
  if (!remoteUrl) return false;
  if (/:\/\/[^/@]+:[^/@]+@/.test(remoteUrl)) return false; // embedded user:pass or token-as-password
  if (/[?&](?:token|access_token)=/i.test(remoteUrl)) return false; // token in the URL itself
  return KNOWN_PUBLIC_HOSTS.some((host) => host.test(remoteUrl));
}

/**
 * Informational only — returns a message to print, or null. Never a
 * reason to skip scanning: this heuristic can say "this MIGHT be
 * connectable", never "this IS public", so blocking on it would break the
 * CLI's main use case (a private employer repo that happens to be hosted
 * on github.com). The user decides; `scan` always proceeds.
 */
export function publicHostWarning(remoteUrl: string | null): string | null {
  if (!isKnownPublicHost(remoteUrl)) return null;
  return (
    "Note: this repository's remote looks like it's hosted on GitHub, GitLab, or Bitbucket. " +
    "If it's your own project and you can connect it directly, the GitHub App reads the actual " +
    "code and grants a stronger tier than a local metadata scan. If this is a private/employer " +
    "repo you can't connect that way, scanning normally (as below) is the right call — continuing."
  );
}
