import type { CategoryName } from "./types.js";

// filePath here is always a git-reported path (from `git log --numstat` /
// `git show`), which git always emits "/"-separated regardless of the host
// OS — never a filesystem path built with node:path, and never backslashes
// even on Windows. Hardcoding "/" below is therefore correct on every
// platform, not a Windows bug.
//
// Order matters: first matching rule wins.
const RULES: Array<[RegExp, CategoryName]> = [
  [/(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[jt]sx?$/i, "testing"],
  [/(^|\/)(claude\.md|agents\.md|\.cursor|\.aider|copilot)/i, "ai-workflow"],
  [
    /(^|\/)(\.github\/workflows|dockerfile|docker-compose|terraform|k8s|kubernetes|infra)(\/|$|\.)/i,
    "infra",
  ],
  [/(^|\/)(auth|authn|authz|session|oauth|login)(\/|$|[._-])/i, "auth"],
  [/(^|\/)(pay|payments?|billing|checkout|stripe)(\/|$|[._-])/i, "payments"],
  [/(^|\/)(migrations?|models?|schema)(\/|$)/i, "data"],
  [/\.(md|mdx)$|(^|\/)docs(\/|$)/i, "docs"],
  [
    /(^|\/)(components?|pages|views|public|styles)(\/|$)|\.(tsx|jsx|css|scss|vue|svelte)$/i,
    "frontend",
  ],
  [/(^|\/)(server|api|controllers?|services)(\/|$)|\.(go|rb|java|rs|py)$/i, "backend"],
];

export function categorize(filePath: string): CategoryName {
  for (const [pattern, name] of RULES) {
    if (pattern.test(filePath)) return name;
  }
  return "other";
}
