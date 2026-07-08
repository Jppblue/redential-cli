import { NetworkError } from "./errors.js";

/**
 * The only module allowed to call `fetch` for JSON requests (login.ts and
 * submit.ts are the other two — see test/privacy/zero-network.test.ts's
 * allowlist). Error messages are built from the URL's host and the HTTP
 * status only, never from response headers or body, so a failure can never
 * echo a bearer token or bundle content back into a printed error.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NetworkError(`Could not reach ${host}.`);
  }
  if (!res.ok) {
    throw new NetworkError(`Request to ${host} failed with status ${res.status}.`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new NetworkError(`Response from ${host} was not valid JSON.`);
  }
}

/**
 * Same as postJson, but sends `rawBody` verbatim instead of re-serializing
 * an object — used by submit so the bytes on the wire are byte-identical to
 * the bytes printed for user review (principle 4, "User-reviewed").
 */
export async function postRawJson<T>(
  url: string,
  rawBody: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: rawBody,
    });
  } catch {
    throw new NetworkError(`Could not reach ${host}.`);
  }
  if (!res.ok) {
    throw new NetworkError(`Request to ${host} failed with status ${res.status}.`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new NetworkError(`Response from ${host} was not valid JSON.`);
  }
}

/**
 * Anonymous HEAD request used only by submit's remote-visibility gate — the
 * request target is the repo's own remote host, never SITE_URL. Returns
 * null (not a thrown error) on any network failure/timeout: an inconclusive
 * check must never be treated as a confirmed answer either way.
 */
export async function headRequest(url: string, timeoutMs: number): Promise<{ status: number } | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status };
  } catch {
    return null;
  }
}
