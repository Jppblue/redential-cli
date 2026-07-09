# `redential login`, `redential submit`, `redential logout`

`scan` never touches the network (principle 1). These three commands are the
only place the CLI ever does — see [principles.md](principles.md).

```bash
redential login                              # device flow, one time
redential submit --repo <path>                # interactive: prints the bundle, then asks
redential submit --author you@x.com --yes --confirm-upload   # non-interactive
redential logout                              # delete the stored session
```

## `login`: device authorization flow

Standard OAuth 2.0 Device Authorization Grant (RFC 8628) shape — nothing
device-flow-specific existed in Redential's backend at the time this command
was written, so this doc **is** the contract the server implements against,
not a description of something that already existed. `SITE_URL` is public by
design (`https://www.redential.com`, overridable via `REDENTIAL_SITE_URL`
for local development/testing against a mock server).

1. `POST {SITE_URL}/api/cli/device/authorize`, empty body. Response:
   `{device_code, user_code, verification_uri, expires_in, interval}`.
2. The CLI prints `verification_uri` and `user_code`, then makes a
   best-effort attempt to open `verification_uri` in your default browser
   (`open` on macOS, `xdg-open` on Linux, `rundll32 url.dll,FileProtocolHandler`
   on Windows — no shell string on any platform, no new dependency: this
   uses only `node:child_process`). This **reverses** an earlier version of
   this doc, which said the CLI would never do this ("no surprise
   network/process spawn") — most CLIs with a device flow (`gh auth login`,
   `vercel login`, etc.) auto-open, and the printed URL/code were never
   removed as the fallback, so the tradeoff changed. Auto-open is never
   load-bearing: any failure (headless box, SSH session, unknown platform,
   no browser installed, the opener binary missing) is silently swallowed —
   login proceeds exactly as if auto-open didn't exist. `verification_uri`
   is server-controlled, so it's treated as untrusted before being handed to
   a native opener: only `http`/`https` is ever opened (never `file://` or
   an app-custom scheme), and the URL is always its own argv element, never
   interpolated into a shell command.
3. The CLI polls `POST {SITE_URL}/api/cli/device/token` with
   `{device_code}` every `interval` seconds until:
   - `{access_token}`, **HTTP 200** — success, stored locally (see below).
   - `{error: "authorization_pending"}`, **HTTP 400** — keep polling.
   - `{error: "slow_down"}`, **HTTP 400** — keep polling, backing off by 5s.
   - `{error: "access_denied"}` or `{error: "expired_token"}`, **HTTP 400**
     — abort with a non-zero exit code.
   - Polling also aborts once `expires_in` seconds have elapsed without a
     terminal response.

   The endpoint uses HTTP 400 as part of its normal vocabulary — it's the
   status for every `{error: "..."}` shape, not just the terminal ones —
   since RFC 8628's `authorization_pending`/`slow_down` are non-fatal states
   the client is expected to poll through. The CLI's HTTP layer must read
   the body on a 400 from this endpoint instead of treating it as a failed
   request (see `pollJson` in `src/http-client.ts`, used only here — every
   other request in this doc treats non-2xx as a real failure). Any error
   value not listed above (e.g. a malformed request) is treated as an
   unexpected response and aborts, same as a truly unrecognized shape.

Nothing except the device code itself is ever sent during this flow.

## Where the token lives

`credentials.json` in the OS-appropriate per-user config directory
(`config.ts`'s `DEFAULT_CONFIG_DIR`, derived purely from `os.homedir()`,
no env var reads, no dependency):

| Platform | Path |
|---|---|
| macOS / Linux | `~/.config/redential/credentials.json` |
| Windows | `%USERPROFILE%\AppData\Roaming\redential\credentials.json` |

