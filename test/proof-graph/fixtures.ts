// H3 of the proof-graph spike (see docs/proof-graph-spike.md): programmatic
// tmpdir git-repo fixtures for detection.test.ts's end-to-end pipeline test.
// Same posture as every other fixture in this repo (CLAUDE.md's testing
// conventions): a tiny git repo built in a tmpdir at test time, never a
// committed fixture directory with real history. Reuses test/support/
// fixtures.ts's createRepo/commit (which already disables git's background
// maintenance — see commit 36539f4 — and is the exact same primitive every
// other test in this repo builds fixture repos with).
//
// Each builder below returns only the repo's tmpdir path (a plain string),
// mirroring createRepo()'s own return type and the pattern
// test/proof-graph/infer.test.ts's "collectUserTouchedFiles" describe block
// already uses: the caller pushes the path onto its own `dirs` array and
// calls test/support/fixtures.ts's cleanup() in an afterEach, rather than
// each fixture managing its own disposal.
import { commit, createRepo } from "../support/fixtures.js";

// Two identities every case below is built against. Exported so
// detection.test.ts can assert against them directly (e.g. filtering
// getAllCommits' output by USER.email) instead of re-declaring the same
// strings.
export const USER = { name: "Dev User", email: "user@example.com" };
export const OTHER = { name: "Other Dev", email: "other@example.com" };

// Obviously-fake secret value (repo rule: "Never create files with secrets
// or example values that look real (use xxx-EXAMPLE-xxx)") — reused across
// every fixture below that needs a Stripe secret-key-shaped literal.
const FAKE_STRIPE_SECRET = "sk_test_xxx-EXAMPLE-xxx";

/**
 * ONE file (src/webhook.ts), committed by USER, containing the full
 * connected pattern (webhook signature verification -> DB read -> DB write,
 * all inside one function) — the shape inferStructuralSkills classifies as
 * DIRECT (same-function).
 */
