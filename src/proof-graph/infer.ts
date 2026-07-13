// H2 of the proof-graph spike (see docs/proof-graph-spike.md), part 2 of 2:
// classifies findAnchors' (anchors.ts) output into a connected shape
// (DIRECT / INFERRED / AMBIGUOUS) for the spike's one target slug, and
// attributes the result to the selected author by file intersection with
// their added-lines diff. Same posture as every other proof-graph module:
// deterministic, in-memory, zero network — this file never calls out to
// anything beyond a local `git show` (via collectUserTouchedFiles) and never
// writes anywhere.
//
// IMPORTANT — this is a SPIKE-ONLY structure. Per docs/proof-graph-spike.md's
// "Invariants", StructuralFinding must NEVER gain a toJSON method and must
// NEVER be JSON.stringify'd into `scan` output or a bundle. test/privacy/
// (H3) is expected to enforce this at the privacy-test layer; this comment
// is the code-level half of that guarantee.
import { loadTaxonomySlugs } from "../skill-detect.js";
import { getCommitsAddedLines, type RawCommit } from "../git.js";
import { isExcludedPath } from "../churn-exclusions.js";
import { ScanError } from "../errors.js";
import type { AnchorHit } from "./anchors.js";
import type { ProofGraph } from "./graph.js";

// Named in code (unlike signatures/*.json's slugs, which are pure data) —
// but that's a convenience for this experimental module's own readability,
// NOT a bypass of the closed-vocabulary rule. inferStructuralSkills below
// still validates this against the real taxonomy.json at runtime, in the
// function real code calls, mirroring skill-detect.ts's compile() (see its
// own "Defense in depth" comment) — a hardcoded slug string is exactly the
// kind of thing a future refactor could silently drift from taxonomy.json
// without this check.
export const STRUCTURAL_SKILL_SLUG = "payments/payment-webhook-flow";

export type StructuralConfidence = "direct" | "inferred" | "ambiguous";

export interface StructuralFinding {
  slug: string;
  confidence: StructuralConfidence;
  /** >=1 anchor-containing file (among the anchors that support THIS
   * finding, not the whole anchor pool) is in the caller-supplied
   * userTouchedFiles set. */
  attributed: boolean;
  /** true ONLY if confidence is "direct" or "inferred" AND attributed. An
   * ambiguous finding NEVER claims (see docs/proof-graph-spike.md's H3 false
   * -negative case), and an unattributed finding NEVER claims either — this
   * field is THE gate: an unclaimed finding exists only for local `explain`
   * output (H4), never for any bundle. */
  claimed: boolean;
  anchors: AnchorHit[];
  /** null for ambiguous (there is no single connected shape to describe);
   * edgeDistance is always 0 for both direct variants (same-function and
   * same-file are, definitionally, zero file-hops apart) and 1-3 for
   * "cross-file" (inferred). */
  connection: null | { kind: "same-function" | "same-file" | "cross-file"; edgeDistance: number };
  /** Present (always `true`) ONLY when the cross-file INFERRED search hit
   * INFER_WORK_BUDGET before finishing and this finding degraded to
   * AMBIGUOUS as a result — see findInferredTriple's own comment on why a
   * deterministic work budget, not a wall-clock timeout, is what "never
   * hangs" means for this module. Absent (not just `false`) in every other
   * case, so a plain `finding.searchBounded` check (no `=== true` needed)
   * distinguishes "degraded by the budget" from "genuinely not connected
   * closely enough" or "not even attempted" (DIRECT/no-finding). */
  searchBounded?: true;
}

// -----------------------------------------------------------------------
// Deterministic ordering, mirroring anchors.ts's own (private, unexported)
// sortHits — duplicated here rather than imported because anchors.ts
// deliberately keeps it module-private (findAnchors' own output is already
// sorted; this module needs the same comparator for anchor SUBSETS it picks
// out of that output, e.g. a same-file triple assembled from unsorted
// filter() results). Same three-key comparator: path, then line, then kind.
// -----------------------------------------------------------------------
function sortAnchorHits(hits: AnchorHit[]): AnchorHit[] {
  return [...hits].sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.kind !== b.kind) return (a.kind < b.kind ? -1 : 1);
    return 0;
  });
}

// -----------------------------------------------------------------------
// DIRECT — same-function / same-file
// -----------------------------------------------------------------------

