import { afterEach, describe, expect, it, vi } from "vitest";
import { debugLog, isDebugEnabled, setDebugEnabled } from "../src/debug.js";

afterEach(() => {
  // Module-level state — MUST reset, or this leaks into every other test
  // file sharing the same vitest worker process.
  setDebugEnabled(false);
});

describe("debug.ts", () => {
  it("defaults to disabled", () => {
    expect(isDebugEnabled()).toBe(false);
  });

  it("debugLog is a no-op (writes nothing to stderr) when disabled", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    debugLog("should not appear");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("debugLog writes to stderr, prefixed, when enabled", () => {
    setDebugEnabled(true);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    debugLog("hello");
    expect(spy).toHaveBeenCalledWith("[debug] hello\n");
    spy.mockRestore();
  });

  it("setDebugEnabled(false) turns it back off", () => {
    setDebugEnabled(true);
    setDebugEnabled(false);
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    debugLog("should not appear either");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