export function fixtureDirectPattern(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add stripe webhook handler",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/webhook.ts": [
        'import Stripe from "stripe";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        `const stripe = new Stripe("${FAKE_STRIPE_SECRET}");`,
        "const prisma = new PrismaClient();",
        "",
        "export async function handleWebhook(req, res) {",
        '  const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);',
        "  const existing = await prisma.payment.findUnique({ where: { id: event.id } });",
        '  if (existing) return res.status(200).send("already processed");',
        "  await prisma.payment.create({ data: { id: event.id } });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * THREE files, all committed by USER, connected only through RELATIVE
 * imports: src/handler.ts (webhook signature verification) imports
 * src/service.ts, which imports src/repo.ts (a Prisma upsert — which is
 * BOTH the db-write and the idempotency-guard anchor, per anchors.ts's
 * "upsert is idempotent by construction" rule; that dual count is
 * intentional, not a fixture bug). Import-chain distance from
 * src/handler.ts to src/repo.ts is 2 hops (handler -> service -> repo),
 * within inferStructuralSkills' <=3 edge bound — the shape classifies as
 * INFERRED.
 */
export function fixtureLayeredPattern(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add layered webhook handler (handler -> service -> repo)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/handler.ts": [
        'import Stripe from "stripe";',
        'import { persistEvent } from "./service.js";',
        "",
        `const stripe = new Stripe("${FAKE_STRIPE_SECRET}");`,
        "",
        "export async function handleWebhook(req) {",
        '  const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);',
        "  await persistEvent(event);",
        "}",
        "",
      ].join("\n"),
      "src/service.ts": [
        'import { upsertPayment } from "./repo.js";',
        "",
        "export async function persistEvent(event) {",
        "  await upsertPayment(event);",
        "}",
        "",
      ].join("\n"),
      "src/repo.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function upsertPayment(event) {",
        "  await prisma.payment.upsert({ where: { id: event.id }, create: { id: event.id }, update: {} });",
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * USER commits a file that ONLY imports "stripe" — no webhook-verification
 * call, no DB write, no idempotency guard reachable anywhere. The deliberate
 * false-negative case (docs/proof-graph-spike.md's H3 entry): the structural
 * tier classifies this AMBIGUOUS and never claims it, while Tier 1's plain
 * import-based skill-detect.ts still reports "payments/stripe" from the same
 * import line — both tiers are expected to coexist, see detection.test.ts's
 * own comment on this case.
 */
export function fixtureStripeUnused(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add unused stripe client",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/stripe-client.ts": [
        'import Stripe from "stripe";',
        "",
        `export const stripe = new Stripe("${FAKE_STRIPE_SECRET}");`,
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * The exact same connected pattern as fixtureDirectPattern's src/webhook.ts,
 * but committed by OTHER — not USER. USER separately commits only an
 * unrelated file (src/util.ts, no anchors at all). The structural pattern is
 * still present and classifies DIRECT (findAnchors/inferStructuralSkills
 * operate on the HEAD snapshot, independent of who authored what), but
 * attribution (file-level intersection with USER's own touched files, see
 * infer.ts's collectUserTouchedFiles) fails: attributed=false, claimed=false
 * for USER.
 */
export function fixtureOtherAuthor(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add stripe webhook handler",
    authorName: OTHER.name,
    authorEmail: OTHER.email,
    files: {
      "src/webhook.ts": [
        'import Stripe from "stripe";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        `const stripe = new Stripe("${FAKE_STRIPE_SECRET}");`,
        "const prisma = new PrismaClient();",
        "",
        "export async function handleWebhook(req, res) {",
        '  const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);',
        "  const existing = await prisma.payment.findUnique({ where: { id: event.id } });",
        '  if (existing) return res.status(200).send("already processed");',
        "  await prisma.payment.create({ data: { id: event.id } });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  commit(dir, {
    message: "add unrelated util",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/util.ts": ["export function noop() {", "  return null;", "}", ""].join("\n"),
    },
  });
  return dir;
}

/**
 * USER commits a file where "stripe"/"constructEvent"/"prisma" appear ONLY
 * inside comments and a no-substitution template-literal string (a
 * docs-generator-style file rendering an example code snippet) — never as a
 * real `import` declaration or a real call. The TypeScript compiler API
 * parses comments as trivia (never AST nodes) and a template literal's own
 * text as a single string value (never re-parsed as code), so this produces
 * neither a real ParsedImport nor any ParsedCall — findAnchors must return
 * [] and inferStructuralSkills must return [] (no stripe presence anywhere
 * in the real syntax tree, not even the weaker "external import" signal).
 */
export function fixtureCommentsOnly(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add webhook docs generator",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/docs-generator.ts": [
        "// Example snippet for our docs site (never executed, never imported):",
        "//",
        '// import Stripe from "stripe";',
        '// import { PrismaClient } from "@prisma/client";',
        "//",
        "// const event = stripe.webhooks.constructEvent(body, sig, secret);",
        "// const existing = await prisma.payment.findUnique({ where: { id: event.id } });",
        "// await prisma.payment.create({ data: { id: event.id } });",
        "",
        "export function renderExampleSnippet() {",
        "  const snippet = `stripe.webhooks.constructEvent(body, sig, secret)`;",
        "  return snippet;",
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

// -----------------------------------------------------------------------
// H6 phase 2b — end-to-end fixtures for the 5 new patterns anchors.ts/
// infer.ts's H6 phase 2a work added: PayPal, Mercado Pago, Lemon Squeezy,
// Paddle (all "webhook-flow" pattern kind, same shape family as the Stripe
// fixtures above) and RevenueCat/IAP (its own "iap-flow" shape). Same
// posture/reuse rationale as every builder above: tiny tmpdir git repos,
// USER/OTHER identities, one or two commits, 1-3 files per repo.
//
// A shared "Stripe noise" file (stripeNoiseFileContent below) is added to
// each new provider's "imported but structurally unused" fixture — see that
// helper's own comment for why: it's what actually exercises the H6 phase 2a
// ownAnchors fix (a *different* provider's own webhook-verification anchor
// present in the SAME repo must never leak into this provider's AMBIGUOUS
// finding), not just a restatement of fixtureStripeUnused's simpler "nothing
// else in the repo at all" case.
// -----------------------------------------------------------------------

/**
 * The exact same connected pattern as fixtureDirectPattern's src/webhook.ts,
 * committed under a different path/function name so it can be added
 * alongside another provider's own file in the SAME repo/commit as
 * cross-provider "noise" — see the "imported but structurally unused"
 * fixtures below for each of the 5 new patterns, all of which use this to
 * prove a *different* provider's webhook-verification anchor doesn't leak
 * into the unused provider's AMBIGUOUS finding (the H6 phase 2a ownAnchors
 * fix).
 */
function stripeNoiseFileContent(): string {
  return [
    'import Stripe from "stripe";',
    'import { PrismaClient } from "@prisma/client";',
    "",
    `const stripe = new Stripe("${FAKE_STRIPE_SECRET}");`,
    "const prisma = new PrismaClient();",
    "",
    "export async function handleStripeNoiseWebhook(req, res) {",
    '  const event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], secret);',
    "  const existing = await prisma.payment.findUnique({ where: { id: event.id } });",
    '  if (existing) return res.status(200).send("already processed");',
    "  await prisma.payment.create({ data: { id: event.id } });",
    '  res.status(200).send("ok");',
    "}",
    "",
  ].join("\n");
}

// -----------------------------------------------------------------------
// PayPal (payments/paypal-webhook-flow)
// -----------------------------------------------------------------------

/**
 * ONE file, USER-committed: paypalClient.verifyWebhookSignature(...) (root
 * resolved directly to the "@paypal/checkout-server-sdk" import, per
 * WEBHOOK_PROVIDERS' paypal descriptor) -> Prisma upsert (both the db-write
 * AND, by construction, the idempotency-guard anchor), all inside one
 * function -> DIRECT (same-function).
 */
export function fixturePaypalDirect(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add paypal webhook handler",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/webhook.ts": [
        'import paypalClient from "@paypal/checkout-server-sdk";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function handlePaypalWebhook(req, res) {",
        "  const verification = await paypalClient.verifyWebhookSignature({",
        '    transmissionId: req.headers["paypal-transmission-id"],',
        "    webhookEvent: req.body,",
        "  });",
        "  await prisma.payment.upsert({",
        "    where: { id: verification.id },",
        "    create: { id: verification.id },",
        "    update: {},",
        "  });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * THREE files connected only by relative imports: src/handler.ts (PayPal
 * verify call) -> src/service.ts -> src/repo.ts (Prisma upsert). Same 2-hop
 * shape as fixtureLayeredPattern -> INFERRED.
 */
export function fixturePaypalLayered(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add layered paypal webhook handler (handler -> service -> repo)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/handler.ts": [
        'import paypalClient from "@paypal/checkout-server-sdk";',
        'import { persistEvent } from "./service.js";',
        "",
        "export async function handlePaypalWebhook(req) {",
        "  const verification = await paypalClient.verifyWebhookSignature({",
        '    transmissionId: req.headers["paypal-transmission-id"],',
        "    webhookEvent: req.body,",
        "  });",
        "  await persistEvent(verification);",
        "}",
        "",
      ].join("\n"),
      "src/service.ts": [
        'import { upsertPayment } from "./repo.js";',
        "",
        "export async function persistEvent(verification) {",
        "  await upsertPayment(verification);",
        "}",
        "",
      ].join("\n"),
      "src/repo.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function upsertPayment(verification) {",
        "  await prisma.payment.upsert({ where: { id: verification.id }, create: { id: verification.id }, update: {} });",
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * USER commits a file that ONLY imports "@paypal/checkout-server-sdk" — no
 * verifyWebhookSignature call anywhere — alongside an UNRELATED, fully
 * connected Stripe pattern (stripeNoiseFileContent) in the same commit. The
 * PayPal pattern classifies AMBIGUOUS (package imported, never wired in);
 * the Stripe pattern classifies DIRECT. Proves the H6 phase 2a ownAnchors
 * fix: the PayPal AMBIGUOUS finding's anchors must never include Stripe's
 * own webhook-verification anchor, even though both are present in the same
 * repo (see detection.test.ts's assertion on this fixture).
 */
export function fixturePaypalUnused(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add unused paypal client alongside an unrelated stripe handler",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/paypal-client.ts": ['import paypalClient from "@paypal/checkout-server-sdk";', "", "export const client = paypalClient;", ""].join(
        "\n"
      ),
      "src/stripe-webhook.ts": stripeNoiseFileContent(),
    },
  });
  return dir;
}

/**
 * The exact same connected PayPal pattern as fixturePaypalDirect's
 * src/webhook.ts, but committed by OTHER — not USER. USER separately commits
 * only an unrelated file. Classifies DIRECT overall, but unattributed and
 * unclaimed for USER — same shape as fixtureOtherAuthor.
 */
export function fixturePaypalOtherAuthor(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add paypal webhook handler",
    authorName: OTHER.name,
    authorEmail: OTHER.email,
    files: {
      "src/webhook.ts": [
        'import paypalClient from "@paypal/checkout-server-sdk";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function handlePaypalWebhook(req, res) {",
        "  const verification = await paypalClient.verifyWebhookSignature({",
        '    transmissionId: req.headers["paypal-transmission-id"],',
        "    webhookEvent: req.body,",
        "  });",
        "  await prisma.payment.upsert({",
        "    where: { id: verification.id },",
        "    create: { id: verification.id },",
        "    update: {},",
        "  });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  commit(dir, {
    message: "add unrelated util",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/util.ts": ["export function noop() {", "  return null;", "}", ""].join("\n"),
    },
  });
  return dir;
}

// -----------------------------------------------------------------------
// Mercado Pago (payments/mercadopago-flow) — the one pattern with an
// optionalAnchorKinds cap on idempotency-guard (see infer.ts's
// STRUCTURAL_PATTERNS entry and its own comment). Needs 5 fixtures, not 4:
// the cap case, the cap-LIFTED case (an upsert makes idempotency-guard
// present again), plus the usual layered/unused/other-author trio.
// -----------------------------------------------------------------------

/**
 * ONE file, USER-committed: `new Preference(client).create(...)` (resolved
 * to Mercado Pago's `creationChainSuffixes` rule) co-located, in the SAME
 * function, with a plain (non-upsert) Prisma `.create(...)` write — no
 * idempotency signal anywhere in the repo (no upsert, no explicit
 * idempotencyKey, no prior DB read in this function). Despite being
 * same-function co-located, infer.ts's optionalAnchorKinds cap means this
 * classifies "inferred", NOT "direct" — see
 * StructuralPattern.optionalAnchorKinds' own comment in infer.ts.
 */
export function fixtureMercadoPagoDirectNoIdempotency(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add mercadopago webhook handler (no idempotency guard anywhere)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/webhook.ts": [
        'import { MercadoPagoConfig, Preference } from "mercadopago";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        'const client = new MercadoPagoConfig({ accessToken: "xxx-EXAMPLE-xxx" });',
        "const prisma = new PrismaClient();",
        "",
        "export async function handleMercadoPagoWebhook(req, res) {",
        "  const preference = new Preference(client);",
        "  const result = await preference.create({ body: { items: req.body.items } });",
        "  await prisma.payment.create({ data: { id: result.id } });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * Same shape as fixtureMercadoPagoDirectNoIdempotency, but the Prisma write
 * is an upsert — idempotent by construction (see anchors.ts's rule 1), which
 * makes idempotency-guard globally present again. Proves the cap LIFTS: this
 * classifies "direct" (same-function), not "inferred".
 */
export function fixtureMercadoPagoDirectWithUpsert(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add mercadopago webhook handler (upsert lifts the idempotency cap)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/webhook.ts": [
        'import { MercadoPagoConfig, Preference } from "mercadopago";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        'const client = new MercadoPagoConfig({ accessToken: "xxx-EXAMPLE-xxx" });',
        "const prisma = new PrismaClient();",
        "",
        "export async function handleMercadoPagoWebhook(req, res) {",
        "  const preference = new Preference(client);",
        "  const result = await preference.create({ body: { items: req.body.items } });",
        "  await prisma.payment.upsert({ where: { id: result.id }, create: { id: result.id }, update: {} });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * THREE files connected only by relative imports: src/handler.ts (creation
 * call) -> src/service.ts -> src/repo.ts (Prisma upsert — both the db-write
 * and idempotency-guard anchor, so the optional-kind cap never engages
 * here). Same 2-hop shape as fixtureLayeredPattern -> INFERRED.
 */
export function fixtureMercadoPagoLayered(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add layered mercadopago webhook handler (handler -> service -> repo)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/handler.ts": [
        'import { MercadoPagoConfig, Preference } from "mercadopago";',
        'import { persistPreference } from "./service.js";',
        "",
        'const client = new MercadoPagoConfig({ accessToken: "xxx-EXAMPLE-xxx" });',
        "",
        "export async function handleMercadoPagoWebhook(req) {",
        "  const preference = new Preference(client);",
        "  const result = await preference.create({ body: { items: req.body.items } });",
        "  await persistPreference(result);",
        "}",
        "",
      ].join("\n"),
      "src/service.ts": [
        'import { upsertPreference } from "./repo.js";',
        "",
        "export async function persistPreference(result) {",
        "  await upsertPreference(result);",
        "}",
        "",
      ].join("\n"),
      "src/repo.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function upsertPreference(result) {",
        "  await prisma.payment.upsert({ where: { id: result.id }, create: { id: result.id }, update: {} });",
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * USER commits a file that ONLY imports "mercadopago" (constructs the
 * config client, never calls `.create(...)` on a Preference/Payment) —
 * alongside an unrelated, fully connected Stripe pattern in the same commit.
 * Same "prove the ownAnchors fix" shape as fixturePaypalUnused.
 */
export function fixtureMercadoPagoUnused(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add unused mercadopago client alongside an unrelated stripe handler",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/mercadopago-client.ts": [
        'import { MercadoPagoConfig } from "mercadopago";',
        "",
        'export const client = new MercadoPagoConfig({ accessToken: "xxx-EXAMPLE-xxx" });',
        "",
      ].join("\n"),
      "src/stripe-webhook.ts": stripeNoiseFileContent(),
    },
  });
  return dir;
}

/**
 * The exact same connected Mercado Pago pattern (upsert variant, so the
 * optional-kind cap doesn't complicate this attribution-only case) as
 * fixtureMercadoPagoDirectWithUpsert's src/webhook.ts, but committed by
 * OTHER — not USER. Classifies DIRECT overall, but unattributed and
 * unclaimed for USER.
 */
export function fixtureMercadoPagoOtherAuthor(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add mercadopago webhook handler",
    authorName: OTHER.name,
    authorEmail: OTHER.email,
    files: {
      "src/webhook.ts": [
        'import { MercadoPagoConfig, Preference } from "mercadopago";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        'const client = new MercadoPagoConfig({ accessToken: "xxx-EXAMPLE-xxx" });',
        "const prisma = new PrismaClient();",
        "",
        "export async function handleMercadoPagoWebhook(req, res) {",
        "  const preference = new Preference(client);",
        "  const result = await preference.create({ body: { items: req.body.items } });",
        "  await prisma.payment.upsert({ where: { id: result.id }, create: { id: result.id }, update: {} });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  commit(dir, {
    message: "add unrelated util",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/util.ts": ["export function noop() {", "  return null;", "}", ""].join("\n"),
    },
  });
  return dir;
}

// -----------------------------------------------------------------------
// Lemon Squeezy (payments/lemonsqueezy-webhook-flow) — fixtureDirect below
// deliberately uses the manual-HMAC shape (createHmac + timingSafeEqual +
// the "x-signature" literal, NO package import at all), per
// WebhookProviderDescriptor.manualHmacLiteral's own comment: it's the
// distinctive rule this provider needs (Lemon Squeezy's SDK has no
// dedicated verify-signature helper). The other 3 fixtures use the plain
// package-import + literal file-level-fallback shape instead, which is
// simpler to compose across multiple files/an "unused" case.
// -----------------------------------------------------------------------

/**
 * ONE file, USER-committed: hand-rolled HMAC verification (createHmac +
 * timingSafeEqual calls, co-located with the "x-signature" literal — no
 * "@lemonsqueezy/lemonsqueezy.js" import anywhere, per the manual-HMAC
 * special case) -> Prisma upsert, all inside one function -> DIRECT
 * (same-function).
 */
export function fixtureLemonSqueezyManualHmacDirect(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add lemon squeezy webhook handler (manual HMAC verification)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/webhook.ts": [
        'import { createHmac, timingSafeEqual } from "node:crypto";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function handleLemonSqueezyWebhook(req, res) {",
        '  const digest = createHmac("sha256", "xxx-EXAMPLE-xxx").update(req.rawBody).digest("hex");',
        '  const signature = req.headers["x-signature"];',
        "  const valid = timingSafeEqual(Buffer.from(digest), Buffer.from(signature));",
        '  if (!valid) return res.status(400).send("invalid signature");',
        "  await prisma.payment.upsert({",
        "    where: { id: req.body.data.id },",
        "    create: { id: req.body.data.id },",
        "    update: {},",
        "  });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * THREE files connected only by relative imports: src/handler.ts (package
 * import + "x-signature" literal — the weaker file-level fallback, not the
 * manual-HMAC rule) -> src/service.ts -> src/repo.ts (Prisma upsert). Same
 * 2-hop shape as fixtureLayeredPattern -> INFERRED.
 */
export function fixtureLemonSqueezyLayered(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add layered lemon squeezy webhook handler (handler -> service -> repo)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/handler.ts": [
        'import { lemonSqueezySetup } from "@lemonsqueezy/lemonsqueezy.js";',
        'import { persistEvent } from "./service.js";',
        "",
        "export async function handleLemonSqueezyWebhook(req) {",
        '  const signature = req.headers["x-signature"];',
        "  await persistEvent(req.body, signature, lemonSqueezySetup);",
        "}",
        "",
      ].join("\n"),
      "src/service.ts": [
        'import { upsertPayment } from "./repo.js";',
        "",
        "export async function persistEvent(event, signature) {",
        "  await upsertPayment(event, signature);",
        "}",
        "",
      ].join("\n"),
      "src/repo.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function upsertPayment(event) {",
        "  await prisma.payment.upsert({ where: { id: event.id }, create: { id: event.id }, update: {} });",
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * USER commits a file that ONLY imports "@lemonsqueezy/lemonsqueezy.js" —
 * no manual-HMAC shape, no signature literal anywhere — alongside an
 * unrelated, fully connected Stripe pattern in the same commit. Same "prove
 * the ownAnchors fix" shape as fixturePaypalUnused.
 */
export function fixtureLemonSqueezyUnused(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add unused lemon squeezy import alongside an unrelated stripe handler",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/lemonsqueezy-client.ts": [
        'import { lemonSqueezySetup } from "@lemonsqueezy/lemonsqueezy.js";',
        "",
        "export const setup = lemonSqueezySetup;",
        "",
      ].join("\n"),
      "src/stripe-webhook.ts": stripeNoiseFileContent(),
    },
  });
  return dir;
}

