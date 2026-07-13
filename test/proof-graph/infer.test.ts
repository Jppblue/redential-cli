import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TscParserAdapter } from "../../src/proof-graph/parser-adapter.js";
import { buildGraph } from "../../src/proof-graph/graph.js";
import { findAnchors } from "../../src/proof-graph/anchors.js";
import { collectUserTouchedFiles, inferStructuralSkills, STRUCTURAL_SKILL_SLUG } from "../../src/proof-graph/infer.js";
import type { StructuralFinding } from "../../src/proof-graph/infer.js";
import { ScanError } from "../../src/errors.js";
import type { RawCommit } from "../../src/git.js";
import { cleanup, commit, createRepo } from "../support/fixtures.js";

const adapter = new TscParserAdapter();

// Integration through the real adapter + real graph + real findAnchors, per
// the milestone's test plan — never hand-built ParsedFile/ProofGraph/
// AnchorHit values. `files` maps a repo-relative path to its full source.
function build(files: Record<string, string>) {
  const parsed = Object.entries(files).map(([path, source]) => adapter.parse(path, source));
  const graph = buildGraph(parsed);
  const anchors = findAnchors(graph);
  return { graph, anchors };
}

function infer(files: Record<string, string>, userTouchedFiles: Set<string> = new Set()): StructuralFinding[] {
  const { graph, anchors } = build(files);
  return inferStructuralSkills(graph, anchors, userTouchedFiles);
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
});

describe("inferStructuralSkills — DIRECT", () => {
  it("same-function: webhook verification + upsert-shaped write in one function -> DIRECT (same-function), edgeDistance 0", () => {
    const findings = infer({
      "a.ts": [
        'import Stripe from "stripe";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "async function handleWebhook(req) {",
        '  const stripe = new Stripe("sk_test");',
        "  const event = stripe.webhooks.constructEvent(req.body, sig, secret);",
        "  await prisma.payment.upsert({ where: { id: event.id }, create: {}, update: {} });",
        "}",
      ].join("\n"),
    });

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.slug).toBe(STRUCTURAL_SKILL_SLUG);
    expect(finding.confidence).toBe("direct");
    expect(finding.connection).toEqual({ kind: "same-function", edgeDistance: 0 });
    expect(finding.anchors.map((a) => a.kind).sort()).toEqual(["db-write", "idempotency-guard", "webhook-verification"]);
    expect(finding.anchors.every((a) => a.path === "a.ts" && a.enclosingFunction === "handleWebhook")).toBe(true);
  });

  it("same-file, different functions -> DIRECT (same-file), edgeDistance 0", () => {
    const findings = infer({
      "a.ts": [
        'import Stripe from "stripe";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        'const stripe = new Stripe("sk_test");',
        "",
        "function verifyWebhook(req) {",
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
        "",
        "async function persist(event) {",
        "  await prisma.payment.upsert({ where: { id: event.id }, create: {}, update: {} });",
        "}",
      ].join("\n"),
    });

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.confidence).toBe("direct");
    expect(finding.connection).toEqual({ kind: "same-file", edgeDistance: 0 });
    expect(new Set(finding.anchors.map((a) => a.enclosingFunction))).toEqual(new Set(["verifyWebhook", "persist"]));
  });
});

