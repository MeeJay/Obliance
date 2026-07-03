Cette page presente la bibliotheque de scripts d'Obliance, l'endroit ou sont ranges et organises tous les scripts utilisables sur vos appareils.

## Ou trouver la bibliotheque

La bibliotheque de scripts se trouve dans le menu **Automations**, sous l'onglet **Scripts**. Cette page fait partie d'un ensemble de cinq onglets consacres aux automatisations :

- **Schedules** â€” planification recurrente de scripts
- **Scenarios** â€” enchainements automatises declenches par des evenements
- **Scripts** â€” la bibliotheque, decrite ici
- **Run** â€” execution manuelle d'un script a la demande
- **History** â€” historique des executions

## A quoi sert un script

Un script est un petit programme (PowerShell, Bash, Python, etc.) que vous pouvez faire executer a distance sur un ou plusieurs de vos appareils : verifier un parametre, corriger une configuration, installer un logiciel, collecter une information, etc.

## Organisation de la liste

La liste des scripts est **regroupee par categorie**, sous forme de tiroirs que vous pouvez replier ou deplier en cliquant dessus. Une fois repliee ou depliee, une categorie garde son etat lors de vos prochaines visites sur la page.

Au-dessus de la liste, deux outils permettent de retrouver rapidement un script :

- Un champ de recherche (**Search...**) pour chercher par nom
- Des filtres **All platforms** et **All purposes**, dans le panneau de gauche, pour restreindre l'affichage a une plateforme ou a un type d'usage precis

## Les informations affichees sur chaque script

Pour chaque script de la liste, vous voyez :

| Information | Description |
|---|---|
| Nom | Le nom du script |
| Badge d'usage | **Unused** (en ambre) si le script n'est utilise dans aucun scenario ni aucune planification ; sinon un compteur du type Â« Nx scenario(s) / Mx schedule(s) Â» |
| Plateforme et langage | La plateforme ciblee et le langage d'execution du script |

En cliquant sur un script pour l'ouvrir, un panneau de detail affiche des informations supplementaires : ses dates de creation et de derniere modification, le badge **Built-in** s'il s'agit d'un script fourni nativement par Obliance, et le badge **Available in Reach** s'il est visible dans le client de bureau Oblireach.

### Scripts lies entre eux (script parent)

Un script peut etre rattache a un **script parent**. Concretement, cela sert a chainer un script de **verification** (Â« Check Â») directement sous le script de **correction** (Â« Resolve Â») qui lui correspond : dans la liste, le script Â« enfant Â» apparait indente sous son parent, ce qui rend la relation visible d'un coup d'oeil.

## Les types de scripts (Purpose)

Chaque script porte une etiquette de type qui indique son role :

| Etiquette UI | Usage |
|---|---|
| Check | Verifie un etat (par exemple : Â« telle mise a jour est-elle installee ? Â») |
| Resolve | Corrige un etat non conforme detecte par un script Check |
| Execute | Execution ponctuelle, sans logique de verification associee |
| Compliance | Utilise dans le cadre d'une politique de conformite |
| Custom Metric | Collecte une valeur personnalisee remontee comme metrique |

## Plateformes et langages pris en charge

Un script cible une plateforme et utilise un langage d'execution precis.

**Plateformes disponibles** : Windows, macOS, Linux, FreeBSD, ou **All** (toutes plateformes).

**Langages (Runtime) disponibles** : PowerShell, PowerShell Core (pwsh), Cmd, Bash, Zsh, Sh, Python, Python3, Perl, Ruby.

## Scripts fournis par Obliance (Built-in)

Certains scripts sont fournis nativement avec Obliance et portent le badge **Built-in**. Ces scripts ne peuvent pas etre supprimes â€” le bouton de suppression n'apparait pas pour eux â€” mais vous pouvez les **cloner** pour creer votre propre version modifiable.

## Multi-etablissements (tenants)

Si votre organisation gere plusieurs etablissements (tenants) dans Obliance, un script appartenant a un autre etablissement peut vous etre partage en **lecture seule** : il s'affiche alors avec un badge **ðŸ”’ Master** et ses boutons Edit et Delete sont desactives, pour vous empecher de le modifier.