/**
 * The exact same connected Lemon Squeezy pattern (manual-HMAC variant) as
 * fixtureLemonSqueezyManualHmacDirect's src/webhook.ts, but committed by
 * OTHER — not USER. Classifies DIRECT overall, but unattributed and
 * unclaimed for USER.
 */
export function fixtureLemonSqueezyOtherAuthor(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add lemon squeezy webhook handler (manual HMAC verification)",
    authorName: OTHER.name,
    authorEmail: OTHER.email,
    files: {
      "src/webhook.ts": [
        'import { createHmac, timingSafeEqual } from "node:crypto";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function handleLemonSqueezyWebhook(req, res) {",
        '  const digest = createHmac("sha256", "xxx-EXAMPLE-xxx").update(req.rawBody).digest("hex");',
        '  const signature = req.headers["x-signature"];',
        "  const valid = timingSafeEqual(Buffer.from(digest), Buffer.from(signature));",
        '  if (!valid) return res.status(400).send("invalid signature");',
        "  await prisma.payment.upsert({",
        "    where: { id: req.body.data.id },",
        "    create: { id: req.body.data.id },",
        "    update: {},",
        "  });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  commit(dir, {
    message: "add unrelated util",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/util.ts": ["export function noop() {", "  return null;", "}", ""].join("\n"),
    },
  });
  return dir;
}

