// H2 of the proof-graph spike (see docs/proof-graph-spike.md), part 1 of 2:
// anchor recognizers for the three nodes the spike's one target shape needs
// (webhook signature verification, DB write, idempotency guard). Part 2
// (connected-shape classification into DIRECT/INFERRED/AMBIGUOUS) consumes
// this file's `findAnchors` output and MUST NOT need any change to this
// module's exported contract — see the AnchorKind/AnchorHit/findAnchors
// signatures below, which are load-bearing for that sibling task.
//
// Same posture as parser-adapter.ts and graph.ts: deterministic, in-memory,
// zero network, no type-checker — every rule below is "does this syntactic
// shape unambiguously say so," never a guess or a heuristic score. A call
// this module can't confidently place is simply not a hit; there is no
// partial-confidence output anywhere in this file.
import type { ParsedCall, ParsedFile } from "./parser-adapter.js";
import type { ProofGraph } from "./graph.js";

export type AnchorKind = "webhook-verification" | "db-write" | "idempotency-guard";

export interface AnchorHit {
  kind: AnchorKind;
  path: string;
  enclosingFunction: string | null;
  line: number;
  // Short, stable English description of which rule fired and, where
  // relevant, how the receiver was resolved — meant for a future LOCAL-only
  // `redential explain` command (see docs/proof-graph-spike.md's H4). Never
  // serialized into a bundle, never leaves the machine, same as every other
  // structure in this spike.
  reason: string;
  // OPTIONAL, set ONLY on "webhook-verification" hits (H6 multi-provider
  // generalization): which WEBHOOK_PROVIDERS descriptor (below) produced
  // this hit, carried as the taxonomy slug that descriptor maps to — e.g.
  // "payments/payment-webhook-flow" for Stripe. Added as an optional field
  // rather than a required one so every existing AnchorHit-shaped test
  // fixture and assertion (toMatchObject / field-by-field checks throughout
  // test/proof-graph/anchors.test.ts) keeps compiling and passing unchanged;
  // none of them do an exact-shape toEqual on a non-empty AnchorHit, which
  // is what made this route safe (see the H6 phase-1 task report). db-write
  // and idempotency-guard hits never set this — they are already
  // provider-agnostic (see WEBHOOK_PROVIDERS' own comment) and infer.ts's
  // single-provider STRUCTURAL_PATTERNS loop (today: just Stripe) doesn't
  // need it to disambiguate a triple.
  providerSlug?: string;
}

// -----------------------------------------------------------------------
// Package specifiers the recognizers below match against. This is SPIKE
// DETECTOR DATA — the same kind of thing as an entry in signatures/*.json's
// import tables — NOT a taxonomy slug from taxonomy.json. The distinction
// matters: CLAUDE.md's "closed vocabulary" invariant is about what slug a
// bundle is allowed to claim, and this spike never writes to a bundle at
// all (see the spike doc's Invariants). Adding, removing, or renaming an
// entry in the tables below has zero effect on that guarantee — it only
// changes which raw import specifiers this experimental recognizer
// happens to look for.
// -----------------------------------------------------------------------
const STRIPE_SPECIFIER = "stripe";
const PRISMA_SPECIFIERS = new Set(["@prisma/client", "prisma"]);
const SUPABASE_SPECIFIER = "@supabase/supabase-js";
const PG_SPECIFIER = "pg";
const KNEX_SPECIFIER = "knex";
const DRIZZLE_SPECIFIER = "drizzle-orm";

const DB_PACKAGE_SPECIFIERS = new Set([
  ...PRISMA_SPECIFIERS,
  SUPABASE_SPECIFIER,
  PG_SPECIFIER,
  KNEX_SPECIFIER,
  DRIZZLE_SPECIFIER,
]);

