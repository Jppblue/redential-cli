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