// -----------------------------------------------------------------------
// Paddle (payments/paddle-webhook-flow)
// -----------------------------------------------------------------------

/**
 * ONE file, USER-committed: `paddle.webhooks.unmarshal(...)` (root resolved
 * through a same-file `new Paddle(...)` binding, per resolveReceiver's rule
 * 2, to the "@paddle/paddle-node-sdk" import) -> Prisma upsert, all inside
 * one function -> DIRECT (same-function).
 */
export function fixturePaddleDirect(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add paddle webhook handler",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/webhook.ts": [
        'import { Paddle } from "@paddle/paddle-node-sdk";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        'const paddle = new Paddle("xxx-EXAMPLE-xxx");',
        "const prisma = new PrismaClient();",
        "",
        "export async function handlePaddleWebhook(req, res) {",
        '  const event = paddle.webhooks.unmarshal(req.rawBody, "xxx-EXAMPLE-xxx", req.headers["paddle-signature"]);',
        "  await prisma.payment.upsert({",
        "    where: { id: event.data.id },",
        "    create: { id: event.data.id },",
        "    update: {},",
        "  });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * THREE files connected only by relative imports: src/handler.ts (Paddle
 * unmarshal call) -> src/service.ts -> src/repo.ts (Prisma upsert). Same
 * 2-hop shape as fixtureLayeredPattern -> INFERRED.
 */
export function fixturePaddleLayered(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add layered paddle webhook handler (handler -> service -> repo)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/handler.ts": [
        'import { Paddle } from "@paddle/paddle-node-sdk";',
        'import { persistEvent } from "./service.js";',
        "",
        'const paddle = new Paddle("xxx-EXAMPLE-xxx");',
        "",
        "export async function handlePaddleWebhook(req) {",
        '  const event = paddle.webhooks.unmarshal(req.rawBody, "xxx-EXAMPLE-xxx", req.headers["paddle-signature"]);',
        "  await persistEvent(event);",
        "}",
        "",
      ].join("\n"),
      "src/service.ts": [
        'import { upsertPayment } from "./repo.js";',
        "",
        "export async function persistEvent(event) {",
        "  await upsertPayment(event);",
        "}",
        "",
      ].join("\n"),
      "src/repo.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "",
        "const prisma = new PrismaClient();",
        "",
        "export async function upsertPayment(event) {",
        "  await prisma.payment.upsert({ where: { id: event.data.id }, create: { id: event.data.id }, update: {} });",
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * USER commits a file that ONLY constructs a Paddle client (`new
 * Paddle(...)`) — never followed by a `.webhooks.unmarshal(...)` call, the
 * same documented "construction alone produces no hit" gap
 * WebhookProviderDescriptor.creationChainSuffixes' own comment describes for
 * Mercado Pago — alongside an unrelated, fully connected Stripe pattern in
 * the same commit. Same "prove the ownAnchors fix" shape as
 * fixturePaypalUnused.
 */
export function fixturePaddleUnused(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add unused paddle client alongside an unrelated stripe handler",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/paddle-client.ts": [
        'import { Paddle } from "@paddle/paddle-node-sdk";',
        "",
        'export const paddle = new Paddle("xxx-EXAMPLE-xxx");',
        "",
      ].join("\n"),
      "src/stripe-webhook.ts": stripeNoiseFileContent(),
    },
  });
  return dir;
}

