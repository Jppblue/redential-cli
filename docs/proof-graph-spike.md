# Proof graph spike

This is an EXPERIMENTAL spike. It lives entirely on branch
`proof-graph-spike` and is never merged into `main` or released without an
explicit go decision from the owner. Nothing described here ships, changes
the bundle schema, or affects `scan`/`submit` on `main` unless and until
that decision is made — this doc records the spike's scope so the decision
can be made on real evidence.

## Goal

Today, skill detection (see [docs/signatures.md](signatures.md)) is
import-based: a package name in an added line maps, deterministically, to a
taxonomy slug. That is precise but shallow — it can say "this commit
imported `stripe`," not "this commit actually wired a webhook handler."

This spike evaluates a structural alternative: instead of matching a single
line, follow connected relations in the code (a function that verifies a
Stripe webhook signature, feeding a database write, guarded by an
idempotency check) and infer a skill from that shape, with evidence for
why it was inferred.

The spike is deliberately narrow: ONE language (TypeScript) and ONE area
(payments — Stripe webhook verification → DB write → idempotency guard),
producing exactly one closed-vocabulary slug:
`payments/payment-webhook-flow`. The question the spike answers is whether
structural inference is worth the added complexity compared to import
matching — not to build a general-purpose code-understanding engine.

## Approved decisions

1. **Parser = the TypeScript compiler API (the `typescript` package),
   behind a `ParserAdapter` layer. NOT tree-sitter, NOT wasm.**
   Rationale: zero new dependencies and zero binary blobs in a
   trust-focused public repo — every third-party PR reviewer should be able
   to audit what's parsing the user's code without adding a new
   supply-chain surface. The spike's actual question ("does structural
   inference beat import matching?") is parser-agnostic — it doesn't depend
   on which parser produces the AST. Putting the TypeScript compiler API
   behind an adapter keeps a future tree-sitter migration, if and when a
   second language arrives and a single multi-language parser becomes
   worth the dependency discussion, down to hours of adapter-swapping
   rather than a rewrite.

2. **The structural signal stays OUT of the bundle for the whole spike.**
   Zero changes to `schema/bundle.v1.json`, `src/build-bundle.ts`, or
   `submit`. The spike ships only a documented draft of what the future
   signal could look like (see below) — never a working code path that
   writes it into a real bundle. This is intentional: CLAUDE.md requires a
   prior discussion issue, a schema version bump, a `docs/schema.md`
   entry, a `CHANGELOG.md` entry, and new privacy tests for any change to
   WHAT data leaves the machine. That ceremony is real work with real
   review cost, and doing it before the spike has evidence that structural
   inference is worth shipping would be backwards. It is DEFERRED until an
   explicit go decision.

## Invariants

These hold for the whole spike, unconditionally:

- **Zero network** — identical to `scan` today. The graph is built and
  walked entirely from a local `git show`/`git diff` read.
- **Zero LLM, deterministic** — the same commit produces the same graph and
  the same classification every time. No remote inference, no sampling.
- **In-memory only** — the graph lives only in memory for the duration of
  the process and dies with it. It is never serialized to disk, never
  written to `scan` output, and never included in the bundle.
- **Closed vocabulary** — the only slug the spike can ever infer is
  `payments/payment-webhook-flow`, and only because that slug is present in
  `taxonomy.json`. No skill inference of any kind can name a slug outside
  the taxonomy.

## Scope and milestones

- **H0** — branch, slug, this doc.
- **H1** — parser adapter (`ParserAdapter` wrapping the TypeScript compiler
  API) + a HEAD snapshot reader + an in-memory graph structure.