const PRISMA_WRITE_VERBS = new Set(["create", "createMany", "update", "updateMany", "upsert"]);
const SUPABASE_WRITE_VERBS = new Set(["insert", "upsert", "update"]);
// knex's tracked write-verb set deliberately has no "upsert" entry: knex
// doesn't expose a single ".upsert(...)" method the way Prisma/Supabase do
// (its idiom is `.insert(...).onConflict(...).merge(...)`, a longer chain
// this milestone's shape rules don't special-case) — so a knex write hit
// can never also be upsert-shaped via THIS table; see matchDbWrite's own
// comment.
const KNEX_WRITE_VERBS = new Set(["insert", "update"]);
const DRIZZLE_WRITE_SEGMENTS = new Set(["insert", "update", "onConflictDoUpdate"]);
const DB_READ_VERBS = new Set(["findUnique", "findFirst", "findOne", "select", "get"]);

const PG_WRITE_SQL = /^\s*(insert|update)\b/i;
const PG_UPSERT_SQL = /on\s+conflict/i;

// -----------------------------------------------------------------------
// WEBHOOK_PROVIDERS — H6 multi-provider generalization (see
// docs/proof-graph-spike.md and this milestone's own doc, phase 1). SPIKE
// DETECTOR DATA, same status as every other table in this file (see the
// comment above STRIPE_SPECIFIER etc.): a versioned, in-repo, deterministic
// pattern table this experimental recognizer walks — NOT the taxonomy
// authority itself. `slug` below is only meaningful because
// inferStructuralSkills (infer.ts) cross-checks it against taxonomy.json at
// runtime before ever producing a finding that names it (defense in depth,
// same posture as skill-detect.ts's compile()); adding a descriptor here
// with a slug that isn't ALSO added to taxonomy.json produces a ScanError,
// never a silent bundle leak.
//
// Phase 1 of H6 (this file's current state) ships ONLY the Stripe
// descriptor — an intentionally provable no-op refactor: the recognizer
// below now iterates this table instead of hardcoding Stripe's shape, but
// with exactly one entry the observable behavior is byte-for-byte identical
// to before the refactor. Phase 2 (a later milestone, not this one) adds
// the remaining providers' descriptors (PayPal, Mercado Pago, Lemon
// Squeezy, Paddle, RevenueCat/IAP) alongside their own fixtures and
// `explain` support.
export interface WebhookProviderDescriptor {
  /** Taxonomy slug (taxonomy.json) this provider's webhook pattern produces. */
  slug: string;
  /** npm specifiers that identify the provider (mirrors STRIPE_SPECIFIER etc. above). */
  packages: string[];
  /**
   * Call-chain endings that mean "verify webhook" once a call's receiver
   * has been resolved to one of `packages` — each inner array is checked
   * against the END of the resolved chain, same rule webhookHits already
   * applied to Stripe (`["webhooks","constructEvent"]` matches a resolved
   * chain ending in exactly those two segments, in that order).
   */
  verifyChainSuffixes: string[][];
  /**
   * Header/signature literal(s) for the weaker file-level fallback (no
   * receiver resolution at all — see webhookHits' own comment on why that
   * fallback exists and why it's intentionally weaker).
   */
  signatureLiterals: string[];
}

export const WEBHOOK_PROVIDERS: WebhookProviderDescriptor[] = [
  {
    slug: "payments/payment-webhook-flow",
    packages: [STRIPE_SPECIFIER],
    verifyChainSuffixes: [
      ["webhooks", "constructEvent"],
      ["webhooks", "constructEventAsync"],
    ],
    signatureLiterals: ["stripe-signature"],
  },
];

// True when `chain`'s LAST `suffix.length` segments equal `suffix`, in
// order — the generalized version of webhookHits' original inline
// last/secondLast comparison (`last !== "constructEvent" ... secondLast
// !== "webhooks"`). A chain shorter than the suffix can never match, the
// same way the original code's explicit `resolved.chain.length < 2`
// early-return worked for Stripe's 2-segment suffix.
function matchesChainSuffix(chain: string[], suffix: string[]): boolean {
  if (chain.length < suffix.length) return false;
  const offset = chain.length - suffix.length;
  return suffix.every((segment, i) => chain[offset + i] === segment);
}