type Triple = [AnchorHit, AnchorHit, AnchorHit];

// Rule: at least one anchor of EACH of the 3 kinds where all three share
// BOTH path and enclosingFunction. Iterates in sorted order so the first
// match found is deterministic regardless of the input arrays' own order
// (the caller's anchors come from a plain Array#filter over `anchors`,
// which is NOT guaranteed sorted the way findAnchors' full output is).
function findSameFunctionTriple(webhook: AnchorHit[], dbWrite: AnchorHit[], idempotency: AnchorHit[]): Triple | null {
  const dbSorted = sortAnchorHits(dbWrite);
  const idemSorted = sortAnchorHits(idempotency);
  for (const w of sortAnchorHits(webhook)) {
    for (const d of dbSorted) {
      if (d.path !== w.path || d.enclosingFunction !== w.enclosingFunction) continue;
      for (const i of idemSorted) {
        if (i.path === w.path && i.enclosingFunction === w.enclosingFunction) return [w, d, i];
      }
    }
  }
  return null;
}

// Rule: all 3 kinds present in the same file (any function, or module top
// level) — weaker than same-function, only tried once same-function fails.
function findSameFileTriple(webhook: AnchorHit[], dbWrite: AnchorHit[], idempotency: AnchorHit[]): Triple | null {
  const dbSorted = sortAnchorHits(dbWrite);
  const idemSorted = sortAnchorHits(idempotency);
  for (const w of sortAnchorHits(webhook)) {
    const d = dbSorted.find((x) => x.path === w.path);
    if (!d) continue;
    const i = idemSorted.find((x) => x.path === w.path);
    if (i) return [w, d, i];
  }
  return null;
}

// -----------------------------------------------------------------------
// INFERRED — cross-file, connected within <=3 edges of undirected
// file-adjacency built from the graph's RESOLVED import edges.
//
// Deliberate simplification (per the milestone's hard timebox — see
// docs/proof-graph-spike.md's H2 entry): "connected" here means reachable
// through relative import edges (graph.importEdgesOf, resolvedPath !=
// null), NOT the graph's own call-edge resolution (resolveCallTargets).
// A handler that imports a service module and calls one of its exports is
// exactly the shape import edges already capture; walking actual call
// edges instead would need to handle indirect calls (a value passed
// through several layers before being invoked) that the spike's syntactic,
// no-type-checker posture can't resolve reliably anyway (see graph.ts's own
// resolveCallTargets doc comment on its limited rule set). Import-edge
// co-location is the documented, narrower signal this milestone settled on
// instead of chasing full call-graph precision — full receiver resolution
// (anchors.ts) shipped as planned; this file-adjacency approximation is the
// ONE place H2 narrowed scope, and only here.
// -----------------------------------------------------------------------

function buildFileAdjacency(graph: ProofGraph): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const ensure = (path: string): Set<string> => {
    let set = adjacency.get(path);
    if (!set) {
      set = new Set();
      adjacency.set(path, set);
    }
    return set;
  };
  for (const path of graph.files()) {
    ensure(path);
    for (const edge of graph.importEdgesOf(path)) {
      if (edge.resolvedPath === null) continue;
      ensure(path).add(edge.resolvedPath);
      ensure(edge.resolvedPath).add(path);
    }
  }
  return adjacency;
}

// Shared by bfsDistances (the search radius BFS itself never needs to
// explore past) and findInferredTriple (the actual INFERRED-eligibility
// bound applied to the max of the three pairwise distances) — a single
// module-level constant so the two can never drift apart. findInferredTriple
// used to declare its own local copy of this value; bfsDistances is its
// only other consumer, and both need the exact same number, so hoisting it
// here is the one-source-of-truth fix, not just a style choice.
const MAX_EDGE_DISTANCE = 3;