describe("inferStructuralSkills — INFERRED", () => {
  it("3-file chain handler -> service -> repo, anchors spread across all three -> INFERRED, edgeDistance 2", () => {
    const findings = infer({
      "handler.ts": [
        'import Stripe from "stripe";',
        'import { process } from "./service";',
        "",
        'const stripe = new Stripe("sk_test");',
        "",
        "export async function handleWebhook(req) {",
        "  const event = stripe.webhooks.constructEvent(req.body, sig, secret);",
        "  await process(event);",
        "}",
      ].join("\n"),
      "service.ts": [
        'import { save } from "./repo";',
        "",
        "export async function process(event) {",
        "  await save(event, { idempotencyKey: event.id });",
        "}",
      ].join("\n"),
      "repo.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function save(event, opts) {",
        "  await prisma.payment.create({ data: event });",
        "}",
      ].join("\n"),
    });

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.confidence).toBe("inferred");
    expect(finding.connection).toEqual({ kind: "cross-file", edgeDistance: 2 });
    const paths = finding.anchors.map((a) => a.path).sort();
    expect(paths).toEqual(["handler.ts", "repo.ts", "service.ts"]);
  });

  it("4-edge-distant files (5-file import chain) -> distance exceeds 3, NOT inferred -> AMBIGUOUS", () => {
    const findings = infer({
      "file1.ts": [
        'import Stripe from "stripe";',
        'import { step2 } from "./file2";',
        "",
        'const stripe = new Stripe("sk_test");',
        "",
        "export async function handleWebhook(req) {",
        "  const event = stripe.webhooks.constructEvent(req.body, sig, secret);",
        "  await step2(event);",
        "}",
      ].join("\n"),
      "file2.ts": [
        'import { step3 } from "./file3";',
        "export async function step2(event) {",
        "  await step3(event);",
        "}",
      ].join("\n"),
      "file3.ts": [
        'import { step4 } from "./file4";',
        "export async function step3(event) {",
        "  await step4(event, { idempotencyKey: event.id });",
        "}",
      ].join("\n"),
      "file4.ts": [
        'import { step5 } from "./file5";',
        "export async function step4(event, opts) {",
        "  await step5(event);",
        "}",
      ].join("\n"),
      "file5.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function step5(event) {",
        "  await prisma.payment.create({ data: event });",
        "}",
      ].join("\n"),
    });

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.confidence).toBe("ambiguous");
    expect(finding.connection).toBeNull();
    expect(finding.claimed).toBe(false);
    // All three kinds are present as partial evidence even though the
    // pattern isn't classified as connected.
    expect(new Set(finding.anchors.map((a) => a.kind))).toEqual(
      new Set(["webhook-verification", "idempotency-guard", "db-write"])
    );
  });
});