- **H2** — anchor recognizers for the three nodes (webhook signature
  verification, DB write, idempotency guard) + `DIRECT` / `INFERRED` /
  `AMBIGUOUS` classification of the connected shape + user attribution by
  file intersection with the selected author's commits. Hard timebox: if
  binding resolution (tracing which variable flows into which call) proves
  unreliable within the milestone's timebox, degrade to a coarser signal —
  module co-location plus import edges — and document that degradation
  here rather than letting the milestone run long chasing precision.
  Outcome: full receiver resolution (see `src/proof-graph/anchors.ts`'s
  `resolveReceiver`) shipped as originally planned for every recognizer. The
  one narrow, documented fallback to file-level import co-location is
  scoped ONLY to supabase/knex DB-writes, because their common calling
  idiom (`supabase.from('orders').insert(...)`, `knex('users').insert(...)`)
  invokes the table selector as a function, which collapses to a wildcard
  chain segment in the parser's syntactic model (`chainOf`'s "*" convention
  — see `parser-adapter.ts`) and leaves no root name for `resolveReceiver`
  to resolve. The blanket degradation the timebox above allowed for
  ("module co-location plus import edges" for everything) was NOT needed.

  ### Attribution rule (H2)

  A structural finding (`src/proof-graph/infer.ts`) is only ever `claimed`
  when at least one of the anchor-containing files that support it
  intersects the selected author's own added-lines file set — the same
  diff-based primitive `scan` already uses for skill detection
  (`getCommitsAddedLines`, batched the same way as
  `skill-detect.ts`'s `detectSkills`), never `git blame`. This is
  deliberately file-level, not function-level, matching the Exclusions
  section's "No per-function blame": the question asked is "did the user's
  own diff touch this file," not "which line did they write." An
  `AMBIGUOUS` finding computes attribution the same way but never claims
  regardless of the result (see `StructuralFinding.claimed`'s own comment)
  — attribution only ever upgrades a `direct`/`inferred` finding from
  unclaimed to claimed, it never changes an ambiguous finding's status.
- **H3** — programmatic tmpdir fixtures (git repos built in test setup, per
  CLAUDE.md's testing conventions — never committed fixtures with real
  history), including the deliberate false-negative case: Stripe imported
  but structurally unused (no signature verification call reachable from
  the webhook handler) classifies as `AMBIGUOUS` and the skill is NOT
  claimed.
- **H4** — a local-only `redential explain <skill>` command surfacing the
  classification and evidence for inspection. Local only — no network, no
  effect on `scan`/`submit`.
- **H5** — final report: what worked, what didn't, the draft bundle signal
  below evaluated against real fixtures, and a go/no-go recommendation for
  the owner.

### Local explain command (H4)

`redential explain <skill>` prints a local, human-readable breakdown of the
structural tier's classification for one HEAD snapshot — no network call, no
file written anywhere, no `--json`/machine-readable mode.

Usage:

```
redential explain payments/payment-webhook-flow [--repo <path>] [--author <email> ...]
```

`<skill>` must be a slug in `taxonomy.json`. In the spike, only
`payments/payment-webhook-flow` (`STRUCTURAL_SKILL_SLUG`,
`src/proof-graph/infer.ts`) is actually explainable — this is the spike's one
target shape. Any other valid taxonomy slug (e.g. `payments/stripe`, a
plain import-matching slug) gets a friendly "not covered by explain in the
spike" message and exits 1: the structural tier's whole point is the
payments/webhook shape, and generalizing `explain` to Tier 1's import
matches is out of this milestone's scope. An unknown slug (not in
`taxonomy.json` at all) is a usage error citing `taxonomy.json` as the
vocabulary source, also exit 1.

What it shows: the skill's slug and taxonomy label; the classification
(`DIRECT`/`INFERRED`/`AMBIGUOUS`) with a one-line meaning; the matched
anchors grouped by kind (webhook-verification / db-write /
idempotency-guard), each with its file path, enclosing function, line, and
the `reason` string the recognizer produced; how the anchors connect
(rendered as a plain "`a.ts -> b.ts -> c.ts`" chain for a cross-file
INFERRED finding, derived from the graph's own resolved import edges — see
`src/explain-command.ts`'s `renderConnection`); the attribution verdict
(which anchor file(s), if any, intersect the selected author's own
added-lines diff) and why; and whether the skill is claimed. A repository
with no structural finding at all prints a friendly "not detected" message
and exits 1.

For an `AMBIGUOUS` finding, the output states explicitly that the skill is
**not claimed**, why (pattern not connected closely enough, or an anchor
kind is missing entirely), and that an ambiguous finding can never enter a
`scan`/`submit` bundle regardless of attribution — matching the "Draft
bundle signal" section below.

Author selection is deliberately **non-interactive**, unlike `scan`'s
prompted picker: `scan`'s interactive confirmation exists because a bundle
is about to be built and uploaded, so getting "this is really me" right
matters for what leaves the machine. `explain` never builds or sends
anything — it's a read-only local diagnostic that should run unattended (by
a script, by a test, by a developer piping it around). It defaults to the
repo's own `git config user.email` if set, and `--author <email>`
(repeatable) always overrides that default. If the resolved author
identity(ies) matched no commits at all, `explain` still runs full
detection over the HEAD snapshot (detection is independent of attribution)
and honestly reports "no commits found for `<email(s)>`" rather than
silently producing a misleading verdict.

Screen-vs-bundle boundary: everything `explain` prints (paths, function
names, line numbers, reasons) is local, on-screen-only output — printing it
to the user's own terminal is correct and never leaves the machine that
way. It is not, and must never become, part of `scan`'s bundle or anything
`submit` uploads — see this document's "Invariants" above and
`StructuralFinding`'s own comment in `src/proof-graph/infer.ts`. No
`--json` flag exists on purpose: a structured output mode would be a
standing invitation for some other tool to capture and persist a
serialization of the in-memory graph, which the "In-memory only" invariant
above forbids.

## Exclusions

Explicitly out of scope for this spike:

- No pattern DSL in `signatures/*.json` — the spike's pattern is
  TypeScript code (the parser adapter and recognizers), not signature data.
- No schema or bundle changes of any kind.
- No second language and no second area beyond the one payments/webhook
  shape described above.
- No tsconfig paths/aliases resolution, no monorepo workspace resolution,
  no DI container resolution, no cross-file value tracking, no
  type-checker — the spike works off syntactic structure, not full
  semantic resolution.
- No per-commit graph over history — HEAD snapshot only, not a graph
  rebuilt or diffed across the commit range the way `scan` walks commits
  today.
- No graph persistence or cache on disk, anywhere, at any milestone.
- No per-function blame — attribution is file-level (does the file
  intersect the selected author's touched files), not function-level.
- No `CHANGELOG.md` entry during the spike. This is a deliberate departure
  from CLAUDE.md's usual "every feature gets a CHANGELOG entry" rule,
  noted here on purpose: the spike ships nothing user-facing on `main`, so
  there is nothing to log yet. The entry lands with the go decision, if
  and when it happens.

## Draft bundle signal (not implemented)

This section is a draft only — none of it is wired into
`schema/bundle.v1.json`, `src/build-bundle.ts`, or any code path that runs
today. It exists so H5's report can evaluate a concrete proposal rather
than a vague one.

If a future go decision approves this direction, `detected_skills[]`
entries could gain two optional fields:

- `evidence`: `"import"` | `"structural"`
- `confidence`: `"direct"` | `"inferred"`

Both are closed enums — no free-form text, consistent with the rest of the
bundle's "Bounded output" guarantee (see
[docs/principles.md](principles.md)). `AMBIGUOUS` never travels in the
bundle under any field: ambiguous means the skill is not claimed at all,
full stop. The only place an `AMBIGUOUS` classification is ever visible is
local feedback via `redential explain`. No node or edge counts of the graph
are ever proposed for the bundle either — a count is still a value derived
from code shape, and this draft stays deliberately conservative about what
crosses the boundary.

## Dependency note

H1 moves `typescript` from `devDependencies` to `dependencies` (same
`^5.6.0` range). This is a **role change, not a new dependency**:
`typescript` is already present in this repo's tree today, as the dev-only
compiler used by `npm run build`/`typecheck`. Nothing new enters the
supply chain; what changes is that it now also runs at CLI runtime, so it
needs the written justification CLAUDE.md's "ZERO new dependencies without
written justification" policy requires, applied to this narrower case:

- **Why it's needed at runtime**: the spike parses TypeScript sources (see
  `src/proof-graph/parser-adapter.ts`) with the TypeScript compiler API —
  that's the whole point of the `ParserAdapter` decision above. A
  dev-only `typescript` wouldn't be present when a published CLI actually
  runs `scan`, so the package has to ship as a real dependency for the
  parser to work outside this repo's own dev environment.
