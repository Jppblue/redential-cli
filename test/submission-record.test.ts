import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleContentHash, readLastSubmission, saveLastSubmission } from "../src/submission-record.js";
import type { Bundle } from "../src/types.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) dirs.pop();
});

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "redential-config-"));
  dirs.push(dir);
  return dir;
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
      user_total: 10,
      first_at: "2024-01-01T00:00:00.000Z",
      last_at: "2026-07-01T00:00:00.000Z",
      span_days: 912,
      hour_histogram: new Array(24).fill(0),
      weekday_histogram: new Array(7).fill(0),
    },
    signed: { count: 5, ratio: 0.5 },
    languages: [{ extension: ".ts", share: 1 }],
    categories: [{ name: "backend", commit_count: 10, churn_share: 1 }],
    detected_skills: [],
    ownership: { user_commit_ratio: 1 },
    integrity: {
      merkle_root: "0".repeat(64),
      algorithm: "sha256",
      date_forensics: { author_span_days: 900, committer_span_days: 895, mismatch_ratio: 0.05, committer_burst_ratio: 0.03 },
    },
    attestation: { authorized_confirmation: true, confirmed_at: "2026-07-09T00:00:00.000Z" },
    ...overrides,
  };
}

describe("bundleContentHash", () => {
  it("is stable for the exact same bundle", () => {
    const bundle = baseBundle();
    expect(bundleContentHash(bundle)).toBe(bundleContentHash(baseBundle()));
  });

  it("ignores created_at — a re-scan a second later hashes the same", () => {
    const a = bundleContentHash(baseBundle({ created_at: "2026-07-09T00:00:00.000Z" }));
    const b = bundleContentHash(baseBundle({ created_at: "2026-07-09T00:00:01.000Z" }));
    expect(a).toBe(b);
  });

  it("ignores attestation.confirmed_at", () => {
    const a = bundleContentHash(
      baseBundle({ attestation: { authorized_confirmation: true, confirmed_at: "2026-07-09T00:00:00.000Z" } })
    );
    const b = bundleContentHash(
      baseBundle({ attestation: { authorized_confirmation: true, confirmed_at: "2026-07-10T00:00:00.000Z" } })
    );
    expect(a).toBe(b);
  });

  it("ignores repo.age_days — the same repo a day later still hashes the same", () => {
    const a = bundleContentHash(
      baseBundle({ repo: { host_type: "github", age_days: 900, repo_fingerprint: "deadbeef" } })
    );
    const b = bundleContentHash(
      baseBundle({ repo: { host_type: "github", age_days: 901, repo_fingerprint: "deadbeef" } })
    );
    expect(a).toBe(b);
  });

  it("changes when the actual commit count changes", () => {
    const a = bundleContentHash(baseBundle({ commits: { ...baseBundle().commits, user_total: 10 } }));
    const b = bundleContentHash(baseBundle({ commits: { ...baseBundle().commits, user_total: 11 } }));
    expect(a).not.toBe(b);
  });

  it("changes when tool_version changes — a CLI upgrade can genuinely change what would be uploaded", () => {
    const a = bundleContentHash(baseBundle({ tool_version: "0.1.0" }));
    const b = bundleContentHash(baseBundle({ tool_version: "0.2.0" }));
    expect(a).not.toBe(b);
  });

  it("changes when detected_skills changes", () => {
    const a = bundleContentHash(baseBundle({ detected_skills: [] }));
    const b = bundleContentHash(
      baseBundle({
        detected_skills: [{ slug: "payments/stripe", commit_count: 1, first_seen: "2024-01-01", last_seen: "2024-01-01" }],
      })
    );
    expect(a).not.toBe(b);
  });
});

describe("readLastSubmission / saveLastSubmission", () => {
  it("returns null when nothing has been saved yet", () => {
    expect(readLastSubmission(tempConfigDir())).toBeNull();
  });

  it("round-trips a saved record", () => {
    const configDir = tempConfigDir();
    const record = { site_url: "https://example.com", bundle_hash: "abc123", submitted_at: "2026-07-09T00:00:00.000Z" };
    saveLastSubmission(record, configDir);
    expect(readLastSubmission(configDir)).toEqual(record);
  });

  it("overwrites the previous record on a second save", () => {
    const configDir = tempConfigDir();
    saveLastSubmission({ site_url: "https://example.com", bundle_hash: "first", submitted_at: "t1" }, configDir);
    saveLastSubmission({ site_url: "https://example.com", bundle_hash: "second", submitted_at: "t2" }, configDir);
    expect(readLastSubmission(configDir)?.bundle_hash).toBe("second");
  });
});
