Ce chapitre explique comment deployer l'agent Obliance sur un poste ou un serveur, quelle que soit sa plateforme, depuis l'interface d'administration.

## Ouvrir l'assistant d'ajout

Le deploiement d'un agent se fait via la fenetre **Ajouter un agent**, accessible depuis la barre laterale de l'interface. Cette fenetre propose 4 onglets correspondant chacun a un systeme d'exploitation :

- Windows
- Linux
- macOS
- FreeBSD

Avant de generer une commande d'installation, il faut selectionner une **cle API** dans le menu deroulant en haut de la fenetre. C'est cette cle qui identifie aupres du serveur Obliance le nouvel agent lors de son premier contact, et qui determine eventuellement dans quel groupe il sera range automatiquement (voir le chapitre dedie aux cles API).

## Onglet Windows

L'onglet Windows propose 5 methodes de deploiement, a choisir selon la version du systeme cible et le contexte reseau :

| Methode | Usage recommande |
|---|---|
| **Windows 10+ (64-bit)** | Postes et serveurs recents en 64 bits, connexion Internet disponible. Utilise `Invoke-WebRequest` pour telecharger le paquet MSI puis l'installe. |
| **Windows 7/10 (32-bit)** | Machines en architecture 32 bits, avec un paquet MSI dedie a cette architecture. |
| **Server 2012/2016** | Serveurs plus anciens ou la pile TLS par defaut de PowerShell pose probleme. Le script utilise le transfert `BitsTransfer` et force la compatibilite TLS avant de lancer le MSI. |
| **Server 2008 R2** | Serveurs tres anciens qui ne supportent pas l'agent moderne. Utilise `BitsTransfer` pour recuperer un agent **legacy** (executable, pas de paquet MSI) et l'enregistre comme service Windows via `New-Service`. |
| **Manuel / hors-ligne (wizard)** | Postes sans acces Internet direct ou installation guidee souhaitee. Fournit un executable assistant (wizard) qui embarque deja le paquet MSI, avec la cle API et l'URL du serveur pre-remplies. Aucune connexion Internet n'est necessaire pour l'installation elle-meme. |

Dans chaque cas, l'interface affiche une commande PowerShell (ou un lien de telechargement pour le mode manuel) prete a copier-coller sur la machine cible.

## Onglet Linux

Deux modes de deploiement sont proposes :

- **curl \| bash** : commande a executer en une ligne sur une machine disposant d'un acces Internet ; elle telecharge et installe l'agent automatiquement.
- **Manuel / hors-ligne (wizard)** : binaire assistant statique (agent deja embarque) a telecharger et executer en tant que root. Il configure lui-meme le service (systemd ou SysV selon la distribution).

> Bonne pratique : privilegiez des machines a jour (systeme et magasins de certificats) pour beneficier d'une verification TLS complete lors du deploiement, quelle que soit la methode choisie.

## Onglets macOS et FreeBSD

Ces deux plateformes ne proposent qu'**une seule methode**, sans mode manuel/hors-ligne :

- **macOS** : commande combinant `curl` et `sudo bash`.
- **FreeBSD** : commande combinant `fetch` et `sh`.

## Apres l'installation

Une fois l'agent installe et demarre, il contacte le serveur Obliance avec la cle API fournie. Il apparait alors dans la liste des appareils (page **Appareils**), avec un statut d'approbation qui depend de la configuration du tenant (voir le chapitre sur le cycle d'approbation). Tant qu'il n'est pas approuve, l'agent n'est pas pleinement operationnel.

> Note : la gestion au quotidien des agents (approbation, groupes, filtres) se fait depuis la page **Appareils**. La configuration des cles API, elle, se fait depuis une page d'administration dediee â€” voir les chapitres suivants pour le detail.