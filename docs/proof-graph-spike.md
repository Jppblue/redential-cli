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

Placeholder for H1: moving `typescript` from `devDependencies` to
`dependencies` is a role change, not a new dependency — `typescript` is
already present in this repo's dependency tree today as a dev-only tool.
H1 will need a written justification for that move (what it now needs to
do at runtime, why the compiler API specifically, why not a lighter
alternative) before the change lands, per CLAUDE.md's "ZERO new
dependencies without written justification" policy applied to this
narrower case.
