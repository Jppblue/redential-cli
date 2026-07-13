import { describe, expect, it } from "vitest";
import { TscParserAdapter } from "../../src/proof-graph/parser-adapter.js";
import { buildGraph } from "../../src/proof-graph/graph.js";
import { findAnchors } from "../../src/proof-graph/anchors.js";
import type { AnchorHit, AnchorKind } from "../../src/proof-graph/anchors.js";

const adapter = new TscParserAdapter();

// Integration through the real adapter + real graph, per the milestone's
// test plan — never hand-built ParsedFile/ProofGraph values. Each test
// parses one or more synthetic sources and runs the actual
// snapshot -> parse -> graph -> findAnchors pipeline (minus the snapshot
// step itself, which is already covered by snapshot.test.ts).
function anchorsOf(files: Record<string, string>): AnchorHit[] {
  const parsed = Object.entries(files).map(([path, source]) => adapter.parse(path, source));
  const graph = buildGraph(parsed);
  return findAnchors(graph);
}

function only(hits: AnchorHit[], kind: AnchorKind): AnchorHit[] {
  return hits.filter((h) => h.kind === kind);
}

describe("findAnchors — webhook-verification", () => {
  it("resolves stripe.webhooks.constructEvent through a 'new' binding (rule 2)", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import Stripe from "stripe";',
        "function handleWebhook(req) {",
        '  const stripe = new Stripe("sk_test");',
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
    });

    const webhook = only(hits, "webhook-verification");
    expect(webhook).toHaveLength(1);
    expect(webhook[0]).toMatchObject({
      path: "a.ts",
      enclosingFunction: "handleWebhook",
      kind: "webhook-verification",
    });
    expect(webhook[0].reason).toContain("receiver resolved to import \"stripe\"");
  });

  it("resolves stripe.webhooks.constructEventAsync the same way", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import Stripe from "stripe";',
        "async function handleWebhook(req) {",
        '  const stripe = new Stripe("sk_test");',
        "  return stripe.webhooks.constructEventAsync(req.body, sig, secret);",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "webhook-verification")).toHaveLength(1);
  });

  it("resolves through exactly one alias hop (rule 3), per the milestone's own example", () => {
    // The literal example from the milestone: `const w = stripe.webhooks;
    // w.constructEvent(...)` — here `stripe` is DIRECTLY the import's local
    // name (rule 1), so resolving `w` needs only one alias hop.
    const hits = anchorsOf({
      "a.ts": [
        'import stripe from "stripe";',
        "const w = stripe.webhooks;",
        "function handleWebhook(req) {",
        "  return w.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
    });

    const webhook = only(hits, "webhook-verification");
    expect(webhook).toHaveLength(1);
    expect(webhook[0].enclosingFunction).toBe("handleWebhook");
  });

  it("near-miss: resolves nothing when a 'new' binding and an alias hop are stacked (deeper than one hop)", () => {
    // `stripe` here is itself a same-file binding (via `new Stripe(...)`),
    // not a direct import — so `w`'s alias hop can't resolve through it.
    // Documented depth limit, not a bug (see resolveReceiver's own
    // comment).
    const hits = anchorsOf({
      "a.ts": [
        'import Stripe from "stripe";',
        'const stripe = new Stripe("sk_test");',
        "const w = stripe.webhooks;",
        "function handleWebhook(req) {",
        "  return w.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "webhook-verification")).toEqual([]);
  });

  it("near-miss: constructEvent on a root that resolves to a NON-stripe import", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import Foo from "not-stripe";',
        "function handleWebhook(req) {",
        '  const stripe = new Foo("k");',
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "webhook-verification")).toEqual([]);
  });

  it("fallback: literal 'stripe-signature' present AND file imports stripe, with no constructEvent call at all", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import Stripe from "stripe";',
        "function readHeader(req) {",
        "  return req.headers['stripe-signature'];",
        "}",
      ].join("\n"),
    });

    const webhook = only(hits, "webhook-verification");
    expect(webhook).toHaveLength(1);
    expect(webhook[0].reason).toContain("weaker");
  });

  it("near-miss: 'stripe-signature' literal present but the file does NOT import stripe", () => {
    const hits = anchorsOf({
      "a.ts": "function readHeader(req) {\n  return req.headers['stripe-signature'];\n}\n",
    });

    expect(only(hits, "webhook-verification")).toEqual([]);
  });

  it("near-miss: 'stripe-signature' text only inside a comment produces no literal at all, hence no hit", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import Stripe from "stripe";',
        "// reads req.headers['stripe-signature'] eventually",
        "function readHeader(req) {\n  return 1;\n}",
      ].join("\n"),
    });

    expect(only(hits, "webhook-verification")).toEqual([]);
  });
});

