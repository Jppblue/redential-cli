# FAQ

Cada resposta aponta para o código e os testes que a sustentam.

A versão em inglês ([docs/faq.md](../faq.md)) é canônica; em caso de diferença, vale a versão em inglês.
### Como alguém sabe que eu realmente fiz esse trabalho?
O CLI não afirma saber disso: esse é o ponto central do sistema de níveis
(tiers). Um bundle Attested diz: *o histórico de git desta máquina mostra
esta atividade, reivindicada por esta identidade.* Âncoras parciais
respaldam essa reivindicação (seus e-mails de commit são verificados
contra os e-mails da sua conta verificada, commits assinados não podem
ser forjados retroativamente sem sua chave, e a cadência da sua atividade
é verificada quanto à consistência no servidor), mas nada disso comprova
autoria, e este README nunca finge que comprova.

A resposta real está no que vem depois: qualquer pessoa pode *reivindicar*
um histórico, mas na Redential uma reivindicação pode ser desafiada: uma
defesa ao vivo, na qual você responde perguntas geradas a partir dos
próprios números do seu bundle, em tempo real. Quem realmente fez o
trabalho responde de memória. Quem copiou um histórico não tem nada para
lembrar. Se você não poderia ter feito o trabalho, você não consegue
defendê-lo, e uma reivindicação não defendida permanece visivelmente
estacionada no nível mais fraco, rotulada exatamente como o que é.

### Não posso simplesmente importar um monte de bibliotecas para inflar minha lista de habilidades?
Não: um import isolado dificilmente marca uma habilidade. A maioria das
assinaturas exige um especificador de import distintivo e inequívoco (não
um nome de pacote genérico compartilhado entre ecossistemas) ou um
formato real de chamada de API a partir dos seus próprios diffs
(`stripe.checkout`, não apenas `import Stripe`). Veja
[../signatures.md](../signatures.md) para as regras exatas de detecção e
a disciplina por trás delas. Mas a resposta honesta é maior do que a
precisão da detecção: este CLI só produz o nível **Attested**, o mais
fraco na Redential, explicitamente rotulado como metadados não
verificados. Inflar sua lista de habilidades te dá uma lista um pouco
mais longa no nível mais fraco; isso não faz nada pelos níveis Proven ou
Verified, que exigem código ao vivo ou uma sessão defendida. Manipular
metadados para parecer impressionante em um nível já rotulado como "leve
isso com uma pitada de sal" não é um grande prêmio.

### Não posso reproduzir o histórico de git de outra pessoa em um novo repositório e reivindicá-lo?
Você poderia fabricar timestamps de commit em um repositório novo: é
exatamente por isso que dados locais são explicitamente o nível *mais
fraco*, não o mais forte. Um histórico reproduzido ainda precisa
sobreviver a várias âncoras parciais: commits assinados (uma assinatura
GPG/SSH não pode ser forjada retroativamente sem a chave), uma impressão
digital comportamental (a cadência por hora/dia da semana é comparada com
sua própria atividade pública verificada, como uma checagem leve de
consistência), um sinal de forense de reescrita (`integrity.date_forensics`:
a data de autor do git é fácil de forjar, mas um script que reproduz anos
de histórico fabricado de uma só vez também deixa a data de *committer*
de cada commit concentrada nessa mesma sessão; um sinal heurístico do
lado do servidor, não um veredito local, veja
[../schema.md](../schema.md#date_forensics-measurement-contract)), e,
acima de tudo, o bundle só chega a ganhar o nível **Attested**, apenas
metadados. Qualquer coisa acima disso exige uma defesa NDA-safe: uma
breve sessão gravada em que você responde, ao vivo, perguntas geradas a
partir do seu próprio bundle. Falsificar um histórico de git é barato;
defender uma experiência fabricada sob interrogatório, em tempo real, não
é. Essa diferença é o verdadeiro limite de segurança, não as heurísticas
de detecção.

### O que exatamente sai da minha máquina?
O bundle: byte a byte o JSON que `redential scan --json` imprime e que
`submit` sempre mostra na íntegra antes de pedir sua confirmação, nada é
adicionado ou enriquecido depois disso. Essa não é uma promessa que você
precise aceitar por fé:
[`test/privacy/submit-guardrail.test.ts`](../../test/privacy/submit-guardrail.test.ts)
verifica que a string literal enviada por HTTP pelo `submit` é `===` à
string que ele imprimiu antes da sua confirmação, não uma re-serialização
de um objeto já processado. Cada campo é documentado em
[../schema.md](../schema.md), e o próprio schema (`schema/bundle.v1.json`)
define `additionalProperties: false` em todos os lugares: um campo não
listado torna o bundle inválido por construção, não apenas por convenção.

### Por que eu deveria confiar em um CLI com o código do meu empregador?
Porque ele nunca toca no código do seu empregador de nenhuma forma que
saia do seu laptop. Ele é local por design (`scan` é estruturalmente
livre de rede, não apenas livre de rede por padrão), totalmente open
source sob a licença Apache-2.0, para que você possa ler cada linha antes
de executá-lo, e suas afirmações de privacidade são
[testes executáveis](../../test/privacy/) que você mesmo pode rodar
(`npm test`), em vez de uma página de texto. Não há telemetria, não há
analytics, não há processo em segundo plano: as únicas duas chamadas de
rede que este CLI faz são o device flow do `login` e o envio do `submit`,
ambas exigindo uma ação explícita sua. E todo release publicado carrega
uma atestação de proveniência assinada pelo Sigstore, que você pode
verificar (`npm audit signatures`), provando que foi construído a partir
exatamente deste repositório, não do laptop de alguém.

### O que "Attested" realmente comprova?
Honestamente, não muita coisa sozinho, e isso é por design, não um
descuido. "Attested" significa: o histórico local de git desta pessoa
mostra este padrão de atividade, autodeclarado e refutável, com âncoras
parciais (commits assinados, impressão digital comportamental, checagens
de consistência no servidor), mas sem verificação independente do código
subjacente. Ele nunca é rotulado ou misturado visualmente com Proven ou
Verified, que exigem conectar um repositório legível (via GitHub App) ou
defender a reivindicação ao vivo. Pense em Attested como "merece uma
pergunta de acompanhamento", não como "verificado": todo o design do CLI
existe para manter essa distinção honesta, em vez de deixar um bundle de
metadados emprestar credibilidade que não conquistou. Veja
[../principles.md](../principles.md) (princípio 6, "Honesto sobre
confiança") para o raciocínio completo.

### Isso é apenas um funil para o seu SaaS?
A resposta honesta: o CLI é a camada de captura open source da
[Redential](https://redential.com), e a Redential é um produto comercial.
Nenhum desses fatos está escondido: você está lendo os dois agora mesmo.

O que torna isso uma ferramenta, e não um funil: o `scan` é totalmente
útil de forma independente. Sem conta, sem login, sem rede: ele analisa
seu repositório e mostra tudo o que encontrou, localmente, para sempre,
de graça. A plataforma só entra em cena se você decidir que o resultado
vale a pena publicar, e nada é enviado até que você tenha visto o payload
exato e confirmado o prompt. Não existe modo limitado, não existe
"desbloquear resultados completos": a análise local É a análise completa.

O modelo de negócio é a plataforma de credenciais. O papel do CLI é ser
confiável o suficiente para que você considere usá-lo, e é por isso que
toda afirmação de privacidade neste README corresponde a um teste
executável, em vez de uma promessa.

