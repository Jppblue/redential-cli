// Tier 1 of skill detection (see docs/signatures.md): generic import
// parsing, language-by-language, over a commit's ADDED diff lines only.
// Returns normalized package names for src/skill-detect.ts to look up in
// signatures/package-map.json. Never sends anything anywhere — pure string
// parsing, no I/O.
//
// Deliberately regex-based, not a real parser per language (that would mean
// 5 new dependencies — CLAUDE.md's dependency policy forbids that without
// written justification). The tradeoff: perfect syntactic correctness isn't
// the goal, bounded false positives are (principle 3) — every extractor is
// anchored to reject the three near-miss classes that matter in practice:
// comments, package names embedded in string literals, and doc files.

export type ImportLanguage = "js" | "python" | "go" | "ruby" | "php";

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".markdown"]);

function languageForPath(filePath: string): ImportLanguage | null {
  const lower = filePath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  if (DOC_EXTENSIONS.has(ext)) return null; // never scan docs for imports
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"].includes(ext)) return "js";
  if (ext === ".py") return "python";
  if (ext === ".go") return "go";
  if (ext === ".rb" || lower.endsWith("/gemfile") || lower === "gemfile") return "ruby";
  if (ext === ".php" || lower.endsWith("/composer.json") || lower === "composer.json") return "php";
  return null;
}

// A line is "commented out" if, once trimmed, it starts with a comment
// marker — catches a same-line "// import x from 'y'" near-miss. Multi-line
// regions (block comments, template literals, triple-quoted strings) are
// NOT line-prefix detectable at all — handled separately by
// `stripNonCodeRegions`, called once before any language extractor runs.
const COMMENT_PREFIXES = ["//", "#", "/*", "*", "<!--", "--"];
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return COMMENT_PREFIXES.some((p) => trimmed.startsWith(p));
}