describe("findAnchors — db-write", () => {
  it("prisma: .create(...) on a resolved root is a db-write", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "function handler() {",
        "  return prisma.user.create({ data: {} });",
        "}",
      ].join("\n"),
    });

    const writes = only(hits, "db-write");
    expect(writes).toHaveLength(1);
    expect(writes[0].reason).toContain('receiver resolved to import "@prisma/client"');
  });

  it("prisma: a read (findUnique) is NOT a db-write", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "function handler() {",
        "  return prisma.user.findUnique({ where: {} });",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "db-write")).toEqual([]);
  });

  it("pg: pool.query(...) with an INSERT string argument is a db-write", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { Pool } from "pg";',
        "const pool = new Pool();",
        "function handler() {",
        '  return pool.query("INSERT INTO users (id) VALUES ($1)", [1]);',
        "}",
      ].join("\n"),
    });

    expect(only(hits, "db-write")).toHaveLength(1);
  });

  it("near-miss: pg pool.query(...) with a SELECT string argument is NOT a db-write", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { Pool } from "pg";',
        "const pool = new Pool();",
        "function handler() {",
        '  return pool.query("SELECT * FROM users");',
        "}",
      ].join("\n"),
    });

    expect(only(hits, "db-write")).toEqual([]);
  });

  it("known limitation: an INSERT inside a template literal WITH substitutions is not captured", () => {
    // ParsedCall.stringArgs only captures a plain string literal or a
    // no-substitution template literal (parser-adapter.ts) — a template
    // WITH a substitution has no single static text, so this pg call's
    // stringArgs is [] and the write rule never sees "insert" at all.
    const hits = anchorsOf({
      "a.ts": [
        'import { Pool } from "pg";',
        "const pool = new Pool();",
        "function handler(id) {",
        "  return pool.query(`INSERT INTO users (id) VALUES (${id})`);",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "db-write")).toEqual([]);
  });

  it("knex: .insert(...) chained off an invoked table selector is a db-write via the documented fallback", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import knex from "knex";',
        "function handler() {",
        '  return knex("users").insert({ id: 1 });',
        "}",
      ].join("\n"),
    });

    const writes = only(hits, "db-write");
    expect(writes).toHaveLength(1);
    expect(writes[0].reason).toContain("file-level fallback");
  });

  it("supabase: .insert(...) chained off an invoked .from(...) is a db-write via the documented fallback", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { createClient } from "@supabase/supabase-js";',
        "const supabase = createClient(url, key);",
        "function handler() {",
        '  return supabase.from("orders").insert({ id: 1 });',
        "}",
      ].join("\n"),
    });

    const writes = only(hits, "db-write");
    expect(writes).toHaveLength(1);
    expect(writes[0].reason).toContain("file-level fallback");
  });

  it("near-miss: supabase-shaped chained call without the package import produces no fallback hit", () => {
    const hits = anchorsOf({
      "a.ts": [
        "const supabase = makeClient(url, key);",
        "function handler() {",
        '  return supabase.from("orders").insert({ id: 1 });',
        "}",
      ].join("\n"),
    });

    expect(only(hits, "db-write")).toEqual([]);
  });

  it("drizzle-orm: .insert(...) on a resolved root is a db-write", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { drizzle } from "drizzle-orm";',
        "const db = drizzle(conn);",
        "function handler() {",
        "  return db.insert(users).values({ id: 1 });",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "db-write")).toHaveLength(1);
  });
});

