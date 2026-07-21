# FAQ

Ogni risposta rimanda al codice e ai test che la sostengono.

La versione inglese ([docs/faq.md](../faq.md)) è canonica; in caso di differenze, vale la versione inglese.
### Come fa qualcuno a sapere che ho davvero fatto questo lavoro?
La CLI non pretende di saperlo: è proprio questo il punto del sistema a
livelli. Un bundle Attested dice: *la cronologia git di questa macchina
mostra questa attività, rivendicata da questa identità.* Ancoraggi parziali
sostengono l'affermazione (le tue email di commit vengono confrontate con le
email verificate del tuo account, i commit firmati non possono essere
falsificati retroattivamente senza la tua chiave, e la cadenza della tua
attività viene verificata per coerenza lato server), ma niente di tutto ciò
dimostra la paternità, e il README non pretende mai che lo faccia.

La vera risposta sta in quello che viene dopo: chiunque può *rivendicare*
una cronologia, ma su Redential una rivendicazione può essere messa alla
prova: una difesa dal vivo, in cui rispondi a domande generate a partire
dai numeri del tuo stesso bundle, in tempo reale. Chi ha svolto il lavoro
risponde a memoria. Chi ha copiato una cronologia non ha nulla da
ricordare. Se non avresti potuto svolgere il lavoro, non puoi difenderlo: e
una rivendicazione non difesa resta visibilmente ferma al livello più
debole, etichettata esattamente per quello che è.

### Non posso semplicemente importare un mucchio di librerie per gonfiare il mio elenco di competenze?
No: una semplice importazione da sola raramente etichetta una competenza. La
maggior parte delle signature richiede o uno specificatore di importazione
distintivo e non ambiguo (non un nome di pacchetto generico condiviso tra
più ecosistemi) o una forma effettiva di chiamata API tratta dai tuoi stessi
diff (`stripe.checkout`, non semplicemente `import Stripe`). Vedi
[../signatures.md](../signatures.md) per le regole di rilevamento esatte e
la disciplina che le sostiene. Ma la risposta onesta va oltre l'accuratezza
del rilevamento: questa CLI produce sempre e solo il livello **Attested**,
il più debole su Redential, esplicitamente etichettato come metadati non
verificati. Gonfiare il tuo elenco di competenze ti procura un elenco
leggermente più lungo sul livello più debole; non fa nulla per Proven o
Verified, che richiedono codice live o una sessione difesa. Manipolare i
metadati per apparire impressionanti su un livello già etichettato come "da
prendere con le pinze" non è un gran premio.