describe("inferStructuralSkills — AMBIGUOUS", () => {
  it("anchors spread across files NOT connected by imports at all -> AMBIGUOUS (pattern not connected)", () => {
    const findings = infer({
      "a.ts": [
        'import Stripe from "stripe";',
        'const stripe = new Stripe("sk_test");',
        "export function handleWebhook(req) {",
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
      "b.ts": [
        "export function guard(save, event) {",
        "  return save(event, { idempotencyKey: event.id });",
        "}",
      ].join("\n"),
      "c.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "export async function write(event) {",
        "  await prisma.payment.create({ data: event });",
        "}",
      ].join("\n"),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("ambiguous");
    expect(findings[0].connection).toBeNull();
    expect(findings[0].claimed).toBe(false);
  });

  it("stripe imported, zero anchors -> AMBIGUOUS, claimed=false", () => {
    const findings = infer({
      "a.ts": ['import Stripe from "stripe";', "export const x = 1;"].join("\n"),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("ambiguous");
    expect(findings[0].anchors).toEqual([]);
    expect(findings[0].attributed).toBe(false);
    expect(findings[0].claimed).toBe(false);
  });

  it("webhook-verification anchor alone (no db-write/idempotency anywhere) -> AMBIGUOUS, claimed=false", () => {
    const findings = infer({
      "a.ts": [
        'import Stripe from "stripe";',
        'const stripe = new Stripe("sk_test");',
        "export function handleWebhook(req) {",
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("ambiguous");
    expect(findings[0].anchors).toHaveLength(1);
    expect(findings[0].anchors[0].kind).toBe("webhook-verification");
    expect(findings[0].claimed).toBe(false);
  });
});

describe("inferStructuralSkills — no finding at all", () => {
  it("no stripe presence at all and no anchors -> []", () => {
    const findings = infer({
      "a.ts": ["export function add(a, b) {", "  return a + b;", "}"].join("\n"),
    });

    expect(findings).toEqual([]);
  });

  it("non-payment DB write anchors present but no stripe anywhere -> [] (no webhook signal to be ambiguous about)", () => {
    const findings = infer({
      "a.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "export async function write(event) {",
        "  await prisma.payment.create({ data: event });",
        "}",
      ].join("\n"),
    });

    expect(findings).toEqual([]);
  });
});

describe("inferStructuralSkills — attribution", () => {
  const directFixture = {
    "a.ts": [
      'import Stripe from "stripe";',
      'import { PrismaClient } from "@prisma/client";',
      "",
      "const prisma = new PrismaClient();",
      "",
      "async function handleWebhook(req) {",
      '  const stripe = new Stripe("sk_test");',
      "  const event = stripe.webhooks.constructEvent(req.body, sig, secret);",
      "  await prisma.payment.upsert({ where: { id: event.id }, create: {}, update: {} });",
      "}",
    ].join("\n"),
  };

  it("anchor files untouched by user -> not attributed, not claimed", () => {
    const findings = infer(directFixture, new Set(["other.ts"]));

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("direct");
    expect(findings[0].attributed).toBe(false);
    expect(findings[0].claimed).toBe(false);
  });

  it("one anchor file touched by user -> attributed, claimed", () => {
    const findings = infer(directFixture, new Set(["a.ts"]));

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("direct");
    expect(findings[0].attributed).toBe(true);
    expect(findings[0].claimed).toBe(true);
  });

  it("ambiguous findings compute attribution but never claim, even when touched", () => {
    const { graph, anchors } = build({
      "a.ts": [
        'import Stripe from "stripe";',
        'const stripe = new Stripe("sk_test");',
        "export function handleWebhook(req) {",
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
    });
    const findings = inferStructuralSkills(graph, anchors, new Set(["a.ts"]));

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("ambiguous");
    expect(findings[0].attributed).toBe(true);
    expect(findings[0].claimed).toBe(false);
  });
});

describe("inferStructuralSkills — taxonomy defense in depth", () => {
  it("throws ScanError when the structural slug is missing from the supplied taxonomy", () => {
    const dir = mkdtempSync(join(tmpdir(), "redential-infer-taxonomy-"));
    dirs.push(dir);
    const taxonomyPath = join(dir, "taxonomy.json");
    writeFileSync(
      taxonomyPath,
      JSON.stringify({ skills: [{ slug: "payments/stripe", label: "Stripe" }] })
    );

    const graph = buildGraph([]);
    expect(() => inferStructuralSkills(graph, [], new Set(), { taxonomyPath })).toThrow(ScanError);
  });

  it("does not throw against the real, shipped taxonomy.json (default path)", () => {
    const graph = buildGraph([]);
    expect(() => inferStructuralSkills(graph, [], new Set())).not.toThrow();
  });
});

describe("collectUserTouchedFiles", () => {
  function fakeCommit(sha: string, isMerge: boolean): RawCommit {
    return {
      sha,
      email: "you@example.com",
      authorDate: new Date("2024-01-01T00:00:00Z"),
      committerDate: new Date("2024-01-01T00:00:00Z"),
      signed: false,
      churn: [],
      isMerge,
    };
  }

  it("returns files with added lines; skips merge commits; excludes churn-excluded paths (e.g. dist/)", async () => {
    const dir = createRepo();
    dirs.push(dir);

    const sha1 = commit(dir, {
      message: "add a",
      authorName: "You",
      authorEmail: "you@example.com",
      files: { "src/a.ts": "export const a = 1;\n" },
    });
    const sha2 = commit(dir, {
      message: "add b and vendored dist output",
      authorName: "You",
      authorEmail: "you@example.com",
      files: {
        "src/b.ts": "export const b = 2;\n",
        "dist/bundle.js": "/* built output */\n",
      },
    });
    // A real commit, but marked isMerge=true in the RawCommit passed in —
    // collectUserTouchedFiles must skip it WITHOUT ever fetching its diff,
    // proving the merge-skip happens before the git call, not as a
    // post-hoc filter of results.
    const sha3 = commit(dir, {
      message: "add c (will be marked as a merge commit)",
      authorName: "You",
      authorEmail: "you@example.com",
      files: { "src/c.ts": "export const c = 3;\n" },
    });

    const commits = [fakeCommit(sha1, false), fakeCommit(sha2, false), fakeCommit(sha3, true)];
    const touched = await collectUserTouchedFiles(dir, commits);

    expect(touched.has("src/a.ts")).toBe(true);
    expect(touched.has("src/b.ts")).toBe(true);
    expect(touched.has("dist/bundle.js")).toBe(false);
    expect(touched.has("src/c.ts")).toBe(false);
  });

  it("returns an empty set for no commits", async () => {
    const dir = createRepo();
    dirs.push(dir);
    const touched = await collectUserTouchedFiles(dir, []);
    expect(touched.size).toBe(0);
  });
});

// -----------------------------------------------------------------------
// H6 phase 2a — iap-flow classification, Mercado Pago's optional-
// idempotency confidence cap, and the ambiguous-anchor-filtering fix (a
// finding must carry ONLY its own pattern's anchors, never another
// provider's). Same integration-through-real-pipeline style as every test
// above (the `infer`/`build` helpers).
// -----------------------------------------------------------------------

describe("inferStructuralSkills — iap-flow", () => {
  it("same-function: configure + purchase + entitlement-gate in one function -> DIRECT (same-function), edgeDistance 0", () => {
    const findings = infer({
      "a.ts": [
        'import Purchases from "react-native-purchases";',
        "async function setupAndGate(customerInfo, pkg) {",
        "  Purchases.configure({ apiKey: 'abc' });",
        "  await Purchases.purchasePackage(pkg);",
        "  return customerInfo.entitlements.active.hasOwnProperty('pro');",
        "}",
      ].join("\n"),
    });

    const finding = findings.find((f) => f.slug === "payments/iap-subscription-flow");
    expect(finding).toBeDefined();
    expect(finding!.confidence).toBe("direct");
    expect(finding!.connection).toEqual({ kind: "same-function", edgeDistance: 0 });
    expect(finding!.anchors.map((a) => a.kind).sort()).toEqual(["iap-configure", "iap-entitlement-gate", "iap-purchase"]);
  });

  it("react-native-purchases imported, zero IAP anchors -> AMBIGUOUS, claimed=false", () => {
    const findings = infer({
      "a.ts": ['import Purchases from "react-native-purchases";', "export const x = 1;"].join("\n"),
    });

    const finding = findings.find((f) => f.slug === "payments/iap-subscription-flow");
    expect(finding).toBeDefined();
    expect(finding!.confidence).toBe("ambiguous");
    expect(finding!.anchors).toEqual([]);
    expect(finding!.claimed).toBe(false);
  });
});

describe("inferStructuralSkills — Mercado Pago optional-idempotency cap", () => {
  it("idempotency present (upsert-shaped write) -> normal triple classification, DIRECT reachable", () => {
    const findings = infer({
      "a.ts": [
        'import { MercadoPagoConfig, Preference } from "mercadopago";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "const mpClient = new MercadoPagoConfig({ accessToken: 'x' });",
        "const preference = new Preference(mpClient);",
        "",
        "async function handler(body) {",
        "  const pref = await preference.create({ body });",
        "  await prisma.payment.upsert({ where: { id: pref.id }, create: {}, update: {} });",
        "  return pref;",
        "}",
      ].join("\n"),
    });

    const finding = findings.find((f) => f.slug === "payments/mercadopago-flow");
    expect(finding).toBeDefined();
    expect(finding!.confidence).toBe("direct");
    expect(finding!.connection).toEqual({ kind: "same-function", edgeDistance: 0 });
  });

  it("idempotency globally absent -> capped at INFERRED, even though webhook+db-write are in the SAME function", () => {
    const findings = infer({
      "a.ts": [
        'import { MercadoPagoConfig, Preference } from "mercadopago";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "const mpClient = new MercadoPagoConfig({ accessToken: 'x' });",
        "const preference = new Preference(mpClient);",
        "",
        "async function handler(body) {",
        "  const pref = await preference.create({ body });",
        "  await prisma.payment.create({ data: { id: pref.id } });",
        "  return pref;",
        "}",
      ].join("\n"),
    });

    const finding = findings.find((f) => f.slug === "payments/mercadopago-flow");
    expect(finding).toBeDefined();
    // Never "direct", per the documented cap — even though the pair search
    // found the two required anchors in the very same function.
    expect(finding!.confidence).toBe("inferred");
    expect(finding!.connection).toEqual({ kind: "same-function", edgeDistance: 0 });
    expect(finding!.anchors.map((a) => a.kind).sort()).toEqual(["db-write", "webhook-verification"]);
  });
});

describe("inferStructuralSkills — ambiguous findings carry only their OWN pattern's anchors", () => {
  it("two providers present (Stripe + PayPal), each ambiguous on its own webhook anchor, never cross-contaminated", () => {
    const findings = infer({
      "stripe.ts": [
        'import Stripe from "stripe";',
        'const stripe = new Stripe("k");',
        "export function handleStripeWebhook(req) {",
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
      "paypal.ts": [
        'import { Client } from "@paypal/paypal-server-sdk";',
        "export function handlePaypalWebhook(req) {",
        "  const client = new Client(config);",
        "  return client.verifyWebhookSignature(req.body);",
        "}",
      ].join("\n"),
    });

    expect(findings).toHaveLength(2);

    const stripeFinding = findings.find((f) => f.slug === "payments/payment-webhook-flow");
    const paypalFinding = findings.find((f) => f.slug === "payments/paypal-webhook-flow");
    expect(stripeFinding).toBeDefined();
    expect(paypalFinding).toBeDefined();

    expect(stripeFinding!.confidence).toBe("ambiguous");
    expect(stripeFinding!.anchors).toHaveLength(1);
    expect(stripeFinding!.anchors[0].providerSlug).toBe("payments/payment-webhook-flow");

    expect(paypalFinding!.confidence).toBe("ambiguous");
    expect(paypalFinding!.anchors).toHaveLength(1);
    expect(paypalFinding!.anchors[0].providerSlug).toBe("payments/paypal-webhook-flow");
  });
});