Same directory as the device salt (`salt.ts`), written with mode `0600`.
Contents: `{access_token, site_url, obtained_at}`. `site_url` records which
`SITE_URL` issued the token: `submit` refuses (and asks you to log in
again) if the CLI's current `SITE_URL` doesn't match, so a
`REDENTIAL_SITE_URL` change can never silently send a stored token to a
different host.

**0600 on Windows.** NTFS has no POSIX permission bits, so the `mode: 0o600`
passed to `writeFileSync` is a no-op there — it restricts nothing and
errors on nothing. What actually protects the token on Windows is NTFS ACL
inheritance: a file created under the user's own `%USERPROFILE%\AppData`
tree inherits that directory's ACL, which by default grants access only to
the owning account plus Administrators/SYSTEM — not to other local user
accounts. This is a different mechanism than POSIX mode bits, not a
weaker one for the single-user-machine threat model this CLI assumes, but
it's worth being precise about: it's an OS default, not something this
CLI configures or verifies itself.

`logout` deletes this file. It never touches the device salt (`salt`,
sibling file in the same directory) — the salt is device-local and
unrelated to your session. It also never touches `last-submission.json`
(below): losing your session doesn't change what was actually uploaded.

**`last-submission.json`**, same directory. Written by `submit`
immediately after a successful upload: `{site_url, bundle_hash,
submitted_at}` — a local, unsalted sha256 of the uploaded bundle's content
(see `src/submission-record.ts`'s `bundleContentHash`), never the bundle
itself. Its only purpose is letting a later `scan`'s wrapped summary tell
"already uploaded, nothing new to submit" from "not submitted yet" (see
[docs/scan.md](scan.md#closing-next-step-hint)) — it's read-only bookkeeping,
never sent anywhere, and unlike `credentials.json`/`salt` it isn't written
with restricted file permissions, since it isn't a secret: just a hash of
content you already reviewed and already chose to upload.

## `submit`: review, then upload

`submit` builds the bundle through the **exact same code path** `scan`
uses (`buildBundleInteractively`, shared by both commands) — same author
selection, same authorization-confirmation prompt, same `runScan`. It then:

1. Requires a stored session whose `site_url` matches the current
   `SITE_URL` (`redential login` first, otherwise it refuses).
2. Prints the bundle JSON — byte for byte what step 4 sends. This closes
   the gap `scan`-only builds left open (see
   [privacy-tests.md](privacy-tests.md)): the request body is the literal
   string that was printed, not a re-serialization of the parsed object.
3. Asks "Upload this bundle?" — a **separate** confirmation from the
   "I am authorized to analyze this repository" attestation `scan` already
   requires. `--yes` answers the authorization question (same meaning as
   `scan --yes`); `--confirm-upload` separately answers the upload
   question. Both are required flags for a fully non-interactive `submit`,
   on purpose — consenting to be scanned and consenting to upload are
   different decisions.
4. Runs the remote-visibility gate (below). If it's confirmed public,
   `submit` refuses outright — this is `submit`-only behavior; `scan`
   still only ever warns, never blocks, since `scan` has no network access
   to make the real determination.
5. `POST {SITE_URL}/api/cli/bundles` with `Authorization: Bearer
   <access_token>` and the printed bundle JSON as the body. On success:
   `{id}`. Only the `id` is ever printed back — never the full response
   body, so a change on the server side can't accidentally start echoing
   sensitive content into the terminal.
6. Records the upload locally (`last-submission.json`, above) — not part
   of what's sent, just local bookkeeping for a later `scan`'s next-step
   hint. Unlike the version-check notice below, this is not best-effort:
   a failure here (e.g. an unwritable config dir) surfaces as a real
   error, since silently swallowing it would leave the CTA wrong.

## The remote-visibility gate (submit-only)

`scan`'s `publicHostWarning` is a **local heuristic**: it recognizes
github.com/gitlab.com/bitbucket.org-shaped remote URLs and warns, but
never blocks, because "known host" isn't the same as "publicly
accessible" and `scan` has zero network access to tell the difference —
the CLI's primary use case is a *private* employer repo hosted on
github.com.

`submit` already makes network calls, so it can do better: an anonymous
`HEAD` request straight to the remote URL itself (never to
`SITE_URL` — the remote URL never travels to Redential's servers).

- Only fires for `isKnownPublicHost`-shaped remotes; never probes an
  arbitrary self-hosted URL.
- Never fires if the remote URL carries embedded credentials or a token
  query param — those are gated by definition and the check must never
  turn into an authenticated request the user didn't ask for.
- A confirmed `2xx`/`3xx` response **blocks** submit, with a message
  suggesting the GitHub App instead (it reads the actual code and grants a
  stronger tier than a local metadata scan).
- Anything else — a `4xx`/`401`/`404` (private/gated), a network error, a
  timeout, or a URL that couldn't be converted to something probeable —
  **does not block**. Absence of proof isn't proof of privacy, but this
  check must never be flakier than `scan`'s own warn-only heuristic: on an
  inconclusive result, `submit` falls back to printing the exact same
  `publicHostWarning` message `scan` would have shown, and proceeds.

## Version check (login/submit only — never scan)

After a successful `login` or a successful `submit` upload, the CLI makes
one best-effort, non-blocking `GET` to the public npm registry
(`registry.npmjs.org/@redential%2Fcli/latest`) and prints a one-line notice
if a newer version exists (`src/version-check.ts`). This is the only place
outside the device flow and the bundle upload that this CLI ever reaches
the network, so the boundary is worth stating precisely:

- **What's sent:** nothing about you, your machine, or the repository —
  the request carries no query params, no headers beyond the defaults
  `fetch` sends, and no body. It's indistinguishable from any anonymous
  visitor fetching a public npm package's metadata; it is a *download*
  (checking what exists), not an *upload* (reporting what you did),
  which is the distinction principle 2 ("Explicit... no telemetry") is
  actually drawing — the CLI never phones home with usage data,
  independent of this.
- **When it runs:** only bolted onto `login` and `submit`, and only after
  each has already fully completed its own job — a failing or slow
  registry can never fail or delay the login/upload itself
  (`checkForUpdate` swallows every error and is timeout-bounded; see the
  function's own contract in `src/version-check.ts`).
- **Where it does NOT run — ever:** `scan`. Principle 1 states `scan`
  makes ZERO network calls, no exceptions, and that rule is inviolable
  regardless of how harmless a given call looks in isolation — the whole
  point of `scan` being network-free is that a user can point it at a
  repository under an NDA, an audit, an air-gapped machine, or just
  their own paranoia, and *verify* zero network access (`strace`,
  disabling their network interface, reading `test/privacy/
  zero-network.test.ts`) without having to trust a judgment call about
  which outbound calls are "safe." `checkForUpdate` deliberately never
  references `fetch`/`http`/`https` directly — it goes through
  `http-client.ts`'s `getJson` — so a plain grep for network APIs
  couldn't catch it being wired into `scan`'s call graph by mistake.
  `test/privacy/zero-network.test.ts` encodes the actual rule instead:
  `version-check.ts` may only ever be imported by `login.ts`/
  `submit-command.ts`; that test fails if it's ever imported from
  `scan.ts`, `scan-command.ts`, `build-bundle.ts`, or anywhere else in
  scan's dependency graph, regardless of whether the import itself
  references a network API literally. This was reviewed explicitly as a
  sensitive-zone change before being merged.

## Error handling

Every command-level error is one of `ScanError` / `AuthError` /
`SubmitError` / `NetworkError` (`src/errors.ts`). `NetworkError` messages
are built only from the request's host and HTTP status — never from
response headers or body — so a failed request can never echo a bearer
token or bundle content into a printed error. EOF on any interactive
prompt (attestation, author selection, or `submit`'s upload confirmation)
aborts with a non-zero exit code rather than hanging or silently
proceeding, consistent with `scan`'s existing prompts.
