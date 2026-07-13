// H4 of the proof-graph spike (see docs/proof-graph-spike.md): drives
// executeExplainCommand directly over the H3 fixtures (test/proof-graph/
// fixtures.js) — same harness approach as test/scan-command.test.ts (call
// the command function directly with an injected `log` collector, never
// spawn the built CLI). USER is always passed explicitly via `author`
// (rather than relying on the default `git config user.email` fallback) so
// these tests don't depend on whatever global git config the machine
// running them happens to have — see test/author-preselection.test.ts for
// the same rationale applied to that command's own default-selection tests.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { executeExplainCommand } from "../src/explain-command.js";
import { ScanError } from "../src/errors.js";
import { cleanup } from "./support/fixtures.js";
import {
  USER,
  fixtureCommentsOnly,
  fixtureDirectPattern,
  fixtureLayeredPattern,
  fixtureStripeUnused,
} from "./proof-graph/fixtures.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
});

function collectLog(): { log: (m: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
}

describe("executeExplainCommand", () => {
  it("direct fixture: DIRECT classification, the three anchor kinds, the file path, and claimed yes", async () => {
    const dir = fixtureDirectPattern();
    dirs.push(dir);
    const { log, lines } = collectLog();

    await executeExplainCommand({
      repoPath: dir,
      skill: "payments/payment-webhook-flow",
      author: [USER.email],
      log,
    });

    const output = lines.join("\n");
    expect(output).toContain("DIRECT");
    expect(output).toContain("webhook-verification:");
    expect(output).toContain("db-write:");
    expect(output).toContain("idempotency-guard:");
    expect(output).toContain("src/webhook.ts");
    expect(output).toContain("Claimed: yes");
  });

  it("layered fixture: INFERRED classification and the handler -> service -> repo connection chain", async () => {
    const dir = fixtureLayeredPattern();
    dirs.push(dir);
    const { log, lines } = collectLog();

    await executeExplainCommand({
      repoPath: dir,
      skill: "payments/payment-webhook-flow",
      author: [USER.email],
      log,
    });

    const output = lines.join("\n");
    expect(output).toContain("INFERRED");
    const connectionLine = lines.find((l) => l.startsWith("Connection:"))!;
    expect(connectionLine).toContain("src/handler.ts -> src/service.ts -> src/repo.ts");
    expect(output).toContain("Claimed: yes");
  });

  it("stripe-unused fixture: AMBIGUOUS, explicit not-claimed wording, and a why", async () => {
    const dir = fixtureStripeUnused();
    dirs.push(dir);
    const { log, lines } = collectLog();

    await executeExplainCommand({
      repoPath: dir,
      skill: "payments/payment-webhook-flow",
      author: [USER.email],
      log,
    });

    const output = lines.join("\n");
    expect(output).toContain("AMBIGUOUS");
    expect(output).toContain("Claimed: no");
    expect(output).toContain("NOT CLAIMED:");
    expect(output).toContain("never claimed");
    expect(output).toContain("never enter a scan/submit bundle");
    expect(output).toContain("Why:");
  });

  it("unknown slug: a taxonomy.json-citing error, never a stack trace", async () => {
    const dir = fixtureDirectPattern();
    dirs.push(dir);

    await expect(
      executeExplainCommand({
        repoPath: dir,
        skill: "not/a-real-slug",
        author: [USER.email],
      })
    ).rejects.toThrow(ScanError);

    try {
      await executeExplainCommand({ repoPath: dir, skill: "not/a-real-slug", author: [USER.email] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ScanError);
      expect((err as Error).message).toContain("taxonomy.json");
      expect((err as Error).message).toContain("not/a-real-slug");
    }
  });

  it("a valid but non-structural taxonomy slug: the known-limit message, not a detection attempt", async () => {
    const dir = fixtureDirectPattern();
    dirs.push(dir);

    try {
      await executeExplainCommand({ repoPath: dir, skill: "payments/stripe", author: [USER.email] });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ScanError);
      expect((err as Error).message).toContain("payment-webhook-flow");
      expect((err as Error).message).toContain("spike");
    }
  });

  it("a repo with no structural finding at all: a friendly 'not detected' message", async () => {
    const dir = fixtureCommentsOnly();
    dirs.push(dir);

    try {
      await executeExplainCommand({
        repoPath: dir,
        skill: "payments/payment-webhook-flow",
        author: [USER.email],
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ScanError);
      expect((err as Error).message).toContain("not detected");
    }
  });

  // Boundary pin: `explain` is a read-only diagnostic — it must never write
  // anything anywhere. Two independent checks, per CLAUDE.md's guidance to
  // pick the stronger technique and document it: a static source scan is the
  // STRONGER check (it's exhaustive over every fs-write API the file could
  // call, regardless of which directory a bug might target), so it's the
  // primary assertion; the fixture-directory-listing snapshot is a weaker,
  // secondary integration check (it would only catch a write landing inside
  // this specific repo directory) kept alongside it for defense in depth.
  it("never writes a file: no fs-write API is referenced in explain-command.ts, and a real run doesn't touch the fixture repo's directory listing", async () => {
    const srcUrl = new URL("../src/explain-command.ts", import.meta.url);
    const source = readFileSync(srcUrl, "utf8");
    expect(source).not.toMatch(/writeFileSync|appendFileSync|mkdirSync|createWriteStream|rmSync|writeFile\(/);

    const dir = fixtureDirectPattern();
    dirs.push(dir);
    const before = readdirSync(dir, { recursive: true } as { recursive: true }).sort();

    await executeExplainCommand({
      repoPath: dir,
      skill: "payments/payment-webhook-flow",
      author: [USER.email],
      log: () => {},
    });

    const after = readdirSync(dir, { recursive: true } as { recursive: true }).sort();
    expect(after).toEqual(before);
  });

  it("no --author given: falls back to `git config user.email` (non-interactive), and honestly reports no-commits-found for an identity that matched none", async () => {
    const dir = fixtureDirectPattern();
    dirs.push(dir);
    // Explicit repo-local user.email so this test's outcome doesn't depend
    // on whatever the host machine's own git identity happens to be — an
    // email guaranteed to have zero commits in this fixture (only
    // USER/OTHER ever commit to it).
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["config", "user.email", "not-a-committer@example.com"], { cwd: dir });
    const { log, lines } = collectLog();

    await executeExplainCommand({
      repoPath: dir,
      skill: "payments/payment-webhook-flow",
      author: [],
      log,
    });

    const output = lines.join("\n");
    // The pattern is still DIRECT (detection is independent of attribution),
    // but nothing is claimed for an author identity that matched no commits.
    expect(output).toContain("DIRECT");
    expect(output).toContain("no commits found for not-a-committer@example.com");
    expect(output).toContain("Claimed: no");
  });
});
