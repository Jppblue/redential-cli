// H4 of the proof-graph spike (see docs/proof-graph-spike.md): the local-only
// `redential explain <skill>` command. It surfaces the structural tier's
// classification and evidence for one HEAD snapshot, for local inspection —
// nothing more.
//
// ZERO NETWORK: this file (and everything it imports — the whole
// proof-graph/* pipeline plus git.js's local read helpers) never touches
// http/https/fetch. `login` and `submit` are the CLI's only network-capable
// commands (see test/privacy/zero-network.test.ts) and this file is not one
// of them.
//
// SCREEN vs BUNDLE BOUNDARY (read this before changing what gets printed):
// everything this command prints — file paths, enclosing function names,
// line numbers, `reason` strings — is LOCAL, on-screen-only diagnostic
// output. Printing it to the user's own terminal is correct and intentional
// (it never leaves the machine that way). It is NOT, and must never become,
// part of `scan`'s bundle output or anything `submit` uploads — see
// docs/proof-graph-spike.md's "Invariants" (the structural signal stays out
// of the bundle for the whole spike) and StructuralFinding's own comment in
// src/proof-graph/infer.ts (no toJSON, never JSON.stringify'd into a bundle).
// This command is a read-only diagnostic window into the in-memory graph,
// not a new data path out of the machine.
//
// NO --json / NO machine-readable output / NO file writes, ON PURPOSE: a
// `--json` flag (or any other structured/serializable output mode) would be
// a standing invitation for some other tool in a pipeline to capture and
// persist a serialization of the graph — exactly what
// docs/proof-graph-spike.md's "In-memory only" invariant forbids. Keeping
// the only output surface "plain text a human reads once in a terminal"
// keeps that invariant true by construction rather than by convention. This
// module imports only `readFileSync` from `node:fs` (a single local
// taxonomy.json label lookup) — no write/mkdir/append call appears anywhere
// in this file.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readHeadSnapshot } from "./proof-graph/snapshot.js";
import { TscParserAdapter } from "./proof-graph/parser-adapter.js";
import { buildGraph } from "./proof-graph/graph.js";
import { findAnchors, type AnchorHit, type AnchorKind } from "./proof-graph/anchors.js";
import {
  collectUserTouchedFiles,
  inferStructuralSkills,
  STRUCTURAL_SKILL_SLUG,
  type StructuralFinding,
} from "./proof-graph/infer.js";
import { getAllCommits, getConfiguredUserEmail } from "./git.js";
import { loadTaxonomySlugs } from "./skill-detect.js";
import { ScanError } from "./errors.js";

export interface ExplainCommandOptions {
  repoPath: string;
  skill: string;
  // Repeatable --author <email>; [] means "use the repo's own git config
  // user.email as the default" — see the non-interactive rationale below.
  author: string[];
  log?: (message: string) => void;
}

// Mirrors skill-detect.ts's own DEFAULT_TAXONOMY_PATH resolution (this file
// sits at the same depth under src/). loadTaxonomySlugs (imported above,
// used for the actual closed-vocabulary validation below) only returns the
// bare slug set, not labels — re-reading the same small JSON file locally
// for the label is simpler than widening skill-detect.ts's exported surface
// for this one lookup.
const DEFAULT_TAXONOMY_PATH = fileURLToPath(new URL("../taxonomy.json", import.meta.url));

function taxonomyLabel(slug: string, path: string = DEFAULT_TAXONOMY_PATH): string {
  const taxonomy = JSON.parse(readFileSync(path, "utf8")) as { skills: { slug: string; label: string }[] };
  return taxonomy.skills.find((s) => s.slug === slug)?.label ?? slug;
}

const CLASSIFICATION_MEANING: Record<StructuralFinding["confidence"], string> = {
  direct: "all three anchors sit in the same function or the same file — the strongest, most direct signal.",
  inferred:
    "the three anchors are wired together across files, connected by resolved relative imports within 3 hops — a real but less direct signal.",
  ambiguous:
    "the pattern is NOT fully connected (or only partially present) — this is a tentative signal only, and the skill is NOT claimed.",
};

// Fixed, meaningful order for grouping anchors in the output — the order the
// webhook -> DB write -> idempotency-guard flow actually happens in, not the
// alphabetical/positional order StructuralFinding.anchors is sorted in.
const ANCHOR_KIND_ORDER: AnchorKind[] = ["webhook-verification", "db-write", "idempotency-guard"];

function describeAnchor(hit: AnchorHit): string {
  return `    ${hit.path}:${hit.line} in ${hit.enclosingFunction ?? "<module top level>"} — ${hit.reason}`;
}

/**
 * Undirected file-adjacency built from the graph's own RESOLVED relative
 * import edges — the exact same signal src/proof-graph/infer.ts's (private)
 * buildFileAdjacency uses for its edgeDistance computation, duplicated here
 * (not imported — infer.ts deliberately keeps it module-private) so this
 * command can render the actual chain of files an INFERRED finding is
 * connected through, using only the graph's public query surface
 * (files()/importEdgesOf()).
 */