- **Usage stays parse-only**: only `ts.createSourceFile` plus a plain AST
  walk over its output. No `ts.createProgram`, no type-checker, no
  `ts.sys` filesystem or network access — `TscParserAdapter` never touches
  disk itself, only the source text it's handed. That keeps the runtime
  dependency's surface to "turn source text into a syntax tree," not the
  full compiler.
- **Why not a lighter alternative**: a hand-rolled or regex-based
  TypeScript parser is exactly the false-positive surface this spike
  exists to eliminate — `docs/signatures.md`'s import tier already
  accepts that tradeoff deliberately for import matching, but the whole
  premise of the structural tier is that regex-based "parsing" of
  arbitrary code shapes is unreliable in ways a real parser isn't (see
  the "headline advantage" comments in
  `test/proof-graph/parser-adapter.test.ts` — import-shaped text inside
  comments/template literals produces nothing, for free, precisely
  because a real parser understands what a comment or a string is).
  tree-sitter was considered and explicitly rejected for this spike — see
  "Approved decisions" above — because it would be a genuinely new
  dependency (a native/wasm parser generator) for the same job the
  TypeScript compiler API already does with a role change, not an
  addition.
- **Supply-chain profile**: zero install scripts, pure JS (no native
  binary blobs to audit), no network access of its own, and it was already
  being pulled into every contributor's `node_modules` as a dev
  dependency before this change — the audit surface for a PR reviewer is
  "does this file only call `createSourceFile` and read its output,"
  not "should this package be trusted at all."