/**
 * The exact same connected Paddle pattern as fixturePaddleDirect's
 * src/webhook.ts, but committed by OTHER — not USER. Classifies DIRECT
 * overall, but unattributed and unclaimed for USER.
 */
export function fixturePaddleOtherAuthor(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add paddle webhook handler",
    authorName: OTHER.name,
    authorEmail: OTHER.email,
    files: {
      "src/webhook.ts": [
        'import { Paddle } from "@paddle/paddle-node-sdk";',
        'import { PrismaClient } from "@prisma/client";',
        "",
        'const paddle = new Paddle("xxx-EXAMPLE-xxx");',
        "const prisma = new PrismaClient();",
        "",
        "export async function handlePaddleWebhook(req, res) {",
        '  const event = paddle.webhooks.unmarshal(req.rawBody, "xxx-EXAMPLE-xxx", req.headers["paddle-signature"]);',
        "  await prisma.payment.upsert({",
        "    where: { id: event.data.id },",
        "    create: { id: event.data.id },",
        "    update: {},",
        "  });",
        '  res.status(200).send("ok");',
        "}",
        "",
      ].join("\n"),
    },
  });
  commit(dir, {
    message: "add unrelated util",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/util.ts": ["export function noop() {", "  return null;", "}", ""].join("\n"),
    },
  });
  return dir;
}

