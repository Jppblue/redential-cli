---
name: add-signature
description: Add a new skill-detection signature (Tier 1 package-map entry or Tier 2 signature file) with the fixtures and tests this repo requires. Use when adding detection for a new library, framework, or technology.
---

# Add a detection signature

Detection is pure, versioned, public data: a match maps added diff lines
to a slug from the closed vocabulary in `taxonomy.json` — locally,
deterministically, zero network. Adding a signature means adding data,
not code. The authoritative contract is
[docs/signatures.md](../../../docs/signatures.md); this skill is the
step-by-step path through it.

## Step 1 — does the slug exist?

Check `taxonomy.json` for the slug you want to map to. If it's missing,
adding it is a **separate PR first**, with a short rationale for the new
vocabulary — a signature naming a slug outside `taxonomy.json` fails at
load time, and new vocabulary is reviewed on its own before anything
depends on it. Never bundle a new slug into the signature PR that needs
it.

## Step 2 — pick the tier

**Tier 1** (a one-line entry in `signatures/package-map.json`) when the
bare import unambiguously identifies the technology: importing `stripe`
means using Stripe, full stop.

**Tier 2** (a JSON file at `signatures/<category>/<name>.json`) when:
- there is no import at all (Docker, Terraform, CI workflows — detected
  by file path), or
- the import is ambiguous (`@supabase/supabase-js` serves both auth and
  db; only the API shape disambiguates), or
- detection is by inheritance, not declaration (`class X < ApplicationRecord`).

## Step 3a — Tier 1 entry

Add `"package-name": "category/slug"` to `signatures/package-map.json`.
The key must be the name **as the import extractor actually produces it**
(`src/import-detect.ts`) — the classic dead-key traps:

- Python/Ruby: the key is the IMPORT name, not the distribution name
  (`bs4`, never `beautifulsoup4`).
- JVM: the key is the real import root, never the Maven/Gradle groupId
  when they differ (`lombok`, never `org.projectlombok`).
- Rust: hyphens normalize to underscores (`actix_web`, not `actix-web`).
- Dotted keys (JVM/C#): no key may be a strict prefix of another dotted
  key — `test/package-map.test.ts` enforces this; pick the depth that
  distinguishes the library (`com.google.gson` at 3) or umbrellas it
  (`org.springframework` at 2).

## Step 3b — Tier 2 file

```json
{
  "slug": "category/slug",
  "importPatterns": ["from\\s+[\"']thing[\"']"],
  "apiPatterns": ["\\bthing\\.(verb1|verb2)\\b"],
  "configFilePatterns": [],
  "fixtures": {
    "positive": [{ "path": "src/lib/thing.ts", "diff": "+import thing from \"thing\"" }],
    "negative": [{ "path": "README.md", "diff": "+We evaluated thing and chose otherthing" }]
  }
}
```

- One signature file per slug, maximum — the test suite rejects a slug
  claimed by two files.
- Patterns are OR'd: any one of the three arrays matching is enough.
  Each array may be `[]`, but at least one pattern must exist overall.
- `configFilePatterns` match the touched file's PATH;
  `importPatterns`/`apiPatterns` match the commit's ADDED lines only.
- Patterns are regexes inside JSON — escape backslashes twice (`\\b`).
- Pattern discipline: match the library's own unmistakable surface,
  never a generic shape (`extends Model` is too generic; the specific
  `use Illuminate\\Database\\Eloquent\\Model;` import is not).

## Step 4 — fixtures (the tests will hold you to this)

`test/skill-detect.test.ts` runs every signature file against its own
fixtures and fails the suite unless:

- at least one positive AND one negative fixture exist;
- every positive fixture actually matches the signature;
- no negative fixture matches (it must be a near-miss, not noise);
- every declared pattern is exercised by at least one positive fixture
  (dead or typo'd patterns fail);
- at least one negative fixture is a genuine near-miss that mentions
  the library by name — a comment, a doc line, a string literal — not
  an unrelated diff.

## Step 5 — close out

```bash
npm test   # picks up new map entries and signature files automatically
```

Add a line to `CHANGELOG.md` under `[Unreleased]`, then open the PR. If
your change is a Tier 1 map entry with an existing slug, no discussion
issue is needed — it's taxonomy-valid public data, the most welcome
one-line PR this repo has.
