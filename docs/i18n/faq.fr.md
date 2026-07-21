# Foire aux questions

Chaque réponse renvoie au code et aux tests qui la soutiennent.

La version anglaise ([docs/faq.md](../faq.md)) fait foi ; en cas de différence, la version anglaise prévaut.
### Comment peut-on savoir que j'ai réellement effectué ce travail ?
Le CLI ne prétend pas le savoir : c'est tout l'intérêt du système de
niveaux. Un bundle Attested affirme : *l'historique git de cette machine
montre cette activité, revendiquée par cette identité.* Des ancrages
partiels viennent étayer cette affirmation (vos emails de commit sont
vérifiés par rapport aux emails de votre compte vérifié, les commits
signés ne peuvent pas être falsifiés rétroactivement sans votre clé, et
la cadence de votre activité fait l'objet d'un contrôle de cohérence côté
serveur), mais rien de tout cela ne prouve la paternité du travail, et ce
README ne prétend jamais le contraire.

La vraie réponse se trouve dans ce qui vient après : n'importe qui peut
*revendiquer* un historique, mais sur Redential, une revendication peut
être mise à l'épreuve (une défense en direct, où vous répondez en temps
réel à des questions générées à partir des chiffres de votre propre
bundle). Quelqu'un qui a réellement fait le travail répond de mémoire.
Quelqu'un qui a copié un historique n'a rien à se rappeler. Si vous
n'avez pas pu faire ce travail, vous ne pouvez pas le défendre, et une
revendication non défendue reste visiblement bloquée au niveau le plus
faible, étiquetée exactement pour ce qu'elle est.

### Ne puis-je pas simplement importer un tas de bibliothèques pour gonfler ma liste de compétences ?
Non : un simple import, à lui seul, ne suffit presque jamais à taguer une
compétence. La plupart des signatures exigent soit un identifiant
d'import distinctif et non ambigu (pas un nom de paquet générique
partagé entre plusieurs écosystèmes), soit une forme d'appel d'API
réelle issue de vos propres diffs (`stripe.checkout`, pas juste `import
Stripe`). Voir [docs/signatures.md](../signatures.md) pour les règles de
détection exactes et la rigueur qui les sous-tend. Mais la réponse
honnête va au-delà de la précision de la détection : ce CLI ne produit
jamais que le niveau **Attested**, le plus faible sur Redential,
explicitement étiqueté comme métadonnées non vérifiées. Gonfler votre
liste de compétences vous donne une liste un peu plus longue sur le
niveau le plus faible ; cela n'apporte rien pour Proven ou Verified, qui
exigent du code en direct ou une session défendue. Truquer des
métadonnées pour paraître impressionnant sur un niveau déjà étiqueté
« à prendre avec des pincettes » n'est pas vraiment une récompense.