/**
 * BFS distances from `from`, capped at MAX_EDGE_DISTANCE. findInferredTriple
 * (this function's only caller, via distanceBetween) only ever cares
 * whether a distance is `<= MAX_EDGE_DISTANCE` — anything past that is
 * treated identically to "unreachable" (distanceBetween's own `?? Number
 * .POSITIVE_INFINITY` fallback for a path not present in the returned map
 * doesn't distinguish "too far" from "no path at all", and the caller's own
 * `> MAX_EDGE_DISTANCE` checks treat both the same way).
 *
 * Semantics-preserving by construction: BFS visits nodes in non-decreasing
 * distance order, so stopping enqueue once `currentDistance >=
 * MAX_EDGE_DISTANCE` never skips a node the caller can actually use —
 * every node within the cap is still visited and gets its exact correct
 * distance; only nodes STRICTLY PAST the cap are pruned, and those would
 * have been read back as "too far, treat as unreachable" anyway. What this
 * caps is pure waste, not behavior: an uncapped BFS would additionally walk
 * (and, via INFER_WORK_BUDGET's per-BFS `workUnits += fromA.size`
 * accounting, pay the work-budget cost for) every remaining node in a large
 * connected component, even though nothing past distance 3 can ever change
 * findInferredTriple's outcome. Left uncapped, that inflates the shared
 * work counter by up to the WHOLE component's size per distinct anchor
 * file BFS'd from — on a large, well-connected repo (many distinct anchor
 * files, one big component) that alone can trip INFER_WORK_BUDGET and
 * spuriously degrade to `searchBounded`/AMBIGUOUS a repo the depth-capped
 * design should classify fully.
 */
function bfsDistances(adjacency: Map<string, Set<string>>, from: string): Map<string, number> {
  const distances = new Map<string, number>([[from, 0]]);
  const queue: string[] = [from];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDistance = distances.get(current)!;
    if (currentDistance >= MAX_EDGE_DISTANCE) continue; // nothing past the cap is ever useful to visit
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, currentDistance + 1);
        queue.push(neighbor);
      }
    }
  }
  return distances;
}

// Deterministic work budget for the cross-file search below (see
// findInferredTriple's own comment for the full rationale). Counts two
// things against ONE shared counter: (a) every full (webhook-file,
// db-write-file, idempotency-file) triple actually evaluated by the inner
// loop, and (b) every node a BFS visits while computing a fresh distance
// cache entry — capped at MAX_EDGE_DISTANCE per BFS run (see bfsDistances'
// own comment): only nodes within the cap can ever affect
// findInferredTriple's outcome, so walking (and charging work-budget cost
// for) the rest of a large connected component would be pure waste, not
// real search work. Both scale with the real work findInferredTriple does,
// so a single budget bounds the whole search regardless of which of the
// two dominates for a given repo's shape (many distinct anchor files vs. a
// large/dense import graph).
//
// Why a WORK BUDGET and not a wall-clock timeout (the owner's original ask
// was "timeout with clean degradation"): a wall-clock cut makes the
// classification depend on how fast the machine happens to be at the
// moment it runs — the same repo could classify INFERRED on a fast/idle
// machine and AMBIGUOUS-by-timeout on a loaded CI runner or an older
// laptop, which breaks this whole spike's "same input -> same output,
// always" invariant (see this file's own module doc comment and
// docs/proof-graph-spike.md's Invariants). A deterministic unit count gives
// the exact same guarantee the owner actually wants ("this can never hang
// the terminal") without that nondeterminism: the same graph + same
// anchors always perform the exact same number of counted work units, so
// they always land on the same side of the budget, on any machine, under
// any load.
//
// Value: comfortably above every normal (even fairly dense) repo's real
// work count — see test/proof-graph/scale.test.ts's "300 files, 40 db
// calls/file, 20% stripe noise" case, measured at 631,652 work units
// (~3.2x of headroom under this budget, not the "order of magnitude" this
// comment used to (incorrectly) claim before the number was actually
// measured) — and comfortably below the territory where the PRE-FIX
// anchor-instance-level search used to hang (this file-level rewrite's
// worst case is bounded by distinct FILE counts, not anchor INSTANCE
// counts, so it never gets remotely close to this budget on realistic
// repos in the first place; the budget exists for the
// pathological/adversarial shapes that push distinct-file counts high too
// — see scale.test.ts's dedicated budget-exceeding case). 3.2x is real
// headroom, not a thin margin: that scale.test.ts fixture is already
// engineered to be denser than any real repo measured so far (see
// docs/proof-graph-spike.md's "Scale hardening" before/after table), and
// the BFS depth cap above additionally keeps large-but-well-connected real
// repos (e.g. fixture-2000 in the diagnosis harness) well under budget too
// — see that same table for the measured before/after work counts.
export const INFER_WORK_BUDGET = 2_000_000;