## Spike results and recommendation (H5)

This section closes the spike. It reports what was actually measured
(H1–H4), not a restatement of intent, and ends with a go/no-go
recommendation for the owner.

### a. Measured results

All five programmatic fixtures (`test/proof-graph/fixtures.ts`,
exercised end to end in `test/proof-graph/detection.test.ts`) classified
as designed on the **first run** in H3 — no fixture tuning, no assertion
loosening, to get any of them to pass:

| Fixture | Classification | Attribution | Claimed |
| --- | --- | --- | --- |
| `fixtureDirectPattern` — one file, all three anchors in one function | `direct`, `same-function` (edgeDistance 0) | attributed | yes |
| `fixtureLayeredPattern` — handler → service → repo, three files, relative imports only | `inferred`, `cross-file`, edgeDistance 2 | attributed | yes |
| `fixtureStripeUnused` — Stripe imported, never wired into a webhook flow | `ambiguous` | n/a (ambiguous never claims) | no — while Tier 1 import matching still reports `payments/stripe` on the same commit |
| `fixtureOtherAuthor` — full pattern present, but committed by a different author | `direct` | not attributed | no |
| `fixtureCommentsOnly` — stripe/prisma/constructEvent only inside comments and a template-literal string | no finding at all (`findAnchors` returns `[]`) | n/a | n/a |

Graph-build timing, measured today against this repo's own HEAD (not a
fixture — this repo's real, non-trivial TypeScript ESM tree):
snapshot + parse + build over **80 files** completed in **181.9ms**
(`test/proof-graph/e2e-smoke.test.ts`; H1 measured ~135–157ms over 64
files — the repo has grown by 16 files since and stayed well under
200ms). Against the spike's "single-digit seconds" criterion, this is
roughly two orders of magnitude under budget.

### b. Timebox outcome (H2)

