// Scale-hardening test fixtures for the proof-graph spike's H2 hang fix
// (see docs/proof-graph-spike.md's "Scale hardening" subsection and
// src/proof-graph/infer.ts's findInferredTriple). These generators build
// realistic-SHAPED (not realistic-random) large source trees entirely
// in-memory — no git repo, no filesystem — mirroring the diagnosis
// harness's gen-fixture.mjs (kept only in the diagnosis scratchpad, never
// imported by tests) but ported as plain deterministic TypeScript: every
// choice below is a function of a file's INDEX, never Math.random() or a
// seeded PRNG, so the exact same fixture is produced on every run/machine
// (required for scale.test.ts's own determinism assertions).
//
// Every generator returns a plain path -> source map, consumed directly by
// TscParserAdapter.parse (the same "adapter.parse(path, source)" shape
// test/proof-graph/infer.test.ts's own `build()` helper uses) — no git
// commit history is needed for these cases; the code under test
// (findAnchors / inferStructuralSkills) only ever looks at one HEAD
// snapshot's parsed content, not commit history.
const FAKE_STRIPE_SECRET = "sk_test_xxx-EXAMPLE-xxx";

// -----------------------------------------------------------------------
// generateDenseSourceFiles — a "today this would take minutes, now it's
// fast" realistic-density fixture (scale.test.ts case (i)).
// -----------------------------------------------------------------------

export interface DenseFixtureOptions {
  /** Number of non-hub content files. */
  fileCount: number;
  /** DB write call sites generated PER db-write file — the axis that made
   * the pre-fix anchor-INSTANCE-level search explode combinatorially even
   * at a modest file count (see infer.ts's own diagnosis comment). */
  dbWriteCallsPerFile: number;
  /** Fraction of files that carry only the WEAK, file-level-fallback
   * webhook-verification signal (a "stripe-signature" literal + a bare
   * `import "stripe"`, no receiver-resolved call) — realistic noise from
   * test fixtures/mocks/adjacent code across a large payments-adjacent
   * codebase, and the main lever for growing the number of DISTINCT
   * webhook-verification files (this fixture's real point: many distinct
   * FILES per anchor kind, not many anchor INSTANCES in a few files). */
  stripeNoiseFraction: number;
}

function hubFileContent(): string {
  return [
    "// Hub module every other file in this fixture imports, so any two",
    "// generated files are reachable within 2 file-hops (leaf -> hub -> leaf)",
    "// -- keeps this fixture's import graph realistic-connected instead of",
    "// artificially disconnected, without needing an O(N) import fan-out per",
    "// file.",
    "export function hub(): number {",
    "  return 0;",
    "}",
    "",
  ].join("\n");
}

// Deterministic "real" webhook-verification file (receiver-resolved
// stripe.webhooks.constructEvent call) — only ever generated for the first
// two indices (mirrors the diagnosis fixture's own "2 real webhook routes"
// realism baseline; every other webhook-verification hit in this fixture is
// the weaker stripe-noise fallback below).
function webhookFileContent(i: number): string {
  return [
    'import Stripe from "stripe";',
    'import { hub } from "./hub.js";',
    "",
    `const stripe = new Stripe("${FAKE_STRIPE_SECRET}");`,
    "",
    `export async function handleWebhook_${i}(req: { headers: Record<string, string>; body: string }) {`,
    "  void hub();",
    '  const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], "whsec_xxx-EXAMPLE-xxx");',
    "  return event;",
    "}",
    "",
  ].join("\n");
}

// Weak, file-level-fallback-only webhook-verification signal (see
// anchors.ts's webhookHits: literal "stripe-signature" + file imports
// "stripe", no call resolved at all) -- the lever this fixture uses to grow
// the DISTINCT webhook-verification FILE count without needing more "real"
// receiver-resolved call sites.
function stripeNoiseFileContent(i: number): string {
  return [
    'import "stripe";',
    'import { hub } from "./hub.js";',
    "",
    'const HEADER_NAME = "stripe-signature";',
    "",
    `export function noiseFn_${i}(): string {`,
    "  void hub();",
    `  return HEADER_NAME + "_${i}";`,
    "}",
    "",
  ].join("\n");
}