// -----------------------------------------------------------------------
// RevenueCat / IAP (payments/iap-subscription-flow) — its own 3-anchor
// shape (configure / purchase / entitlement-gate), no webhook node at all.
// The entitlement-gate check is deliberately CALL-ONLY (see
// iapEntitlementGateHits' own comment in anchors.ts): the real-world
// RevenueCat shape (`customerInfo.entitlements.active['pro']`) is a bare
// property/element access, not a CallExpression, so the fixtures below use
// a made-up CALL-shaped entitlement check instead — the documented,
// accepted gap, not a fixture mistake.
// -----------------------------------------------------------------------

/**
 * ONE file, USER-committed: Purchases.configure(...) -> Purchases
 * .purchasePackage(...) -> a CALL-shaped entitlement gate, all inside one
 * function -> DIRECT (same-function).
 */
export function fixtureIapDirect(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add in-app-purchase subscription flow",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/purchases.ts": [
        'import Purchases from "react-native-purchases";',
        "",
        "export async function setupAndPurchase(offering) {",
        '  Purchases.configure({ apiKey: "xxx-EXAMPLE-xxx" });',
        "  const { customerInfo } = await Purchases.purchasePackage(offering.availablePackages[0]);",
        "  // NOTE: the real-world RevenueCat shape here is a bare property/element",
        "  // access (`customerInfo.entitlements.active['pro']`), which the anchor",
        "  // recognizer can't see (not a CallExpression — see anchors.ts's",
        "  // iapEntitlementGateHits' own documented gap). Using a CALL-shaped",
        "  // entitlement check instead so this fixture actually exercises the rule.",
        '  const isPro = customerInfo.entitlements.get("pro");',
        '  if (!isPro) throw new Error("not entitled");',
        "  return customerInfo;",
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * THREE files connected only by relative imports: src/setup.ts (configure)
 * -> src/purchase.ts (purchasePackage) -> src/gate.ts (the CALL-shaped
 * entitlement gate). Same 2-hop shape as fixtureLayeredPattern -> INFERRED.
 */
export function fixtureIapLayered(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add layered in-app-purchase flow (setup -> purchase -> gate)",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/setup.ts": [
        'import Purchases from "react-native-purchases";',
        'import { doPurchase } from "./purchase.js";',
        "",
        "export async function setupAndBuy(offering) {",
        '  Purchases.configure({ apiKey: "xxx-EXAMPLE-xxx" });',
        "  await doPurchase(offering);",
        "}",
        "",
      ].join("\n"),
      "src/purchase.ts": [
        'import Purchases from "react-native-purchases";',
        'import { checkEntitlement } from "./gate.js";',
        "",
        "export async function doPurchase(offering) {",
        "  const { customerInfo } = await Purchases.purchasePackage(offering.availablePackages[0]);",
        "  await checkEntitlement(customerInfo);",
        "}",
        "",
      ].join("\n"),
      "src/gate.ts": [
        "// See fixtureIapDirect's own comment: a CALL-shaped entitlement check,",
        "// not the real-world bare property/element-access shape (documented gap).",
        "export async function checkEntitlement(customerInfo) {",
        '  const isPro = customerInfo.entitlements.get("pro");',
        '  if (!isPro) throw new Error("not entitled");',
        "  return isPro;",
        "}",
        "",
      ].join("\n"),
    },
  });
  return dir;
}

