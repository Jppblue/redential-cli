import { afterEach, describe, expect, it } from "vitest";
import { cleanup, commit, createRepo } from "./support/fixtures.js";
import { getCommitAddedLines } from "../src/git.js";
import { extractImportedPackages } from "../src/import-detect.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) cleanup(dirs.pop()!);
});

describe("getCommitAddedLines — CRLF handling", () => {
  it("strips the trailing \\r from a CRLF-authored file's added lines", () => {
    const dir = createRepo();
    dirs.push(dir);
    const sha = commit(dir, {
      message: "x",
      authorName: "You",
      authorEmail: "you@example.com",
      files: { "a.ts": 'import Stripe from "stripe";\r\n\r\nconst s = new Stripe("key");\r\n' },
    });

    const files = getCommitAddedLines(dir, sha);
    expect(files).toHaveLength(1);
    expect(files[0].addedLines).not.toContain("\r");
  });

  it("still detects an import from a CRLF-line-ended diff, end to end", () => {
    const dir = createRepo();
    dirs.push(dir);
    const sha = commit(dir, {
      message: "x",
      authorName: "You",
      authorEmail: "you@example.com",
      files: { "a.ts": 'import Stripe from "stripe";\r\n' },
    });

    const [file] = getCommitAddedLines(dir, sha);
    expect(extractImportedPackages(file.addedLines, file.path)).toEqual(["stripe"]);
  });
});