function buildFileAdjacency(graph: ReturnType<typeof buildGraph>): Map<string, Set<string>> {
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

/** Shortest path (as a list of file paths, `from` first) between two files
 * in the given adjacency, or null if unreachable. Plain BFS with parent
 * tracking — reconstructs the actual chain, not just its length. */
function shortestFilePath(adjacency: Map<string, Set<string>>, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const parents = new Map<string, string>();
  const visited = new Set<string>([from]);
  const queue: string[] = [from];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current === to) break;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parents.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }
  if (!visited.has(to)) return null;
  const path: string[] = [to];
  let cur = to;
  while (cur !== from) {
    cur = parents.get(cur)!;
    path.push(cur);
  }
  return path.reverse();
}

/**
 * Renders how the finding's supporting anchor files connect, as a simple
 * "a.ts -> b.ts -> c.ts" chain for a cross-file (INFERRED) finding, or a
 * single-file description for same-function/same-file (DIRECT). null
 * `connection` (AMBIGUOUS) is handled by the caller, not here.
 */
function renderConnection(graph: ReturnType<typeof buildGraph>, finding: StructuralFinding): string {
  const connection = finding.connection;
  if (!connection) return "none (pattern not fully connected — see the AMBIGUOUS explanation below)";

  const distinctFiles = [...new Set(finding.anchors.map((a) => a.path))];
  if (connection.kind === "same-function") {
    return `${distinctFiles[0]} (same-function — all anchors inside one function, 0 file hops)`;
  }
  if (connection.kind === "same-file") {
    return `${distinctFiles[0]} (same-file — all anchors in one file, different functions, 0 file hops)`;
  }

  // cross-file (INFERRED): reconstruct the actual chain from the graph's
  // resolved import edges, rooted at the webhook-verification anchor's file
  // when present (the flow's natural starting point) and reaching the
  // farthest other anchor file — matching the finding's own edgeDistance
  // (the MAX pairwise distance among the supporting anchors, see infer.ts's
  // findInferredTriple).
  const adjacency = buildFileAdjacency(graph);
  const webhookAnchor = finding.anchors.find((a) => a.kind === "webhook-verification");
  const source = webhookAnchor?.path ?? distinctFiles[0];
  const others = distinctFiles.filter((f) => f !== source);

  let farthest: { file: string; path: string[] } | null = null;
  for (const other of others) {
    const path = shortestFilePath(adjacency, source, other);
    if (path && (!farthest || path.length > farthest.path.length)) farthest = { file: other, path };
  }
  const chain = farthest ? farthest.path : distinctFiles;
  return `${chain.join(" -> ")} (cross-file, ${connection.edgeDistance} file hop${connection.edgeDistance === 1 ? "" : "s"})`;
}

function describeAmbiguousReason(finding: StructuralFinding): string {
  if (finding.anchors.length === 0) {
    return '"stripe" is imported somewhere in this repository, but no anchors (webhook verification, DB write, idempotency guard) were found at all — nothing structurally connects it to a payment webhook flow.';
  }
  const kindsPresent = new Set(finding.anchors.map((a) => a.kind));
  const missing = ANCHOR_KIND_ORDER.filter((kind) => !kindsPresent.has(kind));
  if (missing.length > 0) {
    return `missing anchor kind(s): ${missing.join(", ")} — the full webhook -> DB write -> idempotency-guard shape isn't present.`;
  }
  return "all three anchor kinds are present, but not connected closely enough — no same-function/same-file match, and no cross-file import path within 3 hops.";
}

/**
 * Resolves which author email(s) `explain` filters commits by — deliberately
 * NON-interactive, unlike `scan`'s prompted author selection: `scan`'s
 * interactive picker exists because a bundle is about to be built and
 * uploaded, so getting the "this is really me" confirmation right matters.
 * `explain` never builds or sends anything — it's a read-only local
 * diagnostic a user (or a test, or a script) should be able to run
 * unattended. Default: the repo's own `git config user.email` if set (the
 * same fast-default signal build-bundle.ts offers interactively); explicit
 * `--author` (repeatable) always overrides it.
 */
function resolveAuthorEmails(repoPath: string, explicitAuthors: string[]): string[] {
  if (explicitAuthors.length > 0) return [...new Set(explicitAuthors)];
  const gitEmail = getConfiguredUserEmail(repoPath);
  return gitEmail ? [gitEmail] : [];
}

