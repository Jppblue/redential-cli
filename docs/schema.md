# Bundle schema — field by field

The bundle is the ONLY thing that ever leaves the user's machine. This doc
explains every field: what it measures, why it exists, and what it does NOT
contain. Schema: `schema/bundle.v1.json` (JSON Schema, `additionalProperties:
false` everywhere — unknown fields are invalid by design).

## Top level

| Field | What | Why |
|---|---|---|
| `schema_version` | `"1.0.0"` | The schema is the trust contract; the version pins it |
| `runner` | `local` \| `ci` | Local scans are user-controlled (weakest tier). CI scans (future) run in employer infrastructure and can carry an OIDC anchor |
| `tool_version` | CLI version | Reproducibility of the analysis |
| `created_at` | Scan timestamp | Freshness |

## `repo`

- `host_type` — only the KIND of host ("github"). Never the URL, org, or
  repo name. The employer name is a separate claim the user makes in the
  Redential UI, clearly labeled as unverified.
- `age_days` — first commit to now.
- `repo_fingerprint` — salted hash of the root commit sha. The server can
  detect the same repo being re-submitted (consistency) without ever knowing
  which repo it is.

## `identity`

- `author_identity_hashes` — the user explicitly selects which author
  emails are theirs during `scan`; only salted hashes are included. Other
  contributors are never identified in any form.
- `other_contributors_count` — an aggregate count, nothing else.

## `commits`

Volume (`user_total`), span (`first_at`, `last_at`, `span_days`) and cadence
(`hour_histogram` 24 buckets UTC, `weekday_histogram` 7 buckets). The
histograms double as a behavioral fingerprint: they can be compared against
the same user's verified public activity as a soft authenticity anchor.

## `signed`

Count and ratio of cryptographically signed commits (GPG/SSH/x509). The
strongest local signal, because signatures cannot be forged retroactively
without the key.

## `languages`

Share of churn by file EXTENSION only (`.ts`, `.py`). Never file names.

## `categories`

Churn share per technical category (`auth`, `payments`, `infra`, `frontend`,
`backend`, `data`, `testing`, `ai-workflow`, `docs`, `other`). The category
is inferred locally from paths BEFORE hashing — the inference result
survives, the path does not. `ai-workflow` detects agent-assisted
development signals (Co-Authored-By trailers, presence of agent config
files) as counts/booleans only.

## `ownership`

`user_commit_ratio` — the user's share of total commits. Aggregate only.

## `integrity`

`merkle_root` over the user's commit shas (sha256). Enables future
re-verification ("does today's repo state still contain the commits you
attested last year?") without revealing a single sha.

## `attestation`

Records that the user confirmed "I am authorized to analyze this repository"
and when. The confirmation is part of the payload, not just a UI gate.

## What is deliberately absent

No source code. No diffs. No file or directory names. No commit messages.
No other contributors' names or emails. No remote URLs. No branch names.
No secrets (a secret-scan runs over the serialized payload and blocks on
match). If you need one of these for a feature, the answer is no — redesign
the feature.
