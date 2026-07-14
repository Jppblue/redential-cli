import { describe, expect, it } from "vitest";
import { PRIVATE_LABEL_MAX_LENGTH, validatePrivateLabel } from "../src/private-label.js";
import { ScanError } from "../src/errors.js";

// AWS's own canonical example key, used throughout their public docs —
// obviously fake, but structurally shaped like a real one (same fixture
// test/privacy/secret-scan.test.ts uses).
const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

describe("validatePrivateLabel", () => {
  it("trims surrounding whitespace and returns the trimmed value", () => {
    expect(validatePrivateLabel("  Acme Corp  ")).toBe("Acme Corp");
  });

  it("rejects an empty string", () => {
    expect(() => validatePrivateLabel("")).toThrow(ScanError);
    expect(() => validatePrivateLabel("")).toThrow(/cannot be empty/);
  });

  it("rejects an all-whitespace string (empty after trim)", () => {
    expect(() => validatePrivateLabel("   ")).toThrow(/cannot be empty/);
  });

  it(`accepts exactly ${PRIVATE_LABEL_MAX_LENGTH} characters`, () => {
    const label = "a".repeat(PRIVATE_LABEL_MAX_LENGTH);
    expect(validatePrivateLabel(label)).toBe(label);
  });

  it(`rejects ${PRIVATE_LABEL_MAX_LENGTH + 1} characters`, () => {
    const label = "a".repeat(PRIVATE_LABEL_MAX_LENGTH + 1);
    expect(() => validatePrivateLabel(label)).toThrow(/64 characters or fewer/);
  });

  it("rejects a control character (e.g. a raw newline)", () => {
    expect(() => validatePrivateLabel("Acme\x00Corp")).toThrow(/control characters/);
  });

  it("rejects a tab character", () => {
    expect(() => validatePrivateLabel("Acme\tCorp")).toThrow(/control characters/);
  });

  it("blocks a label that itself looks like a secret (same bar as the bundle payload)", () => {
    expect(() => validatePrivateLabel(`leaked key: ${FAKE_AWS_KEY}`)).toThrow(ScanError);
    let caught: unknown;
    try {
      validatePrivateLabel(`leaked key: ${FAKE_AWS_KEY}`);
    } catch (err) {
      caught = err;
    }
    // Never leaks the matched value into the error message itself — same
    // discipline as assertNoSecrets' own contract.
    expect((caught as Error).message).not.toContain(FAKE_AWS_KEY);
  });

  it("accepts an ordinary human nickname", () => {
    expect(validatePrivateLabel("Acme Corp — backend team")).toBe("Acme Corp — backend team");
  });
});
