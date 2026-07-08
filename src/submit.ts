import { NetworkError } from "./errors.js";
import { isKnownPublicHost, publicHostWarning } from "./public-remote.js";
import { headRequest, postRawJson } from "./http-client.js";

const HEAD_TIMEOUT_MS = 5000;

/**
 * Converts a git remote URL (https, scp-like `git@host:org/repo.git`, or
 * `ssh://`) into an https URL worth HEAD-requesting. Only ever called after
 * isKnownPublicHost has already confirmed the URL carries no embedded
 * credentials or token, so nothing sensitive can end up in the probe.
 */
function toProbeUrl(remoteUrl: string): string | null {
  const scpMatch = !remoteUrl.includes("://") && remoteUrl.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/);
  if (scpMatch) {
    const [, host, path] = scpMatch;
    return `https://${host}/${path.replace(/\.git$/, "")}`;
  }
  try {
    const u = new URL(remoteUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "ssh:") return null;
    return `https://${u.host}${u.pathname.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

export interface VisibilityCheck {
  /** true = submit must refuse; a confirmed-public remote or an
   * inconclusive one are both `false` (fail-open — see docs/login-submit.md). */
  blocked: boolean;
  message: string | null;
}

/**
 * Only probes known-public-host remotes (github.com/gitlab.com/bitbucket.org
 * shaped, per public-remote.ts) — never an arbitrary self-hosted URL. A
 * confirmed 2xx/3xx blocks submit; anything else (private, unreachable,
 * unparseable) proceeds, matching scan's "known host != publicly
 * accessible" stance and the advisor-required fail-open behavior for
 * network blips.
 */
export async function checkVisibilityGate(
  remoteUrl: string | null,
  probeFn: (url: string, timeoutMs: number) => Promise<{ status: number } | null> = headRequest
): Promise<VisibilityCheck> {
  if (!isKnownPublicHost(remoteUrl)) return { blocked: false, message: null };

  const probeUrl = toProbeUrl(remoteUrl!);
  if (!probeUrl) return { blocked: false, message: publicHostWarning(remoteUrl) };

  const result = await probeFn(probeUrl, HEAD_TIMEOUT_MS);
  if (result === null) {
    // Inconclusive (network error, timeout, host down) — never louder than
    // scan's own warning, never treated as a confirmed answer either way.
    return { blocked: false, message: publicHostWarning(remoteUrl) };
  }
  if (result.status >= 200 && result.status < 400) {
    return {
      blocked: true,
      message:
        "Refusing to submit: this repository's remote answered as publicly reachable " +
        `(HTTP ${result.status}). Connect the GitHub App instead — it reads the real code ` +
        "and grants a stronger tier than a local metadata scan. If this repo is actually " +
        "private, this check was wrong; please report it.",
    };
  }
  return { blocked: false, message: null };
}

interface SubmitResponse {
  id: string;
}

/**
 * `bundleJson` must be the exact string already shown to the user (see
 * submit-command.ts) — sent verbatim via postRawJson, never re-derived from
 * the parsed object, so what was reviewed is byte-for-byte what is sent.
 */
export async function postBundle(siteUrl: string, accessToken: string, bundleJson: string): Promise<SubmitResponse> {
  const response = await postRawJson<SubmitResponse>(`${siteUrl}/api/cli/bundles`, bundleJson, {
    authorization: `Bearer ${accessToken}`,
  });
  if (typeof response.id !== "string") {
    throw new NetworkError("Unexpected response from the submit server.");
  }
  return response;
}
