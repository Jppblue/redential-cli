# Contributing

Thanks for your interest. This project has one unusual rule, read it first.

## The privacy rule

Any PR that changes WHAT data leaves the user's machine, or WHERE it is sent,
must start as a discussion issue BEFORE any code is written. This includes:
new bundle fields, changes to hashing/salting, network calls, and anything in
`src/privacy/` or `schema/`. PRs in these areas without a prior issue will be
closed regardless of code quality — sorry, the trust contract comes first.

Everything else (bug fixes, performance, DX, docs, tests): PRs welcome
directly.

## Adding a skill signature (most common contribution)

If a technology's import unambiguously identifies it, this is a one-line
PR — no discussion issue needed, since it only adds a taxonomy-valid slug
to public data, never code:

```json
"some-new-package": "category/slug"
```

added to `signatures/package-map.json`. If `category/slug` doesn't exist
yet, add it to `taxonomy.json` first — a map entry naming a slug outside
`taxonomy.json` fails to load. If the import alone is ambiguous, or there's
no import at all (a config file, a framework-inherited API), write a
Tier 2 signature file at `signatures/<category>/<name>.json` instead, with
at least one positive and one negative fixture. Full detection rules and
the exact test contract: [docs/signatures.md](docs/signatures.md).

Either way: run `npm test` (it picks up new map entries and signature
files automatically) and add a line to `CHANGELOG.md` under `[Unreleased]`
before opening the PR.

## Ground rules

- The privacy test suite (`test/privacy/`) is the contract. If your change
  breaks one of those tests, the change is wrong, not the test.
- No new runtime dependencies without written justification in the PR.
- No postinstall scripts. No telemetry. Ever.
- Schema changes require a version bump and an entry in `docs/schema.md`.
- Every feature ships with a doc in `docs/` and a CHANGELOG entry.

## Dev setup

```bash
npm install
npm test        # unit + privacy suite (creates git fixtures in tmpdir)
npm run build   # tsc to dist/
```

Tests create throwaway git repositories programmatically — no fixture repos
with real history are committed to this repo.

## Reporting security issues

Do NOT open a public issue. See SECURITY.md.