/**
 * Finds the anchor triple (one per kind) whose maximum pairwise
 * file-adjacency distance is smallest and <= 3, per the milestone's INFERRED
 * rule. Only reached once findSameFileTriple has already failed to find a
 * single file holding all 3 kinds — so by construction every candidate
 * triple here spans more than one file, satisfying "across multiple files".
 *
 * FILE-LEVEL search, not anchor-INSTANCE-level (the pre-fix version of this
 * function searched every (webhook anchor, db-write anchor, idempotency
 * anchor) INSTANCE triple — O(W×D×I) over anchor counts, which on a dense
 * real repo (many DB call sites per file) reaches billions of combinations;
 * see docs/proof-graph-spike.md's "Scale hardening" subsection for the full
 * diagnosis). Connectivity distance (distanceBetween, via graph import
 * edges) is inherently FILE-level already — distanceBetween takes paths,
 * never anchors — so multiple anchors of the same kind in the same file are
 * indistinguishable for the purpose of this search: they always produce the
 * exact same pairwise distances. Collapsing each anchor kind to its sorted
 * set of DISTINCT FILES first (distinctSortedPaths) and searching FILE
 * triples is therefore an exact equivalence, not an approximation: |files|
 * is orders of magnitude below |anchors| on exactly the dense repos where
 * the old search blew up, while the set of (file-triple, edgeDistance)
 * pairs it can find is identical.
 *
 * Determinism of the file-triple search matches the pre-fix anchor-level
 * one exactly: sortAnchorHits' (path, then line) order means that, for a
 * fixed path, the FIRST anchor of a given kind encountered in sorted order
 * is always the lowest-line one in that file — so the old nested loop over
 * sorted ANCHOR instances visited each distinct file's anchors as a
 * contiguous run, all sharing the same pairwise distances, in the exact
 * same file-visitation order this function's nested loop over sorted
 * DISTINCT FILES uses. A "first found wins ties" search (this function's
 * `<` comparison, unchanged) therefore converges on the identical
 * (best.wPath, best.dPath, best.iPath) triple either way — and once that
 * file triple is fixed, pickRepresentativeAnchor's "first by
 * sortAnchorHits order" selection recovers exactly the specific AnchorHit
 * (lowest line in that file) the old anchor-level loop would have picked as
 * part of the very same first-found triple. See
 * test/proof-graph/infer.test.ts / detection.test.ts, whose assertions on
 * the resulting `finding.anchors`/`connection` are unchanged by this
 * rewrite.
 *
 * Returns `{ result: null, bounded: false }` if no combination connects
 * within the 3-edge bound (or at all). Returns `{ result: null, bounded:
 * true }` if INFER_WORK_BUDGET is exhausted before the search finishes —
 * the caller treats this exactly like "not connected" (AMBIGUOUS) but
 * additionally marks the finding as `searchBounded`, per this module's own
 * "never claims from an incomplete search" posture: a partially-completed
 * search might have been about to find a connected triple, so reporting
 * "not found" plainly (without the budget flag) would be misleading, but
 * reporting whatever partial "best so far" the search had would make the
 * result depend on iteration order/budget placement in a way that isn't a
 * genuine claim about the repo's structure either. Discarding the partial
 * best and flagging the degradation is the deterministic, honest answer.
 */
