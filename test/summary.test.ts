import { describe, expect, it } from "vitest";
import { formatSummary, shouldUsePlainOutput } from "../src/summary.js";
import type { Bundle } from "../src/types.js";

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function baseBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    schema_version: "1.1.0",
    runner: "local",
    tool_version: "0.1.0",
    created_at: "2026-07-09T00:00:00.000Z",
    repo: { host_type: "github", age_days: 900, repo_fingerprint: "deadbeef" },
    identity: { author_identity_hashes: ["abc123"], other_contributors_count: 2 },
    commits: {
      user_total: 1847,
      first_at: "2024-01-01T00:00:00.000Z",
      last_at: "2026-07-01T00:00:00.000Z",
      span_days: 912,
      hour_histogram: [
        1, 0, 0, 0, 0, 2, 5, 10, 20, 30, 25, 15, 10, 8, 6, 4, 3, 2, 1, 1, 0, 0, 0, 0,
      ],
      weekday_histogram: [5, 40, 38, 42, 39, 30, 6],
    },
    signed: { count: 830, ratio: 0.45 },
    languages: [
      { extension: ".ts", share: 0.62 },
      { extension: ".json", share: 0.2 },
      { extension: ".md", share: 0.18 },
    ],
    categories: [
      { name: "backend", commit_count: 120, churn_share: 0.4 },
      { name: "testing", commit_count: 80, churn_share: 0.35 },
      { name: "docs", commit_count: 20, churn_share: 0.25 },
    ],
    detected_skills: [
      { slug: "ai/anthropic-api", commit_count: 14, first_seen: "2024-02-01", last_seen: "2026-06-01" },
      { slug: "auth/clerk", commit_count: 6, first_seen: "2024-03-01", last_seen: "2025-01-01" },
    ],
    ownership: { user_commit_ratio: 0.78 },
    integrity: {
      merkle_root: "0".repeat(64),
      algorithm: "sha256",
      date_forensics: { author_span_days: 900, committer_span_days: 895, mismatch_ratio: 0.05, committer_burst_ratio: 0.03 },
    },
    attestation: { authorized_confirmation: true, confirmed_at: "2026-07-09T00:00:00.000Z" },
    ...overrides,
  };
}