function fileImportsSpecifier(file: ParsedFile, specifier: string): boolean {
  return file.imports.some((imp) => imp.specifier === specifier);
}

function importSpecifierForLocalName(file: ParsedFile, localName: string): string | null {
  for (const imp of file.imports) {
    for (const binding of imp.bindings) {
      if (binding.local === localName) return imp.specifier;
    }
  }
  return null;
}

interface ReceiverResolution {
  specifier: string;
  // The call's chain with its root replaced by whatever the root resolved
  // THROUGH — e.g. for `stripe.webhooks.constructEvent()` where `stripe` is
  // `new Stripe(...)`, this is ["webhooks","constructEvent"] (the "Stripe"
  // segment the binding resolved through is dropped, since it isn't part of
  // the logical shape a recognizer matches against — only the SPECIFIER
  // matters for what it resolved to).
  chain: string[];
}

/**
 * Resolves a call's receiver CHAIN ROOT to the import specifier it really
 * comes from, per the milestone's three-rule contract:
 *
 * Rule 1 — the root is directly an import binding's local name.
 *
 * Rule 2 — the root is a same-file ParsedBinding with source kind "new" or
 * "call" (e.g. `const stripe = new Stripe(...)`) whose OWN chain's root is,
 * in turn, DIRECTLY an import binding — not itself another same-file
 * binding needing further resolution. That "own chain root" requirement is
 * what "anything deeper -> unresolved" enforces: this function never
 * recurses into a second binding lookup.
 *
 * Rule 3 — one alias hop (source kind "alias", e.g. `const w =
 * stripe.webhooks`) is allowed, resolved with the EXACT SAME "binding's own
 * chain root must be a direct import" rule as rule 2 — the only difference
 * between "new"/"call" and "alias" is what kind of expression produced the
 * binding, which is irrelevant to the chain-splicing arithmetic below, so
 * both share this one code path. Because rule 2 and rule 3 both require the
 * binding's root to be a DIRECT import (never another binding), stacking
 * them — e.g. `const stripe = new Stripe(...); const w = stripe.webhooks;
 * w.constructEvent()` — resolves to null: `w`'s alias root is `stripe`,
 * which is itself a binding, not an import, so rule 3's own "direct import"
 * requirement fails. This is the intended, documented depth limit, not a
 * bug — see anchors.test.ts's "resolves nothing when a new/call binding and
 * an alias hop are stacked" case.
 */
function resolveReceiver(file: ParsedFile, call: ParsedCall): ReceiverResolution | null {
  if (call.chain.length === 0) return null;
  const [root, ...tail] = call.chain;

  const direct = importSpecifierForLocalName(file, root);
  if (direct) return { specifier: direct, chain: tail };

  const binding = file.bindings.find((b) => b.name === root);
  if (!binding) return null;
  const bindingChain = binding.source.chain;
  if (bindingChain.length === 0) return null;
  const [bindingRoot, ...bindingTail] = bindingChain;
  const viaBinding = importSpecifierForLocalName(file, bindingRoot);
  if (!viaBinding) return null; // deeper than one hop -> unresolved, by design
  return { specifier: viaBinding, chain: [...bindingTail, ...tail] };
}

// -----------------------------------------------------------------------
// (a) webhook-verification
// -----------------------------------------------------------------------