The blanket degradation H2's timebox allowed for ("module co-location
plus import edges" for every recognizer, if binding resolution proved
unreliable) was **not triggered**. Full receiver resolution shipped as
originally planned — import binding → same-file `new`/call binding → one
alias hop (`src/proof-graph/anchors.ts`'s `resolveReceiver`) — for every
recognizer.

The one narrow, documented fallback: supabase/knex DB-writes fall back
to file-level import co-location instead of receiver resolution. Their
common calling idiom (`supabase.from('orders').insert(...)`,
`knex('users').insert(...)`) invokes the table selector as a function
call, which collapses to a wildcard ("*") chain segment in the parser's
syntactic model (`parser-adapter.ts`'s `chainOf` convention) and leaves
no root name for `resolveReceiver` to resolve against. What was lost:
per-receiver certainty for those two packages only — every other
recognizer (Stripe signature verification, Prisma/generic DB writes,
idempotency guards) got full resolution. What recovering it would take:
modeling call-result receivers in the parser (chains rooted at a call
expression, not just an identifier), a bounded parser-adapter extension
— not a rewrite.

### c. Draft bundle signal

The "Draft bundle signal (not implemented)" section above stays the
source of truth for the proposed shape (`evidence`/`confidence` closed
enums on `detected_skills[]`). On a GO decision, the following ceremony
is **pending and entirely deferred** — none of it happens as part of
closing this spike:

- A prior discussion issue (per CLAUDE.md's "any change to WHAT data
  leaves the machine requires a prior discussion issue").
- A schema version bump: `schema/bundle.v1.json` stays untouched by the
  spike; landing this signal would move it `1.1.0 → 1.2.0` (minor —
  additive, optional fields, backward compatible).
- A `docs/schema.md` entry documenting the two new fields.
- A `CHANGELOG.md` entry (the spike itself deliberately has none, see
  "Exclusions" above; the entry lands with the go decision).
- New privacy tests for the two enum fields, in `test/privacy/`,
  following this spike's own `test/privacy/proof-graph-boundaries.test.ts`
  pattern (structural source-inspection plus a real end-to-end bundle
  assertion) — extended to prove the closed-vocabulary property holds for
  `evidence`/`confidence` the same way `taxonomy.json` already
  mechanically bounds `detected_skills[].slug`.

Nothing above is implemented as part of H5. This is a checklist for the
next milestone, contingent on a GO decision.

### d. Migration & DSL thresholds

- **Parser migration** (`typescript` compiler API → tree-sitter): only
  when a second language lands. The `ParserAdapter` interface
  (`src/proof-graph/parser-adapter.ts`) is the seam already built for
  this — swapping the adapter's implementation behind the same interface
  is estimated as an adapter-swap, not a rewrite of the graph/anchors/
  infer layers above it, none of which touch `ts.*` types directly.
- **Declarative pattern DSL** in `signatures/*.json`: only once 3+ real
  structural patterns exist beyond the current payments/webhook one. One
  pattern is code (what this spike built); three patterns is the point
  at which a shared abstraction across patterns becomes visible enough
  to design well, rather than guessed at from a single example.

### e. Known minor issues

Carried over honestly from the milestone reviews, all non-blocking:

- `webhookHits` (`src/proof-graph/anchors.ts`) carries an unused `graph`
  parameter.
- pg's `ON CONFLICT` check scans all string arguments of a call, so an
  `ON CONFLICT` string literal in a different argument position than the
  actual write-shaped argument would count as a match.
- `test/privacy/proof-graph-boundaries.test.ts`'s `stripComments` helper
  assumes no `//` or `/*` appears inside a string literal anywhere in
  `src/proof-graph/*.ts` (documented in the test itself, verified true
  today by inspection) — a self-enforcing check that asserts this
  assumption rather than just asserting it in a comment would be nicer,
  but wasn't built.
- On Windows, `listFixtureFiles` (`test/privacy/proof-graph-boundaries.test.ts`)
  yields backslash-separated paths, which makes the full relative-path
  negative assertions trivially true there (a bundle containing a
  forward-slash path won't match a backslash-joined string) — the
  basename and function-name negative assertions in the same test still
  catch a real leak on Windows, so the boundary check isn't blind there,
  just weaker on one of its three signals.

### f. GO / NO-GO recommendation

**Recommendation: GO** — evaluate the ceremony in section c above as the
next milestone, with the calibration step below as its first task.

The evidence: every fixture classified correctly on the first run, with
no loosening to make them pass. The deliberate false negative
(`fixtureStripeUnused` → `ambiguous`, unclaimed, even though Tier 1 import
matching still reports `payments/stripe` on the same commit) works and
is the anti-inflation property plain import matching structurally cannot
offer — it is the whole reason this spike exists. The attribution gate
(file-level intersection with the selected author's own touched files,
`fixtureOtherAuthor`) works. Performance is roughly two orders of
magnitude under the "single-digit seconds" budget, measured on this
repo's own real 80-file tree, not a toy fixture. The privacy boundary is
mechanically enforced, not just documented: module-boundary
(`test/privacy/proof-graph-boundaries.test.ts`'s import-reference check)
and serialization-surface (its `toJSON`/`JSON.stringify`/file-write scan)
tests both survived adversarial mutation during milestone review, and
this H5 task additionally hardened the previously-flat static
network-API scan in `test/privacy/zero-network.test.ts` to walk `src/`
recursively, closing the one gap where `src/proof-graph/*.ts` could have
escaped it.

Honest caveats: all of this evidence is at synthetic-fixture scale — one
structural pattern, one language, five small programmatically-built
repos. The `AMBIGUOUS` rate on real-world layered codebases (where
webhook verification, DB writes, and idempotency guards are often spread
across more files, more indirection, and more framework-specific
plumbing than any fixture here models) is **unmeasured**, and is the
single biggest open risk — a structural tier that classifies most
real payment-webhook code as `ambiguous` would be strictly worse than
Tier 1 import matching for this specific slug, defeating the spike's own
purpose. The recommended first post-go step, before any schema ceremony
in section c, is a calibration pass: run the structural tier's detection
(no bundle writing, no schema change — just `redential explain` or an
equivalent script) over a handful of real, permission-cleared TypeScript
repos with known payment-webhook code, and check the `ambiguous` rate
before spending any review cost on the ceremony above.

A no-go was a valid outcome of this spike — the timebox in b, the
`AMBIGUOUS` gate in the fixtures, and the honest listing of known issues
in e were all designed to surface a no-go if the evidence pointed there.
It didn't: nothing in H1–H4 forced a fallback, no fixture needed
loosening, and the privacy boundary held under adversarial review. The
evidence points to GO, with the calibration caveat above carried
forward as the first thing to check before committing further review
cost.
