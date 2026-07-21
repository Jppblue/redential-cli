<h1 align="center">Redential CLI</h1>

<div align="center">

[English](../../README.md) · [Español](README.es.md) · **Português (BR)** · [Français](README.fr.md) · [Italiano](README.it.md)

<p><img src="../assets/icon-pixel.svg?v=2" alt="Redential logo" height="88"></p>

<p><img src="../assets/wordmark.svg?v=4" alt="REDENTIAL" height="44"></p>

<p><picture>
<source media="(prefers-color-scheme: dark)" srcset="../assets/tagline-dark.svg?v=2">
<img src="../assets/tagline-light.svg?v=2" alt="private work into evidence." height="16">
</picture></p>

[![npm version](https://img.shields.io/npm/v/%40redential%2Fcli.svg)](https://www.npmjs.com/package/@redential/cli)
[![CI](https://github.com/Redential/redential-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Redential/redential-cli/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../LICENSE)

Seu melhor trabalho provavelmente está sob um NDA.

Transforme trabalho privado em uma credencial de desenvolvedor NDA-safe. Seu
código nunca sai da sua máquina.

<img src="../assets/demo.gif" alt="npx redential scan sendo executado em um terminal: capacidades detectadas localmente, nada é enviado" width="100%">

[Site](https://redential.com) · [Modelo de confiança](#modelo-de-confiança) · [FAQ](#faq) · [Documentação](#documentação)

</div>

## Como funciona

```bash
npx redential scan
```

Sem login, sem configuração, sem instalação global. O `scan` roda
inteiramente local e não faz nenhuma chamada de rede.

O Redential CLI analisa o histórico do git e os padrões de implementação
localmente, e então produz um bundle (pacote de evidências) limitado de
metadados, descrevendo as habilidades e capacidades detectadas em
repositórios que você não pode conectar.

Você revisa o bundle exato antes de qualquer coisa ser enviada. Se você
optar por rodar `submit`, a Redential adiciona essa evidência a um
[**perfil de capacidades Attested (atestado)**](faq.pt-BR.md#o-que-attested-realmente-comprova)
que você pode compartilhar.

Seu código-fonte nunca sai da sua máquina.

<!-- TODO: Add screenshot of a public profile showing Attested private-work capabilities -->

## Execute-o

Quando você quiser o resultado no seu perfil Redential:

```bash
npx redential login    # device flow, one time
npx redential submit   # scans again, shows you the bundle, asks before uploading
npx redential logout   # deletes the locally stored session
```

Prefira uma instalação persistente:

```bash
npm install -g redential
redential scan
```

(`redential` é um alias de
[`@redential/cli`](https://www.npmjs.com/package/@redential/cli), o pacote
canônico: veja [Verificando o pacote em si](#verificando-o-pacote-em-si).)

Plataformas suportadas: macOS, Linux e Windows, no Node.js 20 e 22 (cada
release é verificado nas seis combinações pela CI).

## O que o `scan` mostra

Em um terminal real, o `scan` imprime um resumo curto e legível para
humanos, não o JSON bruto. Ele é montado inteiramente a partir de campos
que já existem no bundle (veja [../schema.md](../schema.md) para todos os
campos, e [../scan.md](../scan.md) para o layout completo): capacidades
detectadas (achados estruturais, como um fluxo de tratamento de webhook
verificado, destacados primeiro; todo o restante agrupado por categoria),
principais linguagens e categorias, proporções de ownership (propriedade)
e de commits assinados, e um bloco final reafirmando o que sai da máquina
e o que nunca sai:

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

O JSON exato está a uma flag de distância, nunca escondido: `redential
scan --json` (ou `redential scan | jq`, ou qualquer stdout
redirecionado/encadeado) imprime **apenas** o bundle literal, byte a byte
o que `submit` enviaria. E `redential submit` sempre mostra a você esse
mesmo JSON exato, na íntegra, imediatamente antes de pedir a confirmação
do envio, em todos os caminhos, de forma impossível de pular. O resumo
acima é uma conveniência exclusiva do terminal, derivada desse mesmo
bundle, nunca uma segunda fonte de dados.

Este é o formato do payload (`redential scan --json`): o que de fato é
revisado antes de qualquer envio:

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

Referência completa de comandos: [../scan.md](../scan.md).

## Modelo de confiança

| Nunca sai da sua máquina | Só viaja depois que você roda `submit`, e só isso |
|---|---|
| Código-fonte, diffs, trechos de código | O bundle que o `scan` imprime com `--json` (e que o `submit` sempre mostra na íntegra antes do envio), byte a byte |
| Nomes de arquivos e diretórios | Uma extensão (`.ts`) e uma categoria inferida (`backend`) |
| Mensagens de commit | Cadência agregada: histogramas por hora/dia da semana |
| Nomes ou e-mails de outros contribuidores | Uma contagem agregada de outros contribuidores |
| A URL do remote | Apenas o *tipo* de host (`github`, `gitlab`, …), nunca a URL |
| Segredos de qualquer tipo | Nada: um secret-scan roda sobre o bundle e bloqueia a saída em caso de qualquer correspondência |
| - | Seu private label (rótulo privado): texto livre que *você mesmo* digita (nunca derivado do seu código), enviado ao lado do bundle, nunca dentro dele, exibido antes de você confirmar o envio, obrigatório, visível apenas para o dono ([../private-label.md](../private-label.md)) |

Cada linha à esquerda é respaldada por um [teste executável](../../test/privacy/),
conforme [../privacy-tests.md](../privacy-tests.md), não apenas uma
declaração de política. O próprio `scan` não faz nenhuma chamada de rede;
`login` e `submit` são os únicos dois comandos que tocam a rede, e
`submit` não envia nada sem sua confirmação explícita. Justificativa
completa: [../principles.md](../principles.md).

### Verificando o pacote em si

Todo release é publicado a partir do GitHub Actions em um commit com tag,
com proveniência do npm (`npm publish --provenance`), nunca a partir do
laptop de alguém. Verifique se qualquer versão instalada foi construída a
partir exatamente deste código-fonte:

```bash
npm audit signatures
```

Veja [../releasing.md](../releasing.md) para o processo completo de
release e o que a atestação de proveniência realmente comprova.

## FAQ

- [Como alguém sabe que eu realmente fiz esse trabalho?](faq.pt-BR.md#como-alguém-sabe-que-eu-realmente-fiz-esse-trabalho)
- [Não posso simplesmente importar um monte de bibliotecas para inflar minha lista de habilidades?](faq.pt-BR.md#não-posso-simplesmente-importar-um-monte-de-bibliotecas-para-inflar-minha-lista-de-habilidades)
- [Não posso reproduzir o histórico de git de outra pessoa em um novo repositório e reivindicá-lo?](faq.pt-BR.md#não-posso-reproduzir-o-histórico-de-git-de-outra-pessoa-em-um-novo-repositório-e-reivindicá-lo)
- [O que exatamente sai da minha máquina?](faq.pt-BR.md#o-que-exatamente-sai-da-minha-máquina)
- [Por que eu deveria confiar em um CLI com o código do meu empregador?](faq.pt-BR.md#por-que-eu-deveria-confiar-em-um-cli-com-o-código-do-meu-empregador)
- [O que "Attested" realmente comprova?](faq.pt-BR.md#o-que-attested-realmente-comprova)
- [Isso é apenas um funil para o seu SaaS?](faq.pt-BR.md#isso-é-apenas-um-funil-para-o-seu-saas)

## Documentação

- [faq.pt-BR.md](faq.pt-BR.md): respostas diretas às perguntas difíceis
- [../principles.md](../principles.md): as seis regras inegociáveis
- [../privacy-tests.md](../privacy-tests.md): qual teste comprova qual regra
- [../scan.md](../scan.md): referência completa do comando `scan`
- [../login-submit.md](../login-submit.md): `login`, `submit`, `logout`
- [../private-label.md](../private-label.md): o private label obrigatório: o que é, por que ele viaja fora do bundle
- [../schema.md](../schema.md): todos os campos do bundle, explicados
- [../signatures.md](../signatures.md): como funciona a detecção de habilidades
- [../releasing.md](../releasing.md): como um release é construído e verificado

Se o repositório que você está escaneando é seu e pode ser conectado, o
`scan` não é a melhor ferramenta: o [GitHub App](https://redential.com)
lê o código de fato e concede níveis mais fortes do que metadados locais
jamais poderiam.

## Contribuindo

Veja [../../CONTRIBUTING.md](../../CONTRIBUTING.md): a maioria das
contribuições é uma adição de uma linha a um mapa de assinaturas, e
issues iniciais estão rotuladas como
[`up-for-grabs`](https://github.com/Redential/redential-cli/labels/up-for-grabs).
A contribuição que mais queremos: **ajudar a fortalecer a evidência**,
fazendo red-team dos sinais, propondo padrões estruturais mais fortes,
melhorando a forense de fraudes, sempre dentro da premissa NDA-safe (a
evidência só sai da máquina como metadados limitados). Relatos de bugs e
problemas de segurança: [../../SECURITY.md](../../SECURITY.md).

## Licença

Apache-2.0

---

O README em inglês é a versão canônica: se houver qualquer divergência,
a versão em inglês prevalece. Veja [../../README.md](../../README.md).
