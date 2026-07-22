<h1 align="center">Redential CLI</h1>

<div align="center">

[English](../../README.md) · [Español](README.es.md) · [Português (BR)](README.pt-BR.md) · **Français** · [Italiano](README.it.md)

<p><img src="../assets/icon-pixel.svg?v=2" alt="Redential logo" height="88"></p>

<p><img src="../assets/wordmark.svg?v=4" alt="REDENTIAL" height="44"></p>

<p><picture>
<source media="(prefers-color-scheme: dark)" srcset="../assets/tagline-dark.svg?v=2">
<img src="../assets/tagline-light.svg?v=2" alt="private work into evidence." height="16">
</picture></p>

[![npm version](https://img.shields.io/npm/v/%40redential%2Fcli.svg)](https://www.npmjs.com/package/@redential/cli)
[![CI](https://github.com/Redential/redential-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Redential/redential-cli/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../LICENSE)

Votre meilleur travail est probablement soumis à un NDA.

Transformez le travail privé en une certification de développeur NDA-safe.
Votre code ne quitte jamais votre machine.

<img src="../assets/demo.gif" alt="npx redential scan en cours d'exécution dans un terminal : capacités détectées localement, rien n'est envoyé" width="100%">

[Site web](https://redential.com) · [Modèle de confiance](#modèle-de-confiance) · [FAQ](#foire-aux-questions) · [Documentation](#documentation)

</div>

## Comment ça fonctionne

```bash
npx redential scan
```

Aucun login, aucune configuration, aucune installation globale. `scan`
s'exécute entièrement en local et n'effectue aucun appel réseau.

Redential CLI analyse localement l'historique git et les patterns
d'implémentation, puis produit un bundle (un lot borné de métadonnées)
décrivant les compétences et capacités détectées dans les dépôts que vous
ne pouvez pas connecter.

Vous examinez le bundle exact avant que quoi que ce soit ne soit envoyé.
Si vous choisissez de le soumettre (`submit`), Redential ajoute cette
preuve à un
[**profil de capacités Attested**](faq.fr.md#que-prouve-réellement-attested)
(littéralement « attesté ») que vous pouvez partager.

Votre code source ne quitte jamais votre machine.

<!-- TODO: Add screenshot of a public profile showing Attested private-work capabilities -->

## L'exécuter

Quand vous voulez que le résultat apparaisse sur votre profil Redential :

```bash
npx redential login    # device flow, one time
npx redential submit   # scans again, shows you the bundle, asks before uploading
npx redential logout   # deletes the locally stored session
```

Vous préférez une installation persistante :

```bash
npm install -g redential
redential scan
```

(`redential` est un alias de
[`@redential/cli`](https://www.npmjs.com/package/@redential/cli), le
paquet canonique, voir [Vérification du paquet lui-même](#vérification-du-paquet-lui-même).)

Plateformes prises en charge : macOS, Linux et Windows, sur Node.js 20 et
22 : chaque release est vérifiée sur ces six combinaisons par la CI.

## À quoi ressemble `scan`

Sur un vrai terminal, `scan` affiche un résumé court et lisible par un
humain, pas le JSON brut. Il est entièrement composé à partir de champs
déjà présents dans le bundle (voir [docs/schema.md](../schema.md) pour la
liste complète des champs, et [docs/scan.md](../scan.md) pour la mise en
page complète) : les capacités détectées (les constats structurels, comme
un flux de gestion de webhook vérifié, sont mis en avant en premier ; tout
le reste est regroupé par catégorie), les langages et catégories
principaux, les ratios de propriété et de commits signés, ainsi qu'un
bloc de clôture qui rappelle ce qui quitte la machine et ce qui n'en sort
jamais :

```
  PRIVATE WORK, LOCALLY DERIVED
  1 year · 1,378 authored commits · 78% ownership

  CAPABILITIES DETECTED

  Payment webhook flow     4 commits   STRUCTURAL · DIRECT

  Payments
    Stripe                12 commits

  TOP LANGUAGES
  .ts   ████████████████████   62%
  .sql  █████░░░░░░░░░░░░░░░   14%

  TOP CATEGORIES
  Backend  ████████████████████   51%
  Testing  ███████░░░░░░░░░░░░░   18%

  Ownership       78% of this repo's commits are yours
  Signed commits  45% of your commits are cryptographically signed

  ────────────────────────────────────────────────────────────
  Nothing left your machine. Nothing is uploaded unless you run
  `redential submit` — and only the bounded bundle: aggregates,
  salted fingerprints, and closed-vocabulary capability slugs.
  Never code, file names, commit messages, or other contributors.
  Verify: github.com/Redential/redential-cli
  ────────────────────────────────────────────────────────────

  Inspect the exact payload:  redential scan --json
  More detail (hour/weekday histograms):  redential scan --details

  Add this private work to your public Redential profile:
  → redential login && redential submit
```

Le JSON exact n'est jamais caché, à une option près : `redential scan
--json` (ou `redential scan | jq`, ou toute sortie standard redirigée ou
envoyée dans un pipe) affiche **uniquement** le bundle littéral, octet
pour octet ce que `submit` enverrait. Et `redential submit` vous montre
toujours ce même JSON exact, dans son intégralité, juste avant de vous
demander de confirmer l'envoi, sur tous les chemins, sans possibilité de
l'ignorer. Le résumé ci-dessus est une simple commodité propre au
terminal, dérivée de ce même bundle, jamais une seconde source de
données.

Voici la forme du payload (`redential scan --json`) : ce qui est
réellement examiné avant tout envoi :

```
{
  "schema_version": "1.2.0",
  "runner": "local",
  "tool_version": "0.5.0",
  "created_at": "2026-07-09T14:32:01.000Z",
  "repo": { "host_type": "github", "age_days": 742, "repo_fingerprint": "a3f9…" },
  "identity": { "author_identity_hashes": ["9c1e…"], "other_contributors_count": 3 },
  "commits": { "user_total": 1847, "first_at": "2024-06-02T09:14:00Z", "last_at": "2026-07-08T21:05:00Z", "span_days": 767, "hour_histogram": [...], "weekday_histogram": [...] },
  "signed": { "count": 831, "ratio": 0.45, "key_types": ["ssh"] },
  "languages": [ { "extension": ".ts", "share": 0.62 }, { "extension": ".sql", "share": 0.14 } ],
  "categories": [ { "name": "backend", "commit_count": 902, "churn_share": 0.51 }, { "name": "testing", "commit_count": 340, "churn_share": 0.18 } ],
  "detected_skills": [ { "slug": "payments/stripe", "commit_count": 12, "first_seen": "2024-09-01T10:00:00Z", "last_seen": "2025-11-20T18:30:00Z" }, { "slug": "payments/payment-webhook-flow", "commit_count": 4, "first_seen": "2024-09-03T08:00:00Z", "last_seen": "2024-09-03T08:00:00Z", "evidence": "structural", "confidence": "direct" } ],
  "ownership": { "user_commit_ratio": 0.78 },
  "integrity": { "merkle_root": "7be2…", "algorithm": "sha256", "date_forensics": { "author_span_days": 767, "committer_span_days": 763, "mismatch_ratio": 0.06, "committer_burst_ratio": 0.02 } },
  "attestation": { "authorized_confirmation": true, "confirmed_at": "2026-07-09T14:32:01.000Z" }
}
```

Référence complète de commandes : [docs/scan.md](../scan.md).

## Modèle de confiance

| Ne quitte jamais votre machine | Ne circule qu'après avoir exécuté `submit`, et seulement ceci |
|---|---|
| Code source, diffs, extraits | Le bundle que `scan` affiche avec `--json` (et que `submit` montre toujours dans son intégralité avant l'envoi), octet pour octet |
| Noms de fichiers et de répertoires | Une extension (`.ts`) et une catégorie déduite (`backend`) |
| Messages de commit | Cadence agrégée : histogrammes par heure/jour de la semaine |
| Noms ou emails des autres contributeurs | Un décompte agrégé des autres contributeurs |
| L'URL du remote | Seulement le *type* d'hébergeur (`github`, `gitlab`, …), jamais l'URL |
| Tout type de secret | Rien : une analyse de secrets (secret-scan) s'exécute sur le bundle et bloque toute sortie en cas de correspondance |
| – | Votre private label : un texte libre que *vous* saisissez vous-même (jamais dérivé de votre code), envoyé à côté du bundle, jamais à l'intérieur, affiché avant que vous ne confirmiez l'envoi, obligatoire, visible uniquement par le propriétaire ([docs/private-label.md](../private-label.md)) |

Chaque ligne de la colonne de gauche est étayée par un
[test exécutable](../../test/privacy/), conformément à
[docs/privacy-tests.md](../privacy-tests.md), et pas seulement par une
déclaration de principe. `scan` en lui-même n'effectue aucun appel
réseau ; `login` et `submit` sont les deux seules commandes à toucher au
réseau, et `submit` n'envoie rien sans votre confirmation explicite.
Justification complète : [docs/principles.md](../principles.md).

### Vérification du paquet lui-même

Chaque release est publiée depuis GitHub Actions sur un commit tagué,
avec la provenance npm (`npm publish --provenance`) : jamais depuis
l'ordinateur portable de qui que ce soit. Vérifiez que toute version
installée a bien été construite à partir de ce code source exact :

```bash
npm audit signatures
```

Voir [docs/releasing.md](../releasing.md) pour le processus complet de
release et ce que l'attestation de provenance prouve réellement.

## Foire aux questions

- [Comment peut-on savoir que j'ai réellement effectué ce travail ?](faq.fr.md#comment-peut-on-savoir-que-jai-réellement-effectué-ce-travail-)
- [Ne puis-je pas simplement importer un tas de bibliothèques pour gonfler ma liste de compétences ?](faq.fr.md#ne-puis-je-pas-simplement-importer-un-tas-de-bibliothèques-pour-gonfler-ma-liste-de-compétences-)
- [Ne puis-je pas rejouer l'historique git de quelqu'un d'autre dans un nouveau dépôt et le revendiquer ?](faq.fr.md#ne-puis-je-pas-rejouer-lhistorique-git-de-quelquun-dautre-dans-un-nouveau-dépôt-et-le-revendiquer-)
- [Qu'est-ce qui quitte exactement ma machine ?](faq.fr.md#quest-ce-qui-quitte-exactement-ma-machine-)
- [Pourquoi devrais-je faire confiance à un CLI avec le code de mon employeur ?](faq.fr.md#pourquoi-devrais-je-faire-confiance-à-un-cli-avec-le-code-de-mon-employeur-)
- [Que prouve réellement Attested?](faq.fr.md#que-prouve-réellement-attested)
- [Est-ce simplement un entonnoir vers votre SaaS ?](faq.fr.md#est-ce-simplement-un-entonnoir-vers-votre-saas-)
- [Et les commits en binôme ou assistés par IA?](faq.fr.md#et-les-commits-en-binôme-ou-assistés-par-ia)

## Documentation

- [faq.fr.md](faq.fr.md) : des réponses directes aux questions difficiles
- [docs/principles.md](../principles.md) : les six règles non négociables
- [docs/privacy-tests.md](../privacy-tests.md) : quel test prouve quelle règle
- [docs/scan.md](../scan.md) : référence complète de la commande `scan`
- [docs/login-submit.md](../login-submit.md) : `login`, `submit`, `logout`
- [docs/private-label.md](../private-label.md) : le private label obligatoire : ce que c'est, pourquoi il voyage en dehors du bundle
- [docs/schema.md](../schema.md) : tous les champs du bundle, expliqués
- [docs/signatures.md](../signatures.md) : comment fonctionne la détection des compétences
- [docs/releasing.md](../releasing.md) : comment une release est construite et vérifiée

Si le dépôt que vous analysez est le vôtre et qu'il peut être connecté,
`scan` n'est pas le meilleur outil : la [GitHub App](https://redential.com)
lit le code réel et accorde des niveaux plus solides que ce que des
métadonnées locales pourront jamais offrir.

## Contribuer

Voir [CONTRIBUTING.md](../../CONTRIBUTING.md) : la plupart des
contributions consistent en un ajout d'une seule ligne à une carte de
signatures, et les tickets pour démarrer sont étiquetés
[`up-for-grabs`](https://github.com/Redential/redential-cli/labels/up-for-grabs).
La contribution que nous voulons le plus : **aider à renforcer les
preuves** (red-team des signaux, proposer des schémas structurels plus
solides, améliorer l'analyse forensique de falsification), toujours
dans le cadre du principe NDA-safe (les preuves ne quittent la machine
que sous forme de métadonnées bornées). Signalements de bugs et
problèmes de sécurité : [SECURITY.md](../../SECURITY.md).

## Licence

Apache-2.0

---

**Note :** le README en anglais est la version canonique de ce document.
En cas de divergence entre cette traduction et la version anglaise,
c'est la version anglaise qui fait foi. Voir [../../README.md](../../README.md).