### Non posso semplicemente riprodurre la cronologia git di qualcun altro in un nuovo repository e rivendicarla?
Potresti falsificare i timestamp dei commit in un repository nuovo di
zecca: è esattamente per questo che i dati locali sono esplicitamente il
livello *più debole*, non il più forte. Una cronologia riprodotta deve
comunque superare diversi ancoraggi parziali: i commit firmati (una firma
GPG/SSH non può essere falsificata retroattivamente senza la chiave),
un'impronta comportamentale (la cadenza oraria/per giorno della settimana
viene confrontata con la tua attività pubblica verificata come controllo di
coerenza leggero), un segnale di forensics sulla riscrittura
(`integrity.date_forensics`: la data dell'autore in git è facile da
falsificare, ma uno script che riproduce anni di cronologia fabbricata in
un'unica sessione lascia anche la data del *committer* di ogni commit
raggruppata in quella stessa sessione; un segnale euristico lato server, non
un verdetto locale, vedi
[../schema.md#date_forensics-measurement-contract](../schema.md#date_forensics-measurement-contract)),
e, soprattutto, il bundle ottiene comunque e soltanto **Attested**, solo
metadati. Qualsiasi cosa al di sopra richiede una difesa NDA-safe: una
breve sessione registrata in cui rispondi dal vivo a domande generate a
partire dal tuo stesso bundle. Falsificare una cronologia git è economico;
difendere un'esperienza fabbricata sotto interrogatorio, in tempo reale,
non lo è. Questo è il vero confine di sicurezza, non le euristiche di
rilevamento.

### Cosa lascia esattamente la mia macchina?
Il bundle: byte per byte il JSON che `redential scan --json` stampa e che
`submit` mostra sempre per intero prima di chiederti conferma, senza nulla
aggiunto o arricchito in seguito. Non è una promessa che devi prendere per
fede:
[`../../test/privacy/submit-guardrail.test.ts`](../../test/privacy/submit-guardrail.test.ts)
verifica che la stringa letterale inviata via HTTP da `submit` sia `===`
alla stringa che ha stampato prima della tua conferma, non una
ri-serializzazione di un oggetto analizzato. Ogni campo è documentato in
[../schema.md](../schema.md), e lo schema stesso (`schema/bundle.v1.json`)
imposta `additionalProperties: false` ovunque: un campo non elencato rende
il bundle non valido per costruzione, non solo per convenzione.

### Perché dovrei fidarmi di una CLI con il codice del mio datore di lavoro?
Perché non tocca mai il codice del tuo datore di lavoro in alcuna forma che
lasci il tuo laptop. È solo locale (`scan` è strutturalmente privo di rete,
non semplicemente privo di rete per impostazione predefinita), completamente
open source sotto licenza Apache-2.0, così puoi leggere ogni riga prima di
eseguirlo, e le sue affermazioni sulla privacy sono [test
eseguibili](../../test/privacy/) che esegui tu stesso (`npm test`) invece di
una pagina di prosa. Non c'è telemetria, non ci sono analytics, nessun
processo in background: le uniche due chiamate di rete che questa CLI
effettua mai sono il device flow di `login` e il caricamento di `submit`,
entrambe richiedono un'azione esplicita da parte tua. E ogni release
pubblicata porta un'attestazione di provenance firmata con Sigstore che puoi
verificare (`npm audit signatures`), a dimostrazione che è stata compilata a
partire da questo identico repository, non dal laptop di qualcuno.

### Cosa dimostra realmente "Attested"?
Onestamente, non moltissimo da solo, ed è voluto, non una svista.
"Attested" significa: la cronologia git locale di questa persona mostra
questo schema di attività, autodichiarato e falsificabile, con ancoraggi
parziali (commit firmati, impronta comportamentale, controlli di coerenza
lato server) ma nessuna verifica indipendente del codice sottostante. Non
viene mai etichettato o mescolato visivamente con Proven o Verified, che
richiedono di collegare un repository leggibile (tramite la GitHub App) o
di difendere l'affermazione dal vivo. Pensa ad Attested come a "merita una
domanda di approfondimento", non come a "verificato": l'intero design della
CLI esiste per mantenere onesta questa distinzione, invece di lasciare che
un bundle di metadati prenda in prestito una credibilità che non si è
guadagnato. Vedi [../principles.md](../principles.md) (principio 6, "Honest
about trust") per il ragionamento completo.

### È solo un funnel per il vostro SaaS?
La risposta onesta: la CLI è lo strato di acquisizione open source per
[Redential](https://redential.com), e Redential è un prodotto commerciale.
Nessuno di questi due fatti è nascosto: li stai leggendo proprio ora.

Ciò che la rende uno strumento e non un funnel: `scan` è pienamente utile
da sola. Nessun account, nessun login, nessuna rete: analizza il tuo
repository e ti mostra tutto quello che ha trovato, in locale, per sempre,
gratis. La piattaforma entra in gioco solo se decidi che il risultato vale
la pena di essere pubblicato, e non viene caricato nulla finché non hai
visto il payload esatto e confermato la richiesta. Non esiste una modalità
limitata, nessuno "sblocca i risultati completi": l'analisi locale È
l'analisi completa.

Il modello di business è la piattaforma di credenziali. Il compito della
CLI è essere abbastanza affidabile da farti prendere in considerazione il
suo utilizzo: motivo per cui ogni affermazione sulla privacy in questo
README corrisponde a un test eseguibile invece che a una promessa.