/**
 * USER commits a file that ONLY imports "react-native-purchases" — no
 * configure/purchase/entitlement call anywhere — alongside an unrelated,
 * fully connected Stripe pattern in the same commit. Same "prove the
 * ownAnchors fix" shape as fixturePaypalUnused (here, none of Stripe's
 * webhook-verification/db-write/idempotency-guard anchors are even part of
 * "iap-flow"'s own anchorKinds at all, so under the pre-fix behavior — which
 * carried the WHOLE cross-pattern anchor pool — every one of them would have
 * leaked into this finding).
 */
export function fixtureIapUnused(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add unused react-native-purchases import alongside an unrelated stripe handler",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/purchases-client.ts": ['import Purchases from "react-native-purchases";', "", "export const purchases = Purchases;", ""].join(
        "\n"
      ),
      "src/stripe-webhook.ts": stripeNoiseFileContent(),
    },
  });
  return dir;
}

/**
 * The exact same connected IAP pattern as fixtureIapDirect's
 * src/purchases.ts, but committed by OTHER — not USER. Classifies DIRECT
 * overall, but unattributed and unclaimed for USER.
 */
export function fixtureIapOtherAuthor(): string {
  const dir = createRepo();
  commit(dir, {
    message: "add in-app-purchase subscription flow",
    authorName: OTHER.name,
    authorEmail: OTHER.email,
    files: {
      "src/purchases.ts": [
        'import Purchases from "react-native-purchases";',
        "",
        "export async function setupAndPurchase(offering) {",
        '  Purchases.configure({ apiKey: "xxx-EXAMPLE-xxx" });',
        "  const { customerInfo } = await Purchases.purchasePackage(offering.availablePackages[0]);",
        '  const isPro = customerInfo.entitlements.get("pro");',
        '  if (!isPro) throw new Error("not entitled");',
        "  return customerInfo;",
        "}",
        "",
      ].join("\n"),
    },
  });
  commit(dir, {
    message: "add unrelated util",
    authorName: USER.name,
    authorEmail: USER.email,
    files: {
      "src/util.ts": ["export function noop() {", "  return null;", "}", ""].join("\n"),
    },
  });
  return dir;
}