describe("formatSummary", () => {
  it("includes commit count, humanized span, and the closing verification line", () => {
    const text = stripAnsi(formatSummary(baseBundle()));
    expect(text).toContain("2 years, 1,847 commits");
    expect(text).toContain("Nothing left your machine. Verify: github.com/Jppblue/redential-cli");
  });

  it("opens with a divider and ends with the closing verification line when there's no next-step hint to show (session + already submitted identical)", () => {
    const lines = formatSummary(baseBundle(), { hasSession: true, alreadySubmittedIdentical: true }).split("\n");
    expect(stripAnsi(lines[0])).toMatch(/^\s*─+\s*$/);
    const lastLine = stripAnsi(lines[lines.length - 1]);
    expect(lastLine).toContain("Nothing left your machine. Verify: github.com/Jppblue/redential-cli");
  });

  it("shows the signing tip when signed ratio is 0%", () => {
    const text = stripAnsi(formatSummary(baseBundle({ signed: { count: 0, ratio: 0 } })));
    expect(text).toContain(
      "Tip: sign your commits (git config commit.gpgsign true) — signed history is the strongest anchor for your credential."
    );
  });

  it("omits the signing tip when signed ratio is above 0%", () => {
    const text = stripAnsi(formatSummary(baseBundle()));
    expect(text).not.toContain("Tip: sign your commits");
  });

  it("renders a 24-wide hour-of-day sparkline and all 7 weekday labels", () => {
    const text = stripAnsi(formatSummary(baseBundle()));
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(text).toContain(day);
    }
    const hourLine = text
      .split("\n")
      .find((line) => /[·▁▂▃▄▅▆▇█]{24}/.test(line.trim()));
    expect(hourLine).toBeDefined();
  });

  it("renders top languages and categories with percentages", () => {
    const text = stripAnsi(formatSummary(baseBundle()));
    expect(text).toContain(".ts");
    expect(text).toContain("62%");
    expect(text).toContain("backend");
    expect(text).toContain("(120 commits)");
  });

  it("renders detected skills with commit counts", () => {
    const text = stripAnsi(formatSummary(baseBundle()));
    expect(text).toContain("ai/anthropic-api");
    expect(text).toContain("14 commits");
    expect(text).toContain("auth/clerk");
  });

  it("renders ownership and signed-commit ratios", () => {
    const text = stripAnsi(formatSummary(baseBundle()));
    expect(text).toContain("78%");
    expect(text).toContain("45%");
  });

  it("falls back to teaser copy when detected_skills is empty, without throwing", () => {
    const text = stripAnsi(formatSummary(baseBundle({ detected_skills: [] })));
    expect(text).toContain("No skills detected yet");
  });

  it("falls back to teaser copy when languages/categories are empty, without throwing", () => {
    const text = stripAnsi(formatSummary(baseBundle({ languages: [], categories: [] })));
    expect(text).toContain("No language data");
    expect(text).toContain("No category data yet");
  });

  it("does not throw on an all-zero histogram (single commit, no churn)", () => {
    const bundle = baseBundle({
      commits: {
        user_total: 1,
        first_at: "2026-07-09T00:00:00.000Z",
        last_at: "2026-07-09T00:00:00.000Z",
        span_days: 0,
        hour_histogram: new Array(24).fill(0),
        weekday_histogram: [0, 1, 0, 0, 0, 0, 0],
      },
      languages: [],
      categories: [],
      detected_skills: [],
    });
    expect(() => formatSummary(bundle)).not.toThrow();
    const text = stripAnsi(formatSummary(bundle));
    expect(text).toContain("a single day");
  });

  it("never contains raw JSON braces from the bundle itself", () => {
    const text = formatSummary(baseBundle());
    expect(text).not.toContain("{");
    expect(text).not.toContain("}");
  });

  it("plain mode ({ plain: true }) is pure printable ASCII — no ANSI escapes, no Unicode", () => {
    const text = formatSummary(baseBundle(), { plain: true });
    // eslint-disable-next-line no-control-regex
    expect(text).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it("plain mode still renders the same data (commit count, span, ownership)", () => {
    const text = formatSummary(baseBundle(), { plain: true });
    expect(text).toContain("2 years, 1,847 commits");
    expect(text).toContain("78%");
    expect(text).toContain("ai/anthropic-api");
  });

  it("rich mode (default) contains ANSI escapes and Unicode box-drawing", () => {
    const text = formatSummary(baseBundle());
    // eslint-disable-next-line no-control-regex
    expect(text).toMatch(/\x1b\[[0-9;]*m/);
    expect(text).toContain("╔");
  });

  describe("closing next-step hint — three states", () => {
    const CTA_HEADER = "Want this on a public, verifiable profile?";

    it("no session (hasSession omitted/false): shows the login+submit CTA", () => {
      const text = stripAnsi(formatSummary(baseBundle()));
      expect(text).toContain(CTA_HEADER);
      expect(text).toContain("→ redential login && redential submit");
      const lastLine = text.split("\n").filter(Boolean).at(-1);
      expect(lastLine).toContain("redential login && redential submit");
    });

    it("session, not yet submitted (or unknown): shows the submit-only CTA, without a login command", () => {
      const text = stripAnsi(formatSummary(baseBundle(), { hasSession: true }));
      expect(text).toContain(CTA_HEADER);
      expect(text).toContain("→ redential submit");
      expect(text).not.toContain("redential login");
    });

    it("session, not yet submitted, explicit alreadySubmittedIdentical: false: same as above", () => {
      const text = stripAnsi(
        formatSummary(baseBundle(), { hasSession: true, alreadySubmittedIdentical: false })
      );
      expect(text).toContain(CTA_HEADER);
      expect(text).toContain("→ redential submit");
      expect(text).not.toContain("redential login");
    });

    it("session AND already submitted identical: shows no next-step hint at all", () => {
      const text = stripAnsi(
        formatSummary(baseBundle(), { hasSession: true, alreadySubmittedIdentical: true })
      );
      expect(text).not.toContain(CTA_HEADER);
      expect(text).not.toContain("redential submit");
      expect(text).not.toContain("redential login");
    });

    it("alreadySubmittedIdentical alone, without hasSession, is treated as no session (safe default)", () => {
      const text = stripAnsi(formatSummary(baseBundle(), { alreadySubmittedIdentical: true }));
      expect(text).toContain("→ redential login && redential submit");
    });

    it("plain mode renders the CTA with an ASCII arrow (\"->\"), still pure printable ASCII", () => {
      const text = formatSummary(baseBundle(), { plain: true, hasSession: true });
      expect(text).toContain("-> redential submit");
      // eslint-disable-next-line no-control-regex
      expect(text).toMatch(/^[\x20-\x7e\n]*$/);
    });
  });
});

describe("shouldUsePlainOutput", () => {
  it("is always false on non-Windows platforms, regardless of env", () => {
    expect(shouldUsePlainOutput("darwin", {})).toBe(false);
    expect(shouldUsePlainOutput("linux", {})).toBe(false);
  });

  it("is true on win32 with no known ANSI/UTF-8-capable wrapper in env", () => {
    expect(shouldUsePlainOutput("win32", {})).toBe(true);
  });

  it("is false on win32 inside Windows Terminal (WT_SESSION set)", () => {
    expect(shouldUsePlainOutput("win32", { WT_SESSION: "abc" })).toBe(false);
  });

  it("is false on win32 inside a TERM_PROGRAM-reporting terminal (e.g. VS Code)", () => {
    expect(shouldUsePlainOutput("win32", { TERM_PROGRAM: "vscode" })).toBe(false);
  });

  it("is false on win32 under ConEmu (ConEmuANSI=ON)", () => {
    expect(shouldUsePlainOutput("win32", { ConEmuANSI: "ON" })).toBe(false);
  });

  it("is true on win32 when ConEmuANSI is present but not \"ON\"", () => {
    expect(shouldUsePlainOutput("win32", { ConEmuANSI: "OFF" })).toBe(true);
  });
});