// Replaces the CONTENTS of three multi-line region types with spaces
// (never removing lines — every other position in the text must keep its
// original line/column so isRealStatement's line lookups stay correct):
// block comments, JS/TS template literals, and Python triple-quoted
// strings. Without this, import-shaped text inside any of them is real
// text sitting at the start of ITS OWN line once the region spans multiple
// lines — isCommentLine/isInsideStringLiteral only ever look at a single
// line, so they can't catch a false positive that only exists because of
// what an EARLIER line opened.
function stripNonCodeRegions(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  out = out.replace(/`(?:[^`\\]|\\.)*`/g, blank);
  out = out.replace(/("""[\s\S]*?"""|'''[\s\S]*?''')/g, blank);
  return out;
}

// Rejects a match whose containing line has an odd number of unescaped
// quote characters before the match start — i.e. the match sits inside an
// outer string literal ("const s = 'import x from \"y\"';"), not as real
// syntax. A cheap, deliberately approximate stand-in for real string
// tracking: good enough to kill the near-miss this is meant to kill,
// without a full tokenizer.
function isInsideStringLiteral(line: string, matchStart: number): boolean {
  const before = line.slice(0, matchStart);
  let quoteChar: string | null = null;
  let count = 0;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (c === "\\") {
      i++; // skip escaped char
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      if (quoteChar === null) {
        quoteChar = c;
        count = 1;
      } else if (c === quoteChar) {
        quoteChar = null;
        count = 0;
      }
    }
  }
  return count > 0;
}

function lineAndOffsetAt(text: string, index: number): { line: string; offsetInLine: number } {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  let lineEnd = text.indexOf("\n", index);
  if (lineEnd === -1) lineEnd = text.length;
  return { line: text.slice(lineStart, lineEnd), offsetInLine: index - lineStart };
}

// A candidate match is accepted only if: (1) the statement-starting line
// (where the keyword itself begins, even for multi-line statements) isn't
// a comment, and (2) the keyword isn't sitting inside an outer string
// literal on that line.
function isRealStatement(text: string, keywordIndex: number): boolean {
  const { line, offsetInLine } = lineAndOffsetAt(text, keywordIndex);
  if (isCommentLine(line)) return false;
  if (isInsideStringLiteral(line, offsetInLine)) return false;
  return true;
}

function normalizeJs(raw: string): string {
  if (raw.startsWith("@")) return raw.split("/").slice(0, 2).join("/");
  return raw.split("/")[0];
}

function extractJs(text: string): string[] {
  const found: string[] = [];
  // import ... from "pkg" / export ... from "pkg" (also covers `export * from`,
  // `export { x } from`, and multi-line named-import lists via [\s\S]*?).
  // `d` (hasIndices) exposes the captured package name's own start offset —
  // needed because `[\s\S]*?\bfrom` is a lazy bridge that can walk INTO an
  // unrelated string literal later on the same line (e.g. a SQL string
  // containing the word "from") even when the line legitimately starts
  // with a real `import`/`export` keyword. Checking string-nesting at the
  // keyword's position alone (isRealStatement) doesn't catch that — the
  // capture's OWN position must be checked too.
  const fromRe = /^[ \t]*(import|export)\b[\s\S]*?\bfrom\s+["']([^"'\n]+)["']/gmd;
  for (const m of text.matchAll(fromRe)) {
    if (!isRealStatement(text, m.index!)) continue;
    // Check quote parity up to (but not including) the OPENING quote of the
    // captured package string itself — not the package text's own start.
    // Using the package text's start would count that opening quote as
    // "already inside a string," which is trivially true for every real
    // match (a quoted string always opens with a quote right before its
    // content) and would reject every legitimate import.
    const indices = (m as RegExpMatchArray & { indices: Array<[number, number]> }).indices;
    const openQuotePos = indices[2][0] - 1;
    const { line, offsetInLine } = lineAndOffsetAt(text, openQuotePos);
    if (isInsideStringLiteral(line, offsetInLine)) continue;
    found.push(normalizeJs(m[2]));
  }
  // import "pkg"; (side-effect import, no `from`)
  const bareImportRe = /^[ \t]*import\s+["']([^"'\n]+)["']\s*;?/gm;
  for (const m of text.matchAll(bareImportRe)) {
    if (isRealStatement(text, m.index!)) found.push(normalizeJs(m[1]));
  }
  // require("pkg") / import("pkg") — dynamic import, anywhere a real
  // statement could reasonably put it (assignment, await, bare call).
  const requireRe = /\b(?:require|import)\(\s*["']([^"'\n]+)["']\s*\)/g;
  for (const m of text.matchAll(requireRe)) {
    const { line, offsetInLine } = lineAndOffsetAt(text, m.index!);
    if (isCommentLine(line)) continue;
    if (isInsideStringLiteral(line, offsetInLine)) continue;
    found.push(normalizeJs(m[1]));
  }
  return found;
}

function extractPython(text: string): string[] {
  const found: string[] = [];
  // import pkg[.sub][ as alias][, pkg2[ as alias2] ...] — each item can
  // carry its own "as alias" before the next comma, which must be allowed
  // inside the repeated group or the chain breaks and everything after the
  // first alias silently falls out of the match.
  const importRe = /^[ \t]*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm;
  for (const m of text.matchAll(importRe)) {
    if (!isRealStatement(text, m.index!)) continue;
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name) found.push(name.split(".")[0]);
    }
  }
  // from pkg[.sub] import x
  const fromRe = /^[ \t]*from\s+([\w.]+)\s+import\b/gm;
  for (const m of text.matchAll(fromRe)) {
    if (isRealStatement(text, m.index!)) found.push(m[1].split(".")[0]);
  }
  return found;
}

function extractGo(text: string): string[] {
  const found: string[] = [];
  const normalize = (p: string) => p.replace(/\/v\d+$/, "");
  // Single-line: import "path" or import alias "path"
  const singleRe = /^[ \t]*import\s+(?:\w+\s+)?["']([^"'\n]+)["']/gm;
  for (const m of text.matchAll(singleRe)) {
    if (isRealStatement(text, m.index!)) found.push(normalize(m[1]));
  }
  // Block: import (\n  "path1"\n  alias "path2"\n)
  const blockRe = /^[ \t]*import\s*\(([\s\S]*?)\)/gm;
  for (const m of text.matchAll(blockRe)) {
    if (!isRealStatement(text, m.index!)) continue;
    const pathRe = /["']([^"'\n]+)["']/g;
    for (const p of m[1].matchAll(pathRe)) found.push(normalize(p[1]));
  }
  return found;
}

function extractRuby(text: string, filePath: string): string[] {
  const found: string[] = [];
  const isGemfile = /gemfile$/i.test(filePath);
  if (isGemfile) {
    // gem "name"[, "~> 1.0"] — a Gemfile dependency declaration.
    const gemRe = /^[ \t]*gem\s+["']([^"'\n]+)["']/gm;
    for (const m of text.matchAll(gemRe)) {
      if (isRealStatement(text, m.index!)) found.push(m[1].split("/")[0]);
    }
    return found;
  }
  // require "pkg" — require_relative is deliberately excluded (it loads a
  // local file, not a third-party package; matching it would misattribute
  // a plain relative require to some unrelated real gem sharing the name).
  const requireRe = /^[ \t]*require\s+["']([^"'\n]+)["']/gm;
  for (const m of text.matchAll(requireRe)) {
    if (isRealStatement(text, m.index!)) found.push(m[1].split("/")[0]);
  }
  return found;
}

function extractPhp(text: string, filePath: string): string[] {
  const found: string[] = [];
  if (/composer\.json$/i.test(filePath)) {
    // Structured JSON — no regex needed, and safest possible source: no
    // comment/string-literal ambiguity exists in JSON added-lines at all.
    try {
      const parsed = JSON.parse(text) as { require?: Record<string, string> };
      if (parsed.require) found.push(...Object.keys(parsed.require).filter((k) => k !== "php"));
    } catch {
      // A partial diff (added lines only) is rarely valid standalone JSON —
      // fall through to returning whatever we found (nothing), rather than
      // guessing at a malformed fragment.
    }
    return found;
  }
  // use Vendor\Sub\Class; — namespace-to-composer-package mapping isn't
  // mechanical in PHP, so this only extracts the first namespace segment
  // (lowercased) as the lookup key. That's enough for framework-level
  // detection (e.g. `use Illuminate\...` -> "illuminate") but deliberately
  // doesn't attempt vendor/package-accurate resolution — see docs/signatures.md.
  const useRe = /^[ \t]*use\s+([A-Za-z0-9_]+)\\/gm;
  for (const m of text.matchAll(useRe)) {
    if (isRealStatement(text, m.index!)) found.push(m[1].toLowerCase());
  }
  return found;
}

/**
 * Extracts normalized package names from one file's added diff lines.
 * `filePath` selects the language (and, for Ruby/PHP, distinguishes a
 * Gemfile/composer.json from ordinary source). Returns [] for files whose
 * extension isn't recognized, or for excluded doc files (.md etc.) — never
 * throws.
 */
export function extractImportedPackages(addedLines: string, filePath: string): string[] {
  const language = languageForPath(filePath);
  if (!language) return [];
  // composer.json is parsed as structured JSON — stripping would only ever
  // be a harmless no-op there, but skip it anyway rather than run a regex
  // pass with zero possible benefit right before a JSON.parse. Every other
  // path gets the stripped text.
  const isComposerJson = language === "php" && /composer\.json$/i.test(filePath);
  const text = isComposerJson ? addedLines : stripNonCodeRegions(addedLines);
  switch (language) {
    case "js":
      return extractJs(text);
    case "python":
      return extractPython(text);
    case "go":
      return extractGo(text);
    case "ruby":
      return extractRuby(text, filePath);
    case "php":
      return extractPhp(text, filePath);
  }
}