function findInferredTriple(
  adjacency: Map<string, Set<string>>,
  webhook: AnchorHit[],
  dbWrite: AnchorHit[],
  idempotency: AnchorHit[]
): { result: { triple: Triple; edgeDistance: number } | null; bounded: boolean } {
  // MAX_EDGE_DISTANCE is now a module-level constant (shared with
  // bfsDistances' own depth cap) — see its own comment above bfsDistances.

  const distinctSortedPaths = (hits: AnchorHit[]): string[] => {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const hit of sortAnchorHits(hits)) {
      if (!seen.has(hit.path)) {
        seen.add(hit.path);
        paths.push(hit.path);
      }
    }
    return paths;
  };

  const webhookFiles = distinctSortedPaths(webhook);
  const dbWriteFiles = distinctSortedPaths(dbWrite);
  const idempotencyFiles = distinctSortedPaths(idempotency);

  // ONE shared counter for the whole search — see INFER_WORK_BUDGET's own
  // comment on what it counts and why a single counter (not one per
  // sub-search) is the right unit of "how much work has this search done".
  let workUnits = 0;
  let bounded = false;

  // BFS is run at most once per distinct source FILE across the whole
  // search (cached here), not once per candidate pair — cheap even with
  // several distinct anchor files on each side.
  const distanceCache = new Map<string, Map<string, number>>();
  const distanceBetween = (a: string, b: string): number => {
    if (a === b) return 0;
    let fromA = distanceCache.get(a);
    if (!fromA) {
      fromA = bfsDistances(adjacency, a);
      distanceCache.set(a, fromA);
      // Counted once per fresh BFS (cache miss), not per lookup: a cached
      // distanceBetween call is an O(1) map read, not real search work.
      workUnits += fromA.size;
    }
    return fromA.get(b) ?? Number.POSITIVE_INFINITY;
  };

  let best: { wPath: string; dPath: string; iPath: string; edgeDistance: number } | null = null;

  searchLoop: for (const wPath of webhookFiles) {
    for (const dPath of dbWriteFiles) {
      if (workUnits > INFER_WORK_BUDGET) {
        bounded = true;
        break searchLoop;
      }
      const wd = distanceBetween(wPath, dPath);
      if (workUnits > INFER_WORK_BUDGET) {
        bounded = true;
        break searchLoop;
      }
      if (wd > MAX_EDGE_DISTANCE) continue; // the max of the three can only grow from here
      for (const iPath of idempotencyFiles) {
        workUnits++; // one file-triple evaluation
        if (workUnits > INFER_WORK_BUDGET) {
          bounded = true;
          break searchLoop;
        }
        const wi = distanceBetween(wPath, iPath);
        const di = distanceBetween(dPath, iPath);
        const maxDistance = Math.max(wd, wi, di);
        if (maxDistance > MAX_EDGE_DISTANCE) continue;
        if (!best || maxDistance < best.edgeDistance) best = { wPath, dPath, iPath, edgeDistance: maxDistance };
      }
    }
  }

  if (bounded) return { result: null, bounded: true };
  if (!best) return { result: null, bounded: false };

  // Deterministically recover the representative AnchorHit per chosen file
  // — first by sortAnchorHits order (path, then line) — see this
  // function's own doc comment for why this is an exact match for what the
  // pre-fix anchor-instance-level search would have picked.
  const pickRepresentativeAnchor = (hits: AnchorHit[], path: string): AnchorHit => {
    const found = sortAnchorHits(hits).find((h) => h.path === path);
    // Defensive only: `path` always comes from `hits` itself via
    // distinctSortedPaths above, so a miss here would mean this function's
    // own invariant broke, not a real runtime condition.
    if (!found) throw new ScanError(`Internal error: no anchor found for path "${path}" while resolving an INFERRED triple.`);
    return found;
  };

  const triple: Triple = [
    pickRepresentativeAnchor(webhook, best.wPath),
    pickRepresentativeAnchor(dbWrite, best.dPath),
    pickRepresentativeAnchor(idempotency, best.iPath),
  ];
  return { result: { triple, edgeDistance: best.edgeDistance }, bounded: false };
}

// -----------------------------------------------------------------------
// AMBIGUOUS
// -----------------------------------------------------------------------

// Mirrors anchors.ts's own STRIPE_SPECIFIER constant, duplicated (not
// imported) for the same reason as sortAnchorHits above: anchors.ts keeps
// its detector-data tables module-private, and this is "spike detector
// data" too (see anchors.ts's own comment on why that's unrelated to the
// closed-vocabulary rule) — a raw import specifier string, not a taxonomy
// slug.
const STRIPE_IMPORT_SPECIFIER = "stripe";

function hasStripeExternalImport(graph: ProofGraph): boolean {
  return graph.files().some((path) => graph.externalImportsOf(path).some((imp) => imp.specifier === STRIPE_IMPORT_SPECIFIER));
}

// -----------------------------------------------------------------------
// inferStructuralSkills
// -----------------------------------------------------------------------