function webhookHits(graph: ProofGraph, path: string, file: ParsedFile): AnchorHit[] {
  const hits: AnchorHit[] = [];

  for (const call of file.calls) {
    // The shape check ("...webhooks.constructEvent") must run against the
    // RESOLVED chain, not the raw call.chain — an alias hop (rule 3)
    // shortens the raw chain (`w.constructEvent(...)` is only 2 segments
    // long) while the segment resolveReceiver spliced back in
    // (`stripe.webhooks` -> tail ["webhooks"]) is what actually carries the
    // "webhooks" shape. Checking call.chain directly here would silently
    // never match an alias-resolved call.
    const resolved = resolveReceiver(file, call);
    if (!resolved) continue;
    // H6: iterate WEBHOOK_PROVIDERS instead of hardcoding Stripe. With
    // today's single-entry table this produces byte-for-byte the same
    // decision as the old inline `resolved.specifier !== STRIPE_SPECIFIER`
    // check — see WEBHOOK_PROVIDERS' own comment.
    const provider = WEBHOOK_PROVIDERS.find((p) => p.packages.includes(resolved.specifier));
    if (!provider) continue;
    const matchedSuffix = provider.verifyChainSuffixes.find((suffix) => matchesChainSuffix(resolved.chain, suffix));
    if (!matchedSuffix) continue;

    hits.push({
      kind: "webhook-verification",
      path,
      enclosingFunction: call.enclosingFunction,
      line: call.line,
      reason: `${resolved.specifier}.${matchedSuffix.join(".")} (receiver resolved to import "${resolved.specifier}")`,
      providerSlug: provider.slug,
    });
  }

  // File-level fallback, explicitly weaker (per the milestone spec): a
  // provider's signature literal is present somewhere in the file AND the
  // file externally imports one of that provider's packages — no receiver
  // resolution at all, just co-location. This is the one place in this
  // module where a hit is produced WITHOUT resolving a receiver, by design
  // (a header read like `req.headers['stripe-signature']` is a member
  // access, not a call — see ParsedFile.literals' own comment in
  // parser-adapter.ts). One hit per file per provider (the FIRST matching
  // literal, in source order — ParsedFile.literals is already sorted by
  // position), not one per occurrence: the signal is "this file reads the
  // header," not a count. With today's single-entry WEBHOOK_PROVIDERS table
  // this is exactly one hit at most, same as the old hardcoded Stripe-only
  // check.
  for (const provider of WEBHOOK_PROVIDERS) {
    const matchingSpecifier = provider.packages.find((specifier) => fileImportsSpecifier(file, specifier));
    if (!matchingSpecifier) continue;
    const signatureLiteral = file.literals.find((l) => provider.signatureLiterals.includes(l.value));
    if (!signatureLiteral) continue;

    hits.push({
      kind: "webhook-verification",
      path,
      enclosingFunction: signatureLiteral.enclosingFunction,
      line: signatureLiteral.line,
      reason: `literal "${signatureLiteral.value}" present and file imports "${matchingSpecifier}" (weaker: file-level fallback, no receiver resolved)`,
      providerSlug: provider.slug,
    });
  }

  return hits;
}

// -----------------------------------------------------------------------
// (b) db-write
// -----------------------------------------------------------------------

interface DbWriteMatch {
  reason: string;
  // Whether THIS SAME write is also upsert-shaped, per idempotency-guard
  // rule (1) — computed from the exact resolution (receiver-resolved or
  // fallback-matched) that produced the write hit in the first place, so a
  // fallback-matched supabase `.upsert(...)` is just as eligible as a
  // receiver-resolved one. Intentional: one call can be BOTH a db-write and
  // an idempotency-guard hit (an upsert is both), see findAnchors below.
  upsertShaped: boolean;
}

/**
 * Matches a call against the db-write shape rules for each tracked
 * package. Tries full receiver resolution first (works cleanly for
 * prisma/pg/drizzle and any supabase/knex call that isn't chained off an
 * invoked table selector). Falls back to a documented, PACKAGE-SPECIFIC,
 * file-level co-location check for supabase/knex only — see the comment on
 * that branch for why those two (and only those two) need it.
 */
