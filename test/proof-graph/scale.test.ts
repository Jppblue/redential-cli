// Scale hardening (see docs/proof-graph-spike.md's "Scale hardening"
// subsection): regression coverage for the H2 hang fix in
// src/proof-graph/infer.ts's findInferredTriple — a resort bug (fixed by
// hoisting sortAnchorHits calls out of the search loops) plus an unbounded
// O(anchor INSTANCES) search (fixed by searching DISTINCT FILES instead,
// with a deterministic INFER_WORK_BUDGET as the final backstop). Fixture
// generation lives in scale-fixtures.ts (no git repo, no filesystem — a
// plain path -> source map fed straight to TscParserAdapter.parse, exactly
// like infer.test.ts's own `build()` helper) so these cases run as pure
// in-memory unit tests, not end-to-end git-repo integration tests — keeps
// this whole file's runtime well under the ~20s budget noted below despite
// generating hundreds of files per case.
import { describe, expect, it } from "vitest";
import { TscParserAdapter } from "../../src/proof-graph/parser-adapter.js";
import { buildGraph } from "../../src/proof-graph/graph.js";
import { findAnchors } from "../../src/proof-graph/anchors.js";
import { inferStructuralSkills } from "../../src/proof-graph/infer.js";
import { generateBudgetBustingSourceFiles, generateDenseSourceFiles } from "./scale-fixtures.js";
import { USER, fixtureLayeredPattern } from "./fixtures.js";
import { readHeadSnapshot } from "../../src/proof-graph/snapshot.js";
import { getAllCommits } from "../../src/git.js";
import { collectUserTouchedFiles } from "../../src/proof-graph/infer.js";
import { cleanup } from "../support/fixtures.js";

const adapter = new TscParserAdapter();

function buildAndInfer(files: Record<string, string>) {
  const parsed = Object.entries(files).map(([path, source]) => adapter.parse(path, source));
  const graph = buildGraph(parsed);
  const anchors = findAnchors(graph);
  const t0 = performance.now();
  const findings = inferStructuralSkills(graph, anchors, new Set());
  const inferMs = performance.now() - t0;
  return { anchors, findings, inferMs };
}

describe("proof-graph scale hardening (infer.ts findInferredTriple)", () => {
  it("~300-file realistic-dense repo (40 db calls/file, 20% weak stripe noise): completes fast, valid deterministic classification", () => {
    const files = generateDenseSourceFiles({ fileCount: 300, dbWriteCallsPerFile: 40, stripeNoiseFraction: 0.2 });

    const { findings, inferMs } = buildAndInfer(files);

    // Generous CI bound (see this suite's own doc comment) — the pre-fix
    // anchor-instance-level search would have run for MINUTES on a fixture
    // this dense (see infer.ts's diagnosis comment / docs/proof-graph
    // -spike.md); the file-level rewrite finishes orders of magnitude
    // faster because the search space is bounded by distinct FILE counts,
    // not anchor INSTANCE counts.
    expect(inferMs).toBeLessThan(10_000);

    expect(findings).toHaveLength(1);
    expect(["inferred", "ambiguous"]).toContain(findings[0].confidence);
    // Never degraded by the work budget — this fixture's real work count is
    // comfortably under INFER_WORK_BUDGET (see scale-fixtures.ts's own
    // comment on the deliberate hub topology and infer.ts's
    // INFER_WORK_BUDGET comment on the budget's headroom above this case).
    expect(findings[0].searchBounded).toBeUndefined();

    // Deterministic: running the exact same (freshly re-parsed) fixture
    // again yields the identical classification.
    const second = buildAndInfer(generateDenseSourceFiles({ fileCount: 300, dbWriteCallsPerFile: 40, stripeNoiseFraction: 0.2 }));
    expect(second.findings).toEqual(findings);

    // Pinned once measured (see this test's own name/comment) — a
    // regression that silently changes the classification for this exact,
    // deterministic fixture is exactly what this test exists to catch.
    expect(findings[0].confidence).toBe("inferred");
    expect(findings[0].connection).not.toBeNull();
    expect(findings[0].connection!.kind).toBe("cross-file");
  });

  it("engineered to exceed INFER_WORK_BUDGET: searchBounded, ambiguous, unclaimed, and deterministic across repeated runs", () => {
    // 130 distinct files per anchor kind, all importing one shared hub (so
    // every pairwise file distance is <= 2 — see scale-fixtures.ts's own
    // comment on why this guarantees no early distance-based pruning):
    // 130^3 = 2,197,000 file-triple evaluations, comfortably over
    // INFER_WORK_BUDGET's 2,000,000.
    const files = generateBudgetBustingSourceFiles({ filesPerKind: 130 });

    const { findings, inferMs } = buildAndInfer(files);

    expect(inferMs).toBeLessThan(10_000);
    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("ambiguous");
    expect(findings[0].claimed).toBe(false);
    expect(findings[0].connection).toBeNull();
    expect(findings[0].searchBounded).toBe(true);

    // Determinism: the SAME work-budget cutoff point every time, on a
    // freshly re-parsed copy of the exact same fixture — this is the
    // property a wall-clock timeout could never guarantee (see
    // INFER_WORK_BUDGET's own comment in infer.ts).
    const second = buildAndInfer(generateBudgetBustingSourceFiles({ filesPerKind: 130 }));
    expect(second.findings).toEqual(findings);
  });

  it("H3 layered fixture regression (handler -> service -> repo, via the real fixtureLayeredPattern builder): still INFERRED, edgeDistance 2", async () => {
    const dir = fixtureLayeredPattern();
    try {
      const snapshot = await readHeadSnapshot(dir);
      const parsed = snapshot.map((f) => adapter.parse(f.path, f.content));
      const graph = buildGraph(parsed);
      const anchors = findAnchors(graph);

      const allCommits = await getAllCommits(dir);
      const userCommits = allCommits.filter((c) => c.email === USER.email);
      const userTouchedFiles = await collectUserTouchedFiles(dir, userCommits);

      const findings = inferStructuralSkills(graph, anchors, userTouchedFiles);

      expect(findings).toHaveLength(1);
      expect(findings[0].confidence).toBe("inferred");
      expect(findings[0].connection).toEqual({ kind: "cross-file", edgeDistance: 2 });
      expect(findings[0].searchBounded).toBeUndefined();
    } finally {
      cleanup(dir);
    }
  });
});
