import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanup,
  commit,
  createRepo,
  setupSshSigning,
  setupSshSigningWithMismatchedTrust,
} from "./support/fixtures.js";
import { validateAgainstSchema } from "./support/schema-validate.js";
import { runScan, ScanError, listAuthors } from "../src/scan.js";

const schema = JSON.parse(
  readFileSync(new URL("../schema/bundle.v1.json", import.meta.url), "utf8")
);

const dirs: string[] = [];
function repo(): string {
  const dir = createRepo();
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
});

// Isolate the device salt from the developer's real ~/.config/redential.
function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "redential-config-"));
  dirs.push(dir);
  return dir;
}

describe("runScan", () => {
  it("computes ownership and identity across multiple author identities", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    commit(dir, {
      message: "a1",
      authorName: "Alice",
      authorEmail: "alice@example.com",
      files: { "src/index.ts": "console.log(1)\n" },
    });
    commit(dir, {
      message: "a2",
      authorName: "Alice",
      authorEmail: "alice@example.com",
      files: { "src/index.ts": "console.log(1)\nconsole.log(2)\n" },
    });
    commit(dir, {
      message: "b1",
      authorName: "Bob",
      authorEmail: "bob@example.com",
      files: { "src/other.ts": "console.log(3)\n" },
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["alice@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(bundle.commits.user_total).toBe(2);
    expect(bundle.identity.other_contributors_count).toBe(1);
    expect(bundle.ownership.user_commit_ratio).toBeCloseTo(2 / 3);
    expect(bundle.identity.author_identity_hashes).toHaveLength(1);
    expect(bundle.identity.author_identity_hashes[0]).toMatch(/^[0-9a-f]{64}$/);

    const json = JSON.stringify(bundle);
    expect(json).not.toContain("alice@example.com");
    expect(json).not.toContain("bob@example.com");

    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("counts signed vs unsigned commits", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    setupSshSigning(dir, "carol@example.com");
    commit(dir, {
      message: "signed",
      authorName: "Carol",
      authorEmail: "carol@example.com",
      files: { "a.ts": "1\n" },
      sign: true,
    });
    commit(dir, {
      message: "unsigned",
      authorName: "Carol",
      authorEmail: "carol@example.com",
      files: { "a.ts": "1\n2\n" },
      sign: false,
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["carol@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(bundle.signed.count).toBe(1);
    expect(bundle.signed.ratio).toBeCloseTo(0.5);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("does not count a signature that can't be verified (mismatched key) as signed", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    setupSshSigningWithMismatchedTrust(dir, "dana@example.com");
    commit(dir, {
      message: "signed but unverifiable",
      authorName: "Dana",
      authorEmail: "dana@example.com",
      files: { "a.ts": "1\n" },
      sign: true,
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["dana@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(bundle.signed.count).toBe(0);
    expect(bundle.signed.ratio).toBe(0);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("rejects an empty repository", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    expect(() =>
      runScan({
        repoPath: dir,
        authors: ["nobody@example.com"],
        confirmed: true,
        toolVersion: "0.1.0",
        configDir,
      })
    ).toThrow(ScanError);
    expect(listAuthors(dir)).toEqual([]);
  });

  it("handles a repo with a single commit", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    commit(dir, {
      message: "only",
      authorName: "Dana",
      authorEmail: "dana@example.com",
      files: { "README.md": "hello\n" },
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["dana@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(bundle.commits.user_total).toBe(1);
    expect(bundle.commits.span_days).toBe(0);
    expect(bundle.commits.first_at).toBe(bundle.commits.last_at);
    expect(bundle.ownership.user_commit_ratio).toBe(1);
    expect(bundle.identity.other_contributors_count).toBe(0);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("requires explicit confirmation before producing a bundle", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    commit(dir, {
      message: "x",
      authorName: "Eve",
      authorEmail: "eve@example.com",
      files: { "a.ts": "1\n" },
    });
    expect(() =>
      runScan({
        repoPath: dir,
        authors: ["eve@example.com"],
        confirmed: false,
        toolVersion: "0.1.0",
        configDir,
      })
    ).toThrow(ScanError);
  });

  it("excludes lockfiles, minified bundles, build dirs, and single-commit dumps from languages/categories", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    // A big lockfile (would fall into "other"), a vendored minified bundle
    // under public/ (would fall into "frontend"), and a dist/ build output
    // (would fall into "other") — alongside one real line of backend code.
    // Without the exclusion, the checked-in artifacts' churn would dwarf
    // the one real line and dominate languages/categories.
    commit(dir, {
      message: "add deps + real code",
      authorName: "Grace",
      authorEmail: "grace@example.com",
      files: {
        "package-lock.json": Array.from({ length: 2000 }, (_, i) => `"dep${i}": "1.0.0"`).join("\n"),
        "public/vendor.min.js": Array.from({ length: 1500 }, () => "x").join(""),
        "dist/bundle.js": Array.from({ length: 1200 }, () => "y").join("\n"),
        "server/index.ts": "console.log(1)\n",
      },
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["grace@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    // Only the real source file's churn should count.
    expect(bundle.languages).toEqual([{ extension: ".ts", share: 1 }]);
    expect(bundle.categories).toEqual([{ name: "backend", commit_count: 1, churn_share: 1 }]);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("excludes a single-commit large add with no later history, even outside a recognized dir/name", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    // Deliberately a DIFFERENT extension and category from the real file
    // below: if the heuristic exclusion were ever removed, this dump would
    // show up as its own .graphql language entry and its own "other"
    // category commit — either assertion below would then fail. Sharing an
    // extension/category with the real file would let this test pass even
    // with the exclusion silently deleted (caught in review).
    commit(dir, {
      message: "dump generated client",
      authorName: "Heidi",
      authorEmail: "heidi@example.com",
      files: {
        "src/generated-client.graphql": Array.from({ length: 1500 }, (_, i) => `# field${i}`).join("\n"),
      },
    });
    commit(dir, {
      message: "real work",
      authorName: "Heidi",
      authorEmail: "heidi@example.com",
      files: { "server/index.ts": "console.log(1)\n" },
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["heidi@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(bundle.languages).toEqual([{ extension: ".ts", share: 1 }]);
    expect(bundle.categories).toEqual([{ name: "backend", commit_count: 1, churn_share: 1 }]);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("populates detected_skills from a real signature match (Stripe import + API call)", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    commit(dir, {
      message: "add stripe checkout",
      authorName: "Ivy",
      authorEmail: "ivy@example.com",
      files: {
        "src/lib/stripe.ts":
          'import Stripe from "stripe";\n' +
          "const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\n" +
          'const session = await stripe.checkout.sessions.create({ mode: "payment" });\n',
      },
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["ivy@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(bundle.detected_skills).toEqual([
      {
        slug: "payments/stripe",
        commit_count: 1,
        first_seen: bundle.commits.first_at,
        last_seen: bundle.commits.first_at,
      },
    ]);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("does not detect a skill from a merge commit or from prose merely mentioning a library", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    commit(dir, {
      message: "notes",
      authorName: "Jack",
      authorEmail: "jack@example.com",
      files: { "README.md": "We considered using stripe for payments but chose mercadopago instead for LatAm support.\n" },
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["jack@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(bundle.detected_skills).toEqual([]);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("detected_skills is deterministic and sorted by slug across repeated runs", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    commit(dir, {
      message: "add stripe and sentry",
      authorName: "Kim",
      authorEmail: "kim@example.com",
      files: {
        "src/lib/stripe.ts":
          'import Stripe from "stripe";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\nawait stripe.checkout.sessions.create({});\n',
        "src/lib/sentry.ts": 'import * as Sentry from "@sentry/node";\nSentry.init({ dsn: "x" });\n',
      },
    });

    const now = new Date("2026-01-01T00:00:00Z");
    const run = () =>
      runScan({ repoPath: dir, authors: ["kim@example.com"], confirmed: true, toolVersion: "0.1.0", configDir, now });

    const a = run();
    const b = run();
    expect(JSON.stringify(a.detected_skills)).toBe(JSON.stringify(b.detected_skills));
    const slugs = a.detected_skills.map((s) => s.slug);
    expect(slugs).toEqual([...slugs].sort());
  });

  it("requires at least one selected author", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    commit(dir, {
      message: "x",
      authorName: "Frank",
      authorEmail: "frank@example.com",
      files: { "a.ts": "1\n" },
    });
    expect(() =>
      runScan({ repoPath: dir, authors: [], confirmed: true, toolVersion: "0.1.0", configDir })
    ).toThrow(ScanError);
  });

  it("aggregates detected_skills across multiple non-consecutive commits", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    // Each "stripe" commit must ADD a fresh import line of its own — git
    // diffs only show what changed, so re-touching the same already-stripe
    // file without re-adding the import line would NOT re-trigger
    // detection (verified: an earlier draft of this fixture reused one
    // file across commits and only counted 1, not 3, for exactly this
    // reason). Three distinct files, each introducing its own import.
    commit(dir, {
      message: "1: add stripe",
      authorName: "Liam",
      authorEmail: "liam@example.com",
      files: { "src/pay.ts": 'import Stripe from "stripe";\n' },
      authorDate: "2026-01-01T10:00:00Z",
    });
    commit(dir, {
      message: "2: unrelated",
      authorName: "Liam",
      authorEmail: "liam@example.com",
      files: { "src/misc.ts": "export const x = 1;\n" },
      authorDate: "2026-01-02T10:00:00Z",
    });
    commit(dir, {
      message: "3: use stripe again, in a new file",
      authorName: "Liam",
      authorEmail: "liam@example.com",
      files: { "src/pay2.ts": 'import Stripe from "stripe";\nconst s = new Stripe("x");\n' },
      authorDate: "2026-01-03T10:00:00Z",
    });
    commit(dir, {
      message: "4: unrelated again",
      authorName: "Liam",
      authorEmail: "liam@example.com",
      files: { "src/misc.ts": "export const x = 2;\n" },
      authorDate: "2026-01-04T10:00:00Z",
    });
    commit(dir, {
      message: "5: use stripe a third time, in another new file",
      authorName: "Liam",
      authorEmail: "liam@example.com",
      files: { "src/pay3.ts": 'import Stripe from "stripe";\nconst s2 = new Stripe("y");\n' },
      authorDate: "2026-01-05T10:00:00Z",
    });

    const bundle = runScan({
      repoPath: dir,
      authors: ["liam@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });

    expect(bundle.detected_skills).toEqual([
      {
        slug: "payments/stripe",
        commit_count: 3,
        first_seen: "2026-01-01T10:00:00.000Z",
        last_seen: "2026-01-05T10:00:00.000Z",
      },
    ]);
    expect(validateAgainstSchema(schema, bundle)).toEqual([]);
  });

  it("scans a 300-commit repo in under 30 seconds", () => {
    const dir = repo();
    const configDir = tempConfigDir();
    for (let i = 0; i < 300; i++) {
      const day = String((i % 27) + 1).padStart(2, "0");
      commit(dir, {
        message: `commit ${i}`,
        authorName: "Nora",
        authorEmail: "nora@example.com",
        files: {
          [`src/file${i % 20}.ts`]: `export const value${i} = ${i};\nimport Stripe from "stripe";\n`,
        },
        authorDate: `2026-01-${day}T${String(i % 24).padStart(2, "0")}:00:00Z`,
      });
    }

    const start = Date.now();
    const bundle = runScan({
      repoPath: dir,
      authors: ["nora@example.com"],
      confirmed: true,
      toolVersion: "0.1.0",
      configDir,
    });
    const elapsedMs = Date.now() - start;

    expect(bundle.commits.user_total).toBe(300);
    expect(elapsedMs).toBeLessThan(30_000);
  }, 90_000);
});
