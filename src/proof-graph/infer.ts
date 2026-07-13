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

function bfsDistances(adjacency: Map<string, Set<string>>, from: string): Map<string, number> {
  const distances = new Map<string, number>([[from, 0]]);
  const queue: string[] = [from];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDistance = distances.get(current)!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, currentDistance + 1);
        queue.push(neighbor);
      }
    }
  }
  return distances;
}

/**
 * Finds the anchor triple (one per kind) whose maximum pairwise
 * file-adjacency distance is smallest and <= 3, per the milestone's INFERRED
 * rule. Only reached once findSameFileTriple has already failed to find a
 * single file holding all 3 kinds — so by construction every candidate
 * triple here spans more than one file, satisfying "across multiple files".
 * Returns null if no combination connects within the 3-edge bound (or at
 * all — an unreachable pair yields an effectively infinite distance).
 */
function findInferredTriple(
  adjacency: Map<string, Set<string>>,
  webhook: AnchorHit[],
  dbWrite: AnchorHit[],
  idempotency: AnchorHit[]
): { triple: Triple; edgeDistance: number } | null {
  const MAX_EDGE_DISTANCE = 3;
  // BFS is run at most once per distinct source file across the whole
  // search (cached here), not once per candidate pair — cheap even with
  // several anchors of the same kind spread across several files.
  const distanceCache = new Map<string, Map<string, number>>();
  const distanceBetween = (a: string, b: string): number => {
    if (a === b) return 0;
    let fromA = distanceCache.get(a);
    if (!fromA) {
      fromA = bfsDistances(adjacency, a);
      distanceCache.set(a, fromA);
    }
    return fromA.get(b) ?? Number.POSITIVE_INFINITY;
  };

  let best: { triple: Triple; edgeDistance: number } | null = null;
  for (const w of sortAnchorHits(webhook)) {
    for (const d of sortAnchorHits(dbWrite)) {
      const wd = distanceBetween(w.path, d.path);
      if (wd > MAX_EDGE_DISTANCE) continue; // the max of the three can only grow from here
      for (const i of sortAnchorHits(idempotency)) {
        const wi = distanceBetween(w.path, i.path);
        const di = distanceBetween(d.path, i.path);
        const maxDistance = Math.max(wd, wi, di);
        if (maxDistance > MAX_EDGE_DISTANCE) continue;
        if (!best || maxDistance < best.edgeDistance) best = { triple: [w, d, i], edgeDistance: maxDistance };
      }
    }
  }
  return best;
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
  userTouchedFiles: ReadonlySet<string>
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
  return {
    slug: STRUCTURAL_SKILL_SLUG,
    confidence,
    attributed,
    claimed,
    anchors: sortAnchorHits(supportingAnchors),
    connection,
  };
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
    if (inferred) {
      return [
        buildFinding("inferred", inferred.triple, { kind: "cross-file", edgeDistance: inferred.edgeDistance }, userTouchedFiles),
      ];
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
export async function collectUserTouchedFiles(repoPath: string, userCommits: RawCommit[]): Promise<Set<string>> {
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
  }

  return touched;
}