export async function executeExplainCommand(opts: ExplainCommandOptions): Promise<void> {
  const log = opts.log ?? console.log;

  // Closed-vocabulary validation FIRST, before any git/parsing work — an
  // unknown slug is a usage error, not a detection result.
  const taxonomySlugs = loadTaxonomySlugs();
  if (!taxonomySlugs.has(opts.skill)) {
    throw new ScanError(
      `Unknown skill slug "${opts.skill}" — taxonomy.json is the CLI's only source of valid skill slugs, and this one isn't in it. See taxonomy.json for the full closed list.`
    );
  }
  if (opts.skill !== STRUCTURAL_SKILL_SLUG) {
    throw new ScanError(
      `"${opts.skill}" is a valid taxonomy.json slug, but only structural detection for "${STRUCTURAL_SKILL_SLUG}" is explainable in this spike (known limit — see docs/proof-graph-spike.md's "Local explain command (H4)" section). Plain import-matching slugs like this one aren't covered by \`redential explain\` yet.`
    );
  }

  const authorEmails = resolveAuthorEmails(opts.repoPath, opts.author);
  const authorEmailSet = new Set(authorEmails);
  const authorLabel =
    authorEmails.length > 0 ? authorEmails.join(", ") : "(none — no --author given and no git config user.email set)";

  // Same pipeline sequence as test/proof-graph/detection.test.ts's
  // runPipeline: HEAD snapshot -> parse -> graph -> anchors -> the selected
  // author's own commits -> touched-files set -> classify. No error here is
  // caught by this module — an outside-a-git-repo failure (or any other git
  // read failure) propagates exactly the way scan-command.ts lets
  // buildBundleInteractively's failures propagate, so cli.ts's single
  // ScanError/uncaught-error handling stays the one place that decides how
  // it's reported.
  const snapshot = await readHeadSnapshot(opts.repoPath);
  const adapter = new TscParserAdapter();
  const parsed = snapshot.map((f) => adapter.parse(f.path, f.content));
  const graph = buildGraph(parsed);
  const anchors = findAnchors(graph);

  const allCommits = await getAllCommits(opts.repoPath);
  const userCommits = allCommits.filter((c) => authorEmailSet.has(c.email));
  const userTouchedFiles = await collectUserTouchedFiles(opts.repoPath, userCommits);

  const findings = inferStructuralSkills(graph, anchors, userTouchedFiles);
  if (findings.length === 0) {
    throw new ScanError(
      `"${opts.skill}" was not detected in this repository — no payment/webhook-shaped structural signal found at all (no anchors, no "stripe" import anywhere in the current HEAD snapshot).`
    );
  }
  const finding = findings[0];

  log(`Skill: ${finding.slug} — ${taxonomyLabel(finding.slug)}`);
  log(`Classification: ${finding.confidence.toUpperCase()} — ${CLASSIFICATION_MEANING[finding.confidence]}`);
  log("");

  log("Anchors:");
  if (finding.anchors.length === 0) {
    // Only reachable for an AMBIGUOUS finding whose only signal is an
    // unused "stripe" import (see infer.ts's inferStructuralSkills:
    // hasStripeExternalImport with zero anchors) — the false-negative case
    // docs/proof-graph-spike.md's H3 entry documents.
    log("  (none — no webhook-verification/db-write/idempotency-guard anchors found)");
  }
  for (const kind of ANCHOR_KIND_ORDER) {
    const hits = finding.anchors.filter((a) => a.kind === kind);
    if (hits.length === 0) continue;
    log(`  ${kind}:`);
    for (const hit of hits) log(describeAnchor(hit));
  }
  log("");

  log(`Connection: ${renderConnection(graph, finding)}`);
  log("");

  const supportingFiles = [...new Set(finding.anchors.map((a) => a.path))];
  log(`Attribution (author: ${authorLabel}):`);
  if (userCommits.length === 0) {
    log(`  no commits found for ${authorLabel}`);
  } else {
    const intersecting = supportingFiles.filter((f) => userTouchedFiles.has(f));
    if (intersecting.length > 0) {
      log(`  YES — your own added-lines diff touched: ${intersecting.join(", ")}`);
    } else if (supportingFiles.length > 0) {
      log(`  NO — none of the supporting anchor file(s) (${supportingFiles.join(", ")}) intersect files you've touched`);
    } else {
      log("  NO — this finding has no supporting anchor files at all (only the file-wide \"stripe\" import signal)");
    }
  }
  log("");

  log(`Claimed: ${finding.claimed ? "yes" : "no"}`);
  if (finding.confidence === "ambiguous") {
    log("");
    log(
      `NOT CLAIMED: this is an AMBIGUOUS finding — it is never claimed, regardless of attribution, and it can never enter a scan/submit bundle (docs/proof-graph-spike.md's "Draft bundle signal" section: AMBIGUOUS never travels in the bundle under any field). Why: ${describeAmbiguousReason(finding)}`
    );
  }
  // searchBounded (src/proof-graph/infer.ts's findInferredTriple): the
  // cross-file search hit its deterministic work budget before finishing,
  // rather than genuinely failing to find a connected pattern — a distinct
  // reason for AMBIGUOUS the user should see plainly, in the same friendly,
  // no-jargon register as the rest of this command's output.
  if (finding.searchBounded) {
    log("");
    log(
      "Note: the search space for this repository exceeded the deterministic work budget, so the classification degraded to AMBIGUOUS (the pattern may exist but was not fully searched)."
    );
  }
}