function buildFinding(
  confidence: StructuralConfidence,
  supportingAnchors: AnchorHit[],
  connection: StructuralFinding["connection"],
  userTouchedFiles: ReadonlySet<string>,
  searchBounded?: true
): StructuralFinding {
  // Attribution is computed over the anchors that actually SUPPORT this
  // finding (the chosen triple for direct/inferred; whatever partial
  // anchors exist for ambiguous) — never the whole anchor pool findAnchors
  // returned, which could include anchors from an unrelated part of the
  // codebase that happens to also touch stripe/DB packages.
  const attributed = supportingAnchors.some((a) => userTouchedFiles.has(a.path));
  // THE gate (see StructuralFinding.claimed's own comment): ambiguous never
  // claims regardless of attribution; direct/inferred claim only when
  // attributed.
  const claimed = confidence !== "ambiguous" && attributed;
  const finding: StructuralFinding = {
    slug: STRUCTURAL_SKILL_SLUG,
    confidence,
    attributed,
    claimed,
    anchors: sortAnchorHits(supportingAnchors),
    connection,
  };
  // Only ever set (to `true`) when the caller explicitly passes it — see
  // StructuralFinding.searchBounded's own comment on why "absent" (not
  // "false") is this field's normal state.
  if (searchBounded) finding.searchBounded = true;
  return finding;
}

/**
 * Classifies findAnchors' output into the spike's one connected shape and
 * attributes it to the caller-supplied touched-files set. Deterministic:
 * same graph + same anchors + same userTouchedFiles always produce the same
 * (single-element or empty) result array — there is at most one finding
 * because the spike targets exactly one slug (STRUCTURAL_SKILL_SLUG).
 *
 * Classification order (first match wins, per the milestone's rules):
 *   1. DIRECT (same-function, else same-file) — only tried when all 3 kinds
 *      are present in `anchors` at all.
 *   2. INFERRED (cross-file, connected within <=3 edges) — only reached
 *      when DIRECT didn't fire, still gated on all 3 kinds present.
 *   3. AMBIGUOUS — reached whenever neither of the above fired (including
 *      "all 3 kinds present but not connected closely enough"), AND either
 *      "stripe" is imported anywhere in the graph OR a webhook-verification
 *      anchor exists on its own. Never claims (see StructuralFinding's own
 *      comment) — this is the one shape that surfaces ONLY via a future
 *      local-only `redential explain` (H4), never a bundle.
 *   4. No finding at all ([]) — no stripe presence anywhere and no anchors:
 *      there is nothing payment/webhook-shaped to say anything about, not
 *      even tentatively.
 */
export function inferStructuralSkills(
  graph: ProofGraph,
  anchors: AnchorHit[],
  userTouchedFiles: Set<string>,
  opts: { taxonomyPath?: string } = {}
): StructuralFinding[] {
  // Closed-vocabulary defense in depth: enforced HERE, inside the function
  // real code calls (mirrors skill-detect.ts's compile()) — not just as a
  // standalone check a future refactor could unwire without failing any
  // test. If STRUCTURAL_SKILL_SLUG is ever removed from taxonomy.json, this
  // module can never produce a finding naming it.
  const taxonomySlugs = loadTaxonomySlugs(opts.taxonomyPath);
  if (!taxonomySlugs.has(STRUCTURAL_SKILL_SLUG)) {
    throw new ScanError(`Structural skill slug "${STRUCTURAL_SKILL_SLUG}" is not in taxonomy.json.`);
  }

  const webhookAnchors = anchors.filter((a) => a.kind === "webhook-verification");
  const dbWriteAnchors = anchors.filter((a) => a.kind === "db-write");
  const idempotencyAnchors = anchors.filter((a) => a.kind === "idempotency-guard");

  if (webhookAnchors.length > 0 && dbWriteAnchors.length > 0 && idempotencyAnchors.length > 0) {
    const sameFunction = findSameFunctionTriple(webhookAnchors, dbWriteAnchors, idempotencyAnchors);
    if (sameFunction) {
      return [buildFinding("direct", sameFunction, { kind: "same-function", edgeDistance: 0 }, userTouchedFiles)];
    }

    const sameFile = findSameFileTriple(webhookAnchors, dbWriteAnchors, idempotencyAnchors);
    if (sameFile) {
      return [buildFinding("direct", sameFile, { kind: "same-file", edgeDistance: 0 }, userTouchedFiles)];
    }

    const adjacency = buildFileAdjacency(graph);
    const inferred = findInferredTriple(adjacency, webhookAnchors, dbWriteAnchors, idempotencyAnchors);
    if (inferred.result) {
      return [
        buildFinding(
          "inferred",
          inferred.result.triple,
          { kind: "cross-file", edgeDistance: inferred.result.edgeDistance },
          userTouchedFiles
        ),
      ];
    }
    if (inferred.bounded) {
      // The cross-file search never finished — degrade to AMBIGUOUS with
      // `searchBounded` set (see findInferredTriple's own comment). All
      // three anchor kinds are already known to be present at this point
      // (the outer `if` above), so this always fires; falling through to
      // the plain hasStripeExternalImport/webhookAnchors check below would
      // reach the same AMBIGUOUS outcome anyway, but WITHOUT the
      // searchBounded flag a caller needs to tell "not connected" apart
      // from "search cut short".
      return [buildFinding("ambiguous", anchors, null, userTouchedFiles, true)];
    }
  }

  if (hasStripeExternalImport(graph) || webhookAnchors.length > 0) {
    // Whatever partial anchors currently exist (possibly none at all, e.g.
    // "stripe" imported but structurally unused — see the spike doc's H3
    // false-negative case) support this ambiguous finding.
    return [buildFinding("ambiguous", anchors, null, userTouchedFiles)];
  }

  return [];
}