describe("findAnchors — idempotency-guard", () => {
  it("rule (1): an upsert-shaped write is BOTH a db-write and an idempotency-guard hit", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "function handler() {",
        "  return prisma.user.upsert({ where: {}, create: {}, update: {} });",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "db-write")).toHaveLength(1);
    const guards = only(hits, "idempotency-guard");
    expect(guards).toHaveLength(1);
    expect(guards[0].line).toBe(only(hits, "db-write")[0].line);
    expect(guards[0].reason).toContain("upsert-shaped");
  });

  it("rule (1): a pg INSERT ... ON CONFLICT ... is upsert-shaped", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { Pool } from "pg";',
        "const pool = new Pool();",
        "function handler() {",
        '  return pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET id = $1");',
        "}",
      ].join("\n"),
    });

    expect(only(hits, "db-write")).toHaveLength(1);
    expect(only(hits, "idempotency-guard")).toHaveLength(1);
  });

  it("rule (2): an explicit idempotencyKey argument property is a guard, independent of any DB resolution", () => {
    const hits = anchorsOf({
      "a.ts": [
        "function chargeCustomer(key) {",
        "  return stripeCharge({ idempotencyKey: key, amount: 100 });",
        "}",
      ].join("\n"),
    });

    const guards = only(hits, "idempotency-guard");
    expect(guards).toHaveLength(1);
    expect(guards[0].reason).toContain("idempotencyKey");
    expect(only(hits, "db-write")).toEqual([]); // stripeCharge isn't a tracked DB package at all
  });

  it("rule (3): a read call in the SAME function, at a lower line, guards a later write", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "async function handler() {",
        "  const existing = await prisma.user.findUnique({ where: {} });",
        "  if (existing) return existing;",
        "  return prisma.user.create({ data: {} });",
        "}",
      ].join("\n"),
    });

    const guards = only(hits, "idempotency-guard");
    expect(guards).toHaveLength(1);
    expect(guards[0].reason).toContain("lookup-before-write");
    expect(guards[0].line).toBe(only(hits, "db-write")[0].line);
  });

  it("near-miss: a findUnique in a DIFFERENT function than the write does not guard it", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "async function lookup() {",
        "  return prisma.user.findUnique({ where: {} });",
        "}",
        "async function handler() {",
        "  return prisma.user.create({ data: {} });",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "idempotency-guard")).toEqual([]);
  });

  it("near-miss: a findUnique AFTER the write (higher line) does not guard it", () => {
    const hits = anchorsOf({
      "a.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "async function handler() {",
        "  const created = await prisma.user.create({ data: {} });",
        "  const check = await prisma.user.findUnique({ where: {} });",
        "  return created ?? check;",
        "}",
      ].join("\n"),
    });

    expect(only(hits, "idempotency-guard")).toEqual([]);
  });
});

describe("findAnchors — determinism and ordering", () => {
  it("returns an equal (deep) array for the same input graph built twice", () => {
    const files = {
      "a.ts": [
        'import Stripe from "stripe";',
        "function handleWebhook(req) {",
        '  const stripe = new Stripe("k");',
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
    };
    expect(anchorsOf(files)).toEqual(anchorsOf(files));
  });

  it("sorts hits by (path, line, kind)", () => {
    const hits = anchorsOf({
      "b.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const prisma = new PrismaClient();",
        "function handler() {",
        "  return prisma.user.upsert({ where: {}, create: {}, update: {} });",
        "}",
      ].join("\n"),
      "a.ts": [
        'import Stripe from "stripe";',
        "function handleWebhook(req) {",
        '  const stripe = new Stripe("k");',
        "  return stripe.webhooks.constructEvent(req.body, sig, secret);",
        "}",
      ].join("\n"),
    });

    // a.ts sorts before b.ts regardless of the object key insertion order
    // above (findAnchors iterates graph.files(), which is itself sorted —
    // see graph.ts's buildGraph), and within b.ts the upsert produces two
    // hits (db-write, idempotency-guard) at the SAME line — db-write sorts
    // before idempotency-guard alphabetically, per the (path, line, kind)
    // contract.
    expect(hits.map((h) => [h.path, h.kind])).toEqual([
      ["a.ts", "webhook-verification"],
      ["b.ts", "db-write"],
      ["b.ts", "idempotency-guard"],
    ]);
  });
});