function matchDbWrite(file: ParsedFile, call: ParsedCall): DbWriteMatch | null {
  const resolved = resolveReceiver(file, call);
  if (resolved) {
    const last = resolved.chain[resolved.chain.length - 1];

    if (PRISMA_SPECIFIERS.has(resolved.specifier) && PRISMA_WRITE_VERBS.has(last)) {
      return {
        reason: `${resolved.specifier} .${last}(...) (receiver resolved to import "${resolved.specifier}")`,
        upsertShaped: last === "upsert",
      };
    }

    if (resolved.specifier === PG_SPECIFIER && last === "query") {
      const writeArg = call.stringArgs.find((s) => PG_WRITE_SQL.test(s));
      if (writeArg) {
        return {
          reason: 'pg pool.query(...) with a write-shaped SQL string argument (receiver resolved to import "pg")',
          upsertShaped: call.stringArgs.some((s) => PG_UPSERT_SQL.test(s)),
        };
      }
    }

    if (resolved.specifier === KNEX_SPECIFIER && KNEX_WRITE_VERBS.has(last)) {
      return {
        reason: `knex .${last}(...) (receiver resolved to import "knex")`,
        upsertShaped: false, // see KNEX_WRITE_VERBS' own comment
      };
    }

    if (resolved.specifier === DRIZZLE_SPECIFIER && resolved.chain.some((s) => DRIZZLE_WRITE_SEGMENTS.has(s))) {
      return {
        reason: 'drizzle-orm chain containing a write segment (receiver resolved to import "drizzle-orm")',
        upsertShaped: resolved.chain.includes("onConflictDoUpdate"),
      };
    }

    if (resolved.specifier === SUPABASE_SPECIFIER && resolved.chain.some((s) => SUPABASE_WRITE_VERBS.has(s))) {
      return {
        reason: 'supabase-js chain containing a write segment (receiver resolved to import "@supabase/supabase-js")',
        upsertShaped: resolved.chain.includes("upsert"),
      };
    }
  }

  // Documented fallback for supabase/knex only. Both packages' common
  // calling idiom invokes the table selector AS A FUNCTION —
  // `supabase.from('orders').insert(...)`, `knex('users').insert(...)` —
  // which makes the selector itself a CallExpression sitting in the middle
  // of the chain. chainOf (parser-adapter.ts) can only walk
  // identifier/`this`/property/element access; a call result is exactly the
  // shape it already collapses to a single "*" segment (same convention as
  // a computed member access), so resolveReceiver's root lookup fails for
  // the ENSUING `.insert(...)`/`.upsert(...)`/`.update(...)` call in
  // practice — there is no root name left to resolve. This is the same
  // documented syntactic-parser limitation as chainOf's own comment, not a
  // gap in resolveReceiver's three rules. Falling back to file-level import
  // co-location for just these two packages (matches the milestone spec's
  // explicit escape hatch for supabase: "or containing them at all — keep
  // simple") keeps the common real-world idiom detectable without
  // pretending a receiver was actually resolved when it wasn't. This is
  // NOT the milestone's HARD TIMEBOX-wide degrade (which would drop
  // receiver resolution for every rule) — it is a narrow, single-branch
  // fallback that only ever engages when resolveReceiver has already
  // returned null AND the chain root is specifically the "*" wildcard that
  // signals an unresolvable-because-invoked receiver.
  if (call.chain[0] === "*") {
    const tail = call.chain.slice(1);
    if (tail.some((s) => SUPABASE_WRITE_VERBS.has(s)) && fileImportsSpecifier(file, SUPABASE_SPECIFIER)) {
      return {
        reason:
          'supabase-js chain containing a write segment (file-level fallback: receiver unresolved through a chained .from(...) call, file imports "@supabase/supabase-js")',
        upsertShaped: tail.includes("upsert"),
      };
    }
    const last = call.chain[call.chain.length - 1];
    if (KNEX_WRITE_VERBS.has(last) && fileImportsSpecifier(file, KNEX_SPECIFIER)) {
      return {
        reason: `knex .${last}(...) (file-level fallback: receiver unresolved through a chained knex(...) call, file imports "knex")`,
        upsertShaped: false,
      };
    }
  }

  return null;
}

// -----------------------------------------------------------------------
// (c) idempotency-guard
// -----------------------------------------------------------------------