// -----------------------------------------------------------------------
// collectUserTouchedFiles
// -----------------------------------------------------------------------

// Same batching rationale as skill-detect.ts's own DIFF_BATCH_SIZE: diff
// content for this many commits is fetched (and held) at once, via a single
// batched `git show` process (git.ts's getCommitsAddedLines), instead of one
// process per commit — subprocess spawn count is the dominant cost at
// huge-repo scale, not git's own diff work. Kept as this module's own local
// constant rather than importing skill-detect.ts's (which isn't exported)
// — same value, same rationale, but no cross-module coupling for what is,
// deliberately, a duplicated tuning constant rather than a shared contract.
const DIFF_BATCH_SIZE = 200;

/**
 * File-level (never function-level — see docs/proof-graph-spike.md's
 * Exclusions, "No per-function blame") set of paths the given commits added
 * lines to, reusing getCommitsAddedLines (git.ts) in the exact same batched
 * style as skill-detect.ts's detectSkills. Merge commits are skipped (no
 * numstat/diff to attribute per-file changes to, same as detectSkills' own
 * `c.isMerge` filter) and isExcludedPath (churn-exclusions.ts) drops
 * vendored/lockfile/build-output paths — a vendored file's presence would be
 * a false "the user touched this" signal, not a real one, exactly the same
 * rationale detectSkills applies to skill matching. NO git blame anywhere:
 * this is "did an added-lines diff touch this file", not "who wrote which
 * line" — the same diff-based primitive scan already uses, just reduced to
 * a path set instead of pattern-matched against signatures.
 */
export async function collectUserTouchedFiles(
  repoPath: string,
  userCommits: RawCommit[],
  // Optional progress callback, invoked once per commit-diff batch with
  // (commits processed so far, total commits to process) — counts only,
  // never a sha/path (see src/proof-graph/progress.ts's content rule).
  // Purely additive: existing callers that don't pass this keep working
  // unchanged.
  onProgress?: (done: number, total: number) => void
): Promise<Set<string>> {
  const touched = new Set<string>();
  const nonMergeCommits = userCommits.filter((c) => !c.isMerge);

  for (let i = 0; i < nonMergeCommits.length; i += DIFF_BATCH_SIZE) {
    const batch = nonMergeCommits.slice(i, i + DIFF_BATCH_SIZE);
    const addedLinesBySha = await getCommitsAddedLines(
      repoPath,
      batch.map((c) => c.sha)
    );
    for (const commit of batch) {
      const files = addedLinesBySha.get(commit.sha) ?? [];
      for (const file of files) {
        if (isExcludedPath(file.path)) continue;
        // A touched-but-not-added-to file (e.g. a pure deletion diff hunk)
        // surfaces here with an empty addedLines string — not a file the
        // user "added lines to", so it's excluded from the returned set.
        if (file.addedLines.length === 0) continue;
        touched.add(file.path);
      }
    }
    onProgress?.(Math.min(i + DIFF_BATCH_SIZE, nonMergeCommits.length), nonMergeCommits.length);
  }

  return touched;
}
