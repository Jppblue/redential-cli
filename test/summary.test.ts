import { describe, expect, it } from "vitest";
import { formatSummary } from "../src/summary.js";
import type { Bundle } from "../src/types.js";

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function baseBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    schema_version: "1.0.0",
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
    integrity: { merkle_root: "0".repeat(64), algorithm: "sha256" },
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

  it("opens with a divider and ends with the closing verification line — it's meant to be printed after the JSON, as the last thing left on screen", () => {
    const lines = formatSummary(baseBundle()).split("\n");
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
});