// A service/repo-module-shaped db-write file exposing `callsPerFile`
// separate CRUD operations -- the density axis: real repos put SEVERAL
// write call sites in one module far more often than exactly one, and this
// is what blew up the pre-fix anchor-INSTANCE search (see infer.ts's
// diagnosis comment) without needing more distinct FILES. Deterministic,
// index-based write-shape variation (no randomness): every 6th call
// (k % 6 === 0) is upsert-shaped (idempotent by construction, per
// anchors.ts rule 1); of the rest, every other call (k % 2 === 0) does a
// lookup-before-write (rule 3) -- both rules can additionally produce an
// idempotency-guard anchor IN THIS SAME FILE, which is intentional: it
// mirrors gen-fixture.mjs's own "~50% of writes also idempotency-guard"
// realism note and is what pushes this fixture's distinct
// idempotency-guard FILE count well above just the dedicated idempotency
// files below.
function dbWriteFileContent(i: number, callsPerFile: number): string {
  const fns: string[] = [];
  for (let k = 0; k < callsPerFile; k++) {
    const isUpsert = k % 6 === 0;
    const withLookup = !isUpsert && k % 2 === 0;
    const lookup = withLookup ? `  const existing = await prisma.record${i}_${k}.findUnique({ where: { id: input.id } });\n` : "";
    const verb = isUpsert ? "upsert" : "create";
    fns.push(
      [
        `export async function run_${i}_${k}(input: { id: string }) {`,
        lookup,
        `  const result = await prisma.record${i}_${k}.${verb}({ data: input, where: { id: input.id }, create: input, update: input });`,
        "  return result;",
        "}",
      ]
        .filter((l) => l.length > 0)
        .join("\n")
    );
  }
  return [
    'import { PrismaClient } from "@prisma/client";',
    'import { hub } from "./hub.js";',
    "",
    "const prisma = new PrismaClient();",
    "",
    `function useHub_${i}() {`,
    "  void hub();",
    "}",
    "",
    fns.join("\n\n"),
    "",
  ].join("\n");
}

function idempotencyFileContent(i: number): string {
  return [
    'import { hub } from "./hub.js";',
    "",
    "const queueClient = { enqueue: (_data: unknown, _opts: { idempotencyKey: string }) => Promise.resolve() };",
    "",
    `export async function enqueue_${i}(jobData: unknown) {`,
    "  void hub();",
    `  return queueClient.enqueue(jobData, { idempotencyKey: "job-${i}" });`,
    "}",
    "",
  ].join("\n");
}

function noiseFileContent(i: number): string {
  return [
    'import { hub } from "./hub.js";',
    "",
    `export function util_${i}(x: number): number {`,
    "  void hub();",
    `  return x + ${i};`,
    "}",
    "",
  ].join("\n");
}

/**
 * Builds a deterministic path -> source map: 1 hub file (no anchors,
 * imported by every other file below) plus `opts.fileCount` content files
 * split, by fixed index ranges (never shuffled — see this module's own doc
 * comment on why), into: 2 "real" webhook files, round(fileCount * 0.3)
 * db-write files (each with `opts.dbWriteCallsPerFile` write call sites),
 * round(fileCount * 0.05) dedicated idempotency files,
 * round(fileCount * opts.stripeNoiseFraction) weak stripe-noise (webhook
 * -verification-by-fallback) files, and the remainder as anchor-less noise
 * files. Every content file imports the hub — see hubFileContent's own
 * comment on why (keeps the whole fixture's import graph small-diameter,
 * i.e. realistic-connected, without an O(N) per-file import fan-out).
 */
export function generateDenseSourceFiles(opts: DenseFixtureOptions): Record<string, string> {
  const { fileCount, dbWriteCallsPerFile, stripeNoiseFraction } = opts;
  const files: Record<string, string> = {};
  files["src/dense/hub.ts"] = hubFileContent();

  const webhookCount = Math.min(2, fileCount);
  const dbWriteCount = Math.round(fileCount * 0.3);
  const idempotencyCount = Math.round(fileCount * 0.05);
  const stripeNoiseCount = Math.round(fileCount * stripeNoiseFraction);
  const noiseCount = Math.max(0, fileCount - webhookCount - dbWriteCount - idempotencyCount - stripeNoiseCount);

  // Fixed, deterministic index ranges — no shuffling. Each generator
  // function above already imports the shared hub, so which contiguous
  // block a file falls in has no effect on the fixture's overall
  // connectivity.
  let i = 0;
  for (let k = 0; k < webhookCount; k++, i++) files[`src/dense/webhook-${i}.ts`] = webhookFileContent(i);
  for (let k = 0; k < dbWriteCount; k++, i++) files[`src/dense/db-write-${i}.ts`] = dbWriteFileContent(i, dbWriteCallsPerFile);
  for (let k = 0; k < idempotencyCount; k++, i++) files[`src/dense/idempotency-${i}.ts`] = idempotencyFileContent(i);
  for (let k = 0; k < stripeNoiseCount; k++, i++) files[`src/dense/stripe-noise-${i}.ts`] = stripeNoiseFileContent(i);
  for (let k = 0; k < noiseCount; k++, i++) files[`src/dense/noise-${i}.ts`] = noiseFileContent(i);

  return files;
}

