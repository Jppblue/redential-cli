# Redential CLI

Turn your private work into a portable, NDA-safe credential.

Your most valuable experience often lives in repositories you can't share —
your employer's code. `@redential/cli` analyzes your git history **locally**
and produces a metadata-only proof bundle: volume, span, cadence, languages,
technical categories, signed commits, ownership. Never the code itself.

```bash
npx @redential/cli login    # device flow, one time
npx @redential/cli scan     # analyze — prints EXACTLY what would be uploaded
npx @redential/cli submit   # upload, after your explicit confirmation
```

## What leaves your machine

Only the bundle you reviewed in `scan` — byte for byte. See
[docs/schema.md](docs/schema.md) for every field, and
[docs/principles.md](docs/principles.md) for the rules that govern this tool.

**Never leaves your machine:** source code, snippets, file names, commit
messages, other contributors' identities, remote URLs, secrets. These are
not policies — they are [executable tests](test/privacy/).

## What you get

An **Attested** tier on your Redential profile — honestly labeled as
metadata-based (weaker than Proven/Verified, which require readable code).
Strengthen it with an NDA-safe defense: a short recorded session where you
defend your experience against questions generated from your own bundle.

If the repo IS connectable (your own project), don't use this — connect the
[GitHub App](https://redential.com) instead: it reads the actual code and
grants stronger tiers.

## Trust model, honestly

Local data is falsifiable — that's why this tier is the weakest and clearly
labeled. Partial anchors: signed commits, behavioral fingerprints, and
server-side consistency checks. Releases are published with npm provenance
(`npm audit signatures` to verify).

## License

Apache-2.0