### Ne puis-je pas rejouer l'historique git de quelqu'un d'autre dans un nouveau dépôt et le revendiquer ?
Vous pourriez fabriquer de faux horodatages de commit dans un nouveau
dépôt : c'est exactement pour cela que les données locales constituent
explicitement le niveau *le plus faible*, pas le plus fort. Un historique
rejoué doit malgré tout survivre à plusieurs ancrages partiels : les
commits signés (une signature GPG/SSH ne peut pas être falsifiée
rétroactivement sans la clé), une empreinte comportementale (la cadence
par heure/jour de la semaine est comparée à votre propre activité
publique vérifiée, comme contrôle de cohérence indicatif), un signal de
détection de réécriture (`integrity.date_forensics` : la date d'auteur
de git est facile à falsifier, mais un script qui rejoue des années
d'historique fabriqué en une seule séance laisse aussi la date de
*committer* de chaque commit regroupée dans cette même séance ; un
signal heuristique côté serveur, pas un verdict local, voir
[docs/schema.md](../schema.md#date_forensics-measurement-contract)), et,
surtout, le bundle ne peut jamais obtenir plus que **Attested**, de
simples métadonnées. Tout ce qui va au-delà exige une défense NDA-safe :
une courte session enregistrée où vous répondez en direct à des
questions générées à partir de votre propre bundle. Falsifier un
historique git ne coûte rien ; défendre une expérience fabriquée sous
interrogation, en temps réel, c'est une autre affaire. Cet écart
constitue la véritable frontière de sécurité, pas les heuristiques de
détection.

### Qu'est-ce qui quitte exactement ma machine ?
Le bundle : octet pour octet le JSON que `redential scan --json` affiche
et que `submit` montre toujours dans son intégralité avant de vous
demander confirmation, sans rien ajouter ni enrichir après coup. Ce
n'est pas une promesse à prendre pour argent comptant :
[`test/privacy/submit-guardrail.test.ts`](../../test/privacy/submit-guardrail.test.ts)
vérifie que la chaîne littérale envoyée en HTTP par `submit` est `===` à
la chaîne affichée avant votre confirmation, et non une re-sérialisation
d'un objet analysé. Chaque champ est documenté dans
[docs/schema.md](../schema.md), et le schéma lui-même
(`schema/bundle.v1.json`) fixe `additionalProperties: false` partout :
un champ non répertorié rend le bundle invalide par construction, pas
seulement par convention.

### Pourquoi devrais-je faire confiance à un CLI avec le code de mon employeur ?
Parce qu'il ne touche jamais au code de votre employeur sous une forme
quelconque qui quitterait votre ordinateur portable. Il est strictement
local (`scan` est structurellement dépourvu de réseau, pas seulement par
défaut), entièrement open source sous licence Apache-2.0, ce qui vous
permet de lire chaque ligne avant de l'exécuter, et ses garanties de
confidentialité sont des [tests exécutables](../../test/privacy/) que
vous lancez vous-même (`npm test`) plutôt qu'une page de texte. Il n'y a
ni télémétrie, ni analytique, ni processus en arrière-plan : les deux
seuls appels réseau que ce CLI effectue jamais sont le device flow de
`login` et l'envoi de `submit`, tous deux nécessitant une action
explicite de votre part. Et chaque release publiée porte une attestation
de provenance signée par Sigstore, que vous pouvez vérifier (`npm audit
signatures`), prouvant qu'elle a été construite à partir de ce dépôt
exact, et non depuis l'ordinateur de quelqu'un.

### Que prouve réellement Attested?
Honnêtement, pas grand-chose à lui seul, et c'est voulu, pas un oubli.
« Attested » signifie : l'historique git local de cette personne montre
ce schéma d'activité, auto-déclaré et falsifiable, avec des ancrages
partiels (commits signés, empreinte comportementale, contrôles de
cohérence côté serveur), mais sans vérification indépendante du code
sous-jacent. Ce niveau n'est jamais étiqueté ni mélangé visuellement
avec Proven ou Verified, qui exigent soit de connecter un dépôt lisible
(via la GitHub App), soit de défendre la revendication en direct. Pensez
à Attested comme « mérite une question de suivi », pas comme
« vérifié » : toute la conception du CLI vise à préserver honnêtement
cette distinction, au lieu de laisser un bundle de métadonnées emprunter
une crédibilité qu'il n'a pas gagnée. Voir
[docs/principles.md](../principles.md) (principe 6, « Honest about
trust ») pour le raisonnement complet.

### Est-ce simplement un entonnoir vers votre SaaS ?
La réponse honnête : le CLI est la couche de capture open source de
[Redential](https://redential.com), et Redential est un produit
commercial. Aucun de ces deux faits n'est caché : vous êtes en train de
les lire à l'instant.

Ce qui en fait un outil plutôt qu'un entonnoir : `scan` est pleinement
utile de manière autonome. Aucun compte, aucun login, aucun réseau : il
analyse votre dépôt et vous montre tout ce qu'il a trouvé, localement,
pour toujours, gratuitement. La plateforme n'entre en jeu que si vous
décidez que le résultat mérite d'être publié, et rien n'est envoyé tant
que vous n'avez pas vu le payload exact et confirmé l'invite. Il n'y a
pas de mode bridé, pas de « débloquer les résultats complets » :
l'analyse locale EST l'analyse complète.

Le modèle économique, c'est la plateforme de certification. Le rôle du
CLI est d'être suffisamment digne de confiance pour que vous envisagiez
de l'utiliser, ce qui explique pourquoi chaque garantie de
confidentialité de ce README correspond à un test exécutable plutôt
qu'à une simple promesse.