// -----------------------------------------------------------------------
// generateBudgetBustingSourceFiles — engineered to force
// INFER_WORK_BUDGET to trip (scale.test.ts case (ii)): every generated
// leaf file imports the SAME hub, so every pairwise file distance is <= 2
// (leaf -> hub -> leaf) -- always within MAX_EDGE_DISTANCE (3), so
// findInferredTriple's early "wd > 3" pruning NEVER engages and the full
// (webhook file) x (db-write file) x (idempotency file) product is what
// actually gets evaluated, exactly the shape needed to reliably exceed the
// budget regardless of machine speed (see INFER_WORK_BUDGET's own comment
// on why this is a WORK count, not a wall-clock bound).
// -----------------------------------------------------------------------

export interface BudgetBustingOptions {
  /** Distinct file count PER anchor kind (webhook, db-write, idempotency)
   * -- the product of the three is this fixture's real "how much search
   * space" lever. All three kinds use the WEAK, file-level/no-DB-shape
   * signals (see the per-kind content functions below) so each leaf file
   * produces exactly one anchor of exactly one kind — no cross-kind
   * duplication (e.g. an upsert also counting as idempotency) muddies the
   * exact file counts this fixture is engineered around. */
  filesPerKind: number;
}

function budgetWebhookFileContent(i: number): string {
  return [
    'import "stripe";',
    'import { hub } from "./hub.js";',
    "",
    'const HEADER_NAME = "stripe-signature";',
    "",
    `export function webhookNoise_${i}(): string {`,
    "  void hub();",
    `  return HEADER_NAME + "_${i}";`,
    "}",
    "",
  ].join("\n");
}

function budgetDbWriteFileContent(i: number): string {
  return [
    'import { PrismaClient } from "@prisma/client";',
    'import { hub } from "./hub.js";',
    "",
    "const prisma = new PrismaClient();",
    "",
    `export async function run_${i}(input: { id: string }) {`,
    "  void hub();",
    `  const result = await prisma.record${i}.create({ data: input });`,
    "  return result;",
    "}",
    "",
  ].join("\n");
}

function budgetIdempotencyFileContent(i: number): string {
  return [
    'import { hub } from "./hub.js";',
    "",
    "const queueClient = { enqueue: (_data: unknown, _opts: { idempotencyKey: string }) => Promise.resolve() };",
    "",
    `export async function enqueue_${i}(jobData: unknown) {`,
    "  void hub();",
    `  return queueClient.enqueue(jobData, { idempotencyKey: "job-${i}" });`,
    "}",
    "",
  ].join("\n");
}

/**
 * Builds `1 + 3 * opts.filesPerKind` files: 1 shared hub plus
 * `filesPerKind` webhook-only, `filesPerKind` db-write-only, and
 * `filesPerKind` idempotency-only leaf files, all importing the hub (see
 * this section's own comment on why that guarantees no early pruning).
 * `filesPerKind` should be chosen so `filesPerKind ** 3` clears
 * INFER_WORK_BUDGET (src/proof-graph/infer.ts) — e.g. 130 files/kind gives
 * 130^3 = 2,197,000, just over the 2,000,000 budget.
 */
export function generateBudgetBustingSourceFiles(opts: BudgetBustingOptions): Record<string, string> {
  const { filesPerKind } = opts;
  const files: Record<string, string> = {};
  files["src/dense/hub.ts"] = hubFileContent();
  for (let i = 0; i < filesPerKind; i++) files[`src/dense/webhook-${i}.ts`] = budgetWebhookFileContent(i);
  for (let i = 0; i < filesPerKind; i++) files[`src/dense/db-write-${i}.ts`] = budgetDbWriteFileContent(i);
  for (let i = 0; i < filesPerKind; i++) files[`src/dense/idempotency-${i}.ts`] = budgetIdempotencyFileContent(i);
  return files;
}
