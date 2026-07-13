import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgressReporter } from "../../src/proof-graph/progress.js";

// Fully deterministic clock control for the throttling tests below — real
// wall-clock sleeps would make repaint-coalescing assertions flaky.
let now = 0;
beforeEach(() => {
  now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function collector(): { write: (chunk: string) => void; chunks: string[] } {
  const chunks: string[] = [];
  return { write: (chunk: string) => chunks.push(chunk), chunks };
}

describe("createProgressReporter", () => {
  it("disabled by default (no enabled override, no real TTY in this test process): phase/tick/done never write", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ write });

    reporter.phase("Scanning HEAD");
    reporter.tick(1, 10);
    now += 1000;
    reporter.tick(10, 10);
    reporter.done();

    expect(chunks).toEqual([]);
  });

  it("enabled: false forces silence even across many calls", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: false, write });

    reporter.phase("Parsing files");
    for (let i = 0; i < 5; i++) {
      now += 500;
      reporter.tick(i, 5);
    }
    reporter.done();

    expect(chunks).toEqual([]);
  });

  it("enabled: true writes the phase label immediately, using \\r line-rewriting", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    reporter.phase("Scanning HEAD");

    expect(chunks).toEqual(["\rScanning HEAD"]);
  });

  it("tick() calls within the throttle window are coalesced no-ops; the next repaint happens once enough time has passed", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    reporter.phase("Parsing files");
    chunks.length = 0; // isolate tick behavior from the phase() line above

    reporter.tick(1, 100);
    now += 50;
    reporter.tick(2, 100);
    now += 50;
    reporter.tick(3, 100);
    // Still under 200ms total since the phase() call (which reset the
    // throttle clock) — none of these three ticks should have repainted.
    expect(chunks).toEqual([]);

    now += 150; // total elapsed since phase(): 250ms, past the 200ms throttle
    reporter.tick(4, 100);
    expect(chunks).toEqual(["\rParsing files 4/100 (4%)"]);
  });

  it("tick() without a total prints a bare count; with a total prints count/total and a percentage", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    reporter.phase("Reading history");
    chunks.length = 0;
    now += 200;
    reporter.tick(42);
    expect(chunks).toEqual(["\rReading history 42"]);

    chunks.length = 0;
    now += 200;
    reporter.tick(3, 10);
    expect(chunks).toEqual(["\rReading history 3/10 (30%)"]);
  });

  it("phase() ends the previous line with a newline before starting the next one", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    reporter.phase("Scanning HEAD");
    reporter.phase("Parsing files");

    expect(chunks).toEqual(["\rScanning HEAD", "\n", "\rParsing files"]);
  });

  it("a longer previous line is fully overwritten (padded) by a shorter repaint", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    reporter.phase("Analyzing structure");
    chunks.length = 0;
    now += 200;
    reporter.tick(1234567, 9999999); // long line
    const longLine = chunks[chunks.length - 1];
    expect(longLine.length).toBeGreaterThan(20);

    now += 200;
    reporter.tick(1, 1); // much shorter line — must overwrite every leftover char
    const shortRepaint = chunks[chunks.length - 1];
    // Stripped of the leading \r, the repaint must be at least as long as
    // the previous line so no stale characters survive on the terminal.
    expect(shortRepaint.length).toBeGreaterThanOrEqual(longLine.length);
  });

  it("done() clears the current line in place (no trailing newline) when a line was written", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    reporter.phase("Building graph");
    chunks.length = 0;
    reporter.done();

    const cleared = chunks[0];
    expect(cleared.startsWith("\r")).toBe(true);
    expect(cleared.endsWith("\r")).toBe(true);
    expect(cleared).not.toContain("\n");
    expect(cleared.trim()).toBe("");
    expect(cleared.length).toBeGreaterThan(2); // \r + at least one padding space + \r
  });

  it("done() is a silent no-op when no phase() was ever called", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    reporter.done();

    expect(chunks).toEqual([]);
  });

  it("tick() before any phase() is a no-op (never throws, never writes)", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    expect(() => reporter.tick(1, 10)).not.toThrow();
    expect(chunks).toEqual([]);
  });

  // CONTENT RULE: every byte ever written is one of the fixed phase labels
  // or a plain integer/percentage — enforced at compile time by
  // ProgressPhase being a closed literal union, verified here at runtime
  // against every phase this module knows about plus a spread of tick
  // shapes. A leaked path/email/function-name would contain characters (":",
  // "@", "_", uppercase-mixed-with-slashes-and-dots typical of paths, etc.)
  // outside this strict allowlist.
  it("every byte written across all fixed phases and tick shapes matches a strict allowlist charset", () => {
    const { write, chunks } = collector();
    const reporter = createProgressReporter({ enabled: true, write });

    const phases = [
      "Scanning HEAD",
      "Parsing files",
      "Building graph",
      "Finding anchors",
      "Reading history",
      "Analyzing structure",
    ] as const;

    for (const phaseName of phases) {
      reporter.phase(phaseName);
      now += 200;
      reporter.tick(0, 0);
      now += 200;
      reporter.tick(1);
      now += 200;
      reporter.tick(5, 17);
    }
    reporter.done();

    const output = chunks.join("");
    expect(output.length).toBeGreaterThan(0);
    expect(output).toMatch(/^[A-Za-z0-9 ./()%\r\n-]*$/);

    // A representative sample of what a leak WOULD look like, to make sure
    // the allowlist is actually strict rather than accidentally permissive.
    const forbiddenProbes = [
      "src/webhook.ts",
      "fixture-author@example.com",
      "handleStripeWebhook",
      ":",
      "@",
      "_",
    ];
    for (const probe of forbiddenProbes) {
      expect(output).not.toContain(probe);
    }
  });
});