// Rule (3), lookup-before-write: is this call a READ on a DB-resolved root?
// Deliberately receiver-resolution ONLY, no supabase/knex fallback — the
// milestone spec's fallback escape hatch is scoped to the db-write rule
// only, and extending it here would risk a false "guard" claim from an
// unrelated `.get(...)`/`.select(...)` call whose root the parser genuinely
// couldn't place. A supabase/knex `.select(...)` chained off an invoked
// table selector is therefore a documented gap in rule (3) specifically —
// see anchors.test.ts.
function matchDbRead(file: ParsedFile, call: ParsedCall): boolean {
  const resolved = resolveReceiver(file, call);
  if (!resolved) return false;
  if (!DB_PACKAGE_SPECIFIERS.has(resolved.specifier)) return false;
  const last = resolved.chain[resolved.chain.length - 1];
  return DB_READ_VERBS.has(last);
}

function matchExplicitIdempotencyKey(call: ParsedCall): boolean {
  return call.argPropertyNames.includes("idempotencyKey");
}

// -----------------------------------------------------------------------
// findAnchors
// -----------------------------------------------------------------------

function sortHits(hits: AnchorHit[]): AnchorHit[] {
  return [...hits].sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    return 0;
  });
}

/**
 * Deterministic anchor recognizer over one ProofGraph (one HEAD snapshot,
 * per the spike's invariants — see docs/proof-graph-spike.md). Same input
 * graph always produces the same (sorted) output array; no randomness, no
 * network, no type-checker.
 */
export function findAnchors(graph: ProofGraph): AnchorHit[] {
  const hits: AnchorHit[] = [];

  for (const path of graph.files()) {
    const file = graph.parsedFile(path);
    if (!file) continue; // defensive; every path from graph.files() has a parsedFile by construction

    hits.push(...webhookHits(graph, path, file));

    // Reads seen so far in each enclosing-function scope of THIS file, in
    // source-position order. file.calls is already sorted by source
    // position (parser-adapter.ts's bySourcePosition), so "already
    // accumulated by the time we reach a write" is equivalent to rule (3)'s
    // "at a LOWER line number" without a second pass over the file.
    const priorReadsByScope = new Map<string | null, { line: number; lastSegment: string }[]>();

    for (const call of file.calls) {
      const isRead = matchDbRead(file, call);
      if (isRead) {
        const arr = priorReadsByScope.get(call.enclosingFunction) ?? [];
        arr.push({ line: call.line, lastSegment: call.chain[call.chain.length - 1] });
        priorReadsByScope.set(call.enclosingFunction, arr);
      }

      const write = matchDbWrite(file, call);
      if (write) {
        hits.push({
          kind: "db-write",
          path,
          enclosingFunction: call.enclosingFunction,
          line: call.line,
          reason: write.reason,
        });

        // Rule (1): an upsert-shaped write is idempotent by construction —
        // deliberately the SAME call producing both a db-write AND an
        // idempotency-guard hit, not a bug (see DbWriteMatch's own
        // comment).
        if (write.upsertShaped) {
          hits.push({
            kind: "idempotency-guard",
            path,
            enclosingFunction: call.enclosingFunction,
            line: call.line,
            reason: `upsert-shaped write is idempotent by construction (${write.reason})`,
          });
        }

        // Rule (3): lookup-before-write.
        const priorReads = priorReadsByScope.get(call.enclosingFunction);
        if (priorReads && priorReads.length > 0) {
          const earliest = priorReads[0]; // pushed in source order -> first is earliest
          hits.push({
            kind: "idempotency-guard",
            path,
            enclosingFunction: call.enclosingFunction,
            line: call.line,
            reason: `lookup-before-write: a read call (chain ending ".${earliest.lastSegment}") at line ${earliest.line} precedes this write in the same function`,
          });
        }
      }

      // Rule (2): explicit idempotency key, package-agnostic — no DB
      // resolution needed at all.
      if (matchExplicitIdempotencyKey(call)) {
        hits.push({
          kind: "idempotency-guard",
          path,
          enclosingFunction: call.enclosingFunction,
          line: call.line,
          reason: 'explicit "idempotencyKey" argument property',
        });
      }
    }
  }

  return sortHits(hits);
}
