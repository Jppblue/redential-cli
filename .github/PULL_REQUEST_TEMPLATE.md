## What does this PR do, and why does it fit the north star?

<!--
Every contribution should make the credential more solid, trustworthy, or
verifiable (see CONTRIBUTING.md). Explain what this change does and how it
moves that needle.
-->

## Checklist

- [ ] Tests pass locally (`npm test`)
- [ ] `npm run typecheck` passes

### If this adds or changes a detection signature

- [ ] Includes at least one positive fixture and one negative fixture
      (the negative fixture is a genuine near-miss, not unrelated text)
- [ ] The slug used already exists in `taxonomy.json` — if it's new, that's
      a **separate** PR with a rationale, linked here: #

### If this touches WHAT data leaves the machine, or WHERE it's sent

- [ ] Links the prior "Data boundary change" discussion issue (required
      before this PR was opened): #
- [ ] Schema version bumped, with `docs/schema.md` updated
- [ ] Adds/updates a test in `test/privacy/`

### If this adds a new runtime dependency

- [ ] Written justification included below (what it does, why the
      existing stack — commander/vitest — can't do it, what it adds to
      the supply-chain surface)

### Docs and changelog

- [ ] `CHANGELOG.md` entry added under `[Unreleased]` (if user-facing)
- [ ] Relevant doc in `docs/` added or updated, in English

## Additional context

<!-- Anything a reviewer needs that isn't obvious from the diff. -->
