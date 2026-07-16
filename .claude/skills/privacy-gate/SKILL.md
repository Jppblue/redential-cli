---
name: privacy-gate
description: Run this repo's privacy review against your changes before opening a PR — the same gate maintainers apply. Use it before any PR, and always before one touching detection, schema, network code, or anything that could change what data leaves the machine.
---

# Privacy gate

This repo's product is trust: the CLI promises that source code never
leaves the machine and that everything which does leave is bounded,
reviewable, and enumerable. Every PR is reviewed against that promise.
This skill is the same review, run by you (or your agent) first, so the
PR arrives already clean.

Authoritative sources — this skill summarizes them, they win on conflict:
[docs/principles.md](../../../docs/principles.md),
[docs/privacy-tests.md](../../../docs/privacy-tests.md),
[CONTRIBUTING.md](../../../CONTRIBUTING.md) ("The privacy rule").

## Step 1 — the boundary question (before anything else)

Does the diff change WHAT data leaves the user's machine, or WHERE it is
sent? Tripwires — any one means YES:

- A new or changed field in the bundle (anything under `schema/`).
- Any edit to `taxonomy.json`, or to hashing/salting (`src/hash.ts`,
  `src/salt.ts`).
- A new network call anywhere, or any edit to `src/login.ts`,
  `src/submit.ts`, `src/submit-command.ts`, `src/http-client.ts`.
- Any edit to `src/secret-scan.ts` or `src/public-remote.ts`.

If YES: **stop before writing more code.** The repo requires a prior
discussion issue (the "Data boundary change" issue template) where the
schema version bump and `docs/schema.md`/`CHANGELOG.md` entries are
agreed first. A PR in these areas without a prior issue will not be
merged, regardless of quality.

## Step 2 — run the contract

```bash
npm test           # includes test/privacy/ — the contract
npx tsc --noEmit
```

If a test under `test/privacy/` fails, the change is wrong, not the
test. Do not adjust a privacy test to make a change pass; that inverts
the whole model.

## Step 3 — mechanical sweeps over the diff

Run each against your branch's diff (`git diff main...HEAD`):

```bash
# Network surface: scan/explain must make ZERO network calls. Direct network
# primitives are allowed in exactly three files (test/privacy/zero-network.test.ts):
# http-client.ts, login.ts, submit.ts; submit-command.ts only imports them.
git diff main...HEAD -- src ':(exclude)src/login.ts' ':(exclude)src/submit.ts' \
  ':(exclude)src/submit-command.ts' ':(exclude)src/http-client.ts' \
  | grep -nE '^\+.*(fetch\(|https?://|net\.|dgram|WebSocket)'

# Closed vocabulary: skill slugs live in taxonomy.json and signatures/, never in
# src/. The alternation mirrors taxonomy.json's full category set — if a new
# category lands there, add it here too.
git diff main...HEAD -- src | grep -nE '^\+.*"(auth|payments|ai|db|backend|frontend|infra|data|queues|testing|observability|email|realtime|storage)/'

# Supply chain: any new dependency requires written justification in the PR.
git diff main...HEAD -- package.json

# No postinstall scripts, ever.
grep -n 'postinstall' package.json
```

An empty result on each sweep is the expected state. A hit is not
automatically a violation — but it must be explained in the PR
description, in writing.

## Step 4 — if the diff touches detection

Signature changes have their own contract (fixtures, near-miss
negatives, dead-pattern checks) — run the `add-signature` skill in this
directory, or read [docs/signatures.md](../../../docs/signatures.md).

## Step 5 — report in the PR

Paste a short block in the PR description:

```
Privacy gate: run
- Boundary question: NO (or: YES — prior issue #NN)
- npm test / tsc: green
- Sweeps: clean (or: hit in <file>, explained below)
```

A PR that arrives with this block gets reviewed faster, because it
answers the reviewer's first four questions up front.
