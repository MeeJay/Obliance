Chaque agent Obliance passe par un cycle d'approbation avant d'etre pleinement operationnel. Ce chapitre decrit les differents statuts et comment les gerer depuis la page **Appareils**.

## Les 4 statuts d'approbation

Un appareil enrole peut se trouver dans l'un des 4 etats suivants :

| Statut affiche | Signification |
|---|---|
| **Approuve** | L'agent est valide et operationnel. Il peut recevoir des commandes, remonter des metriques, etc. |
| **En attente** | L'agent vient de s'enroler et attend une validation par un administrateur. Il n'est pas encore pleinement operationnel. |
| **Refuse** | Un administrateur a explicitement rejete l'agent. L'appareil est place en statut de connexion "suspendu" et n'est plus actif. |
| **Suspendu** | L'appareil a ete mis en pause (via refus ou action manuelle) ; il ne communique plus normalement avec le serveur tant qu'il n'est pas reactive. |

Ces 4 statuts sont utilisables comme filtres directement sur la page **Appareils**, sous forme de chips cliquables (Approuve / En attente / Refuse / Suspendu) au-dessus de la liste des appareils.

> Un utilisateur non-administrateur qui n'a pas les droits de gestion des approbations voit par defaut uniquement les appareils **Approuve** ; les autres filtres restent masques ou inaccessibles pour ce profil.

## Approuver un agent

Depuis le filtre **En attente**, un administrateur habilite peut :

- **Approuver un agent individuellement**, depuis sa fiche.
- **Approuver plusieurs agents en une seule action** via le bouton d'approbation en masse, visible uniquement quand le filtre **En attente** est actif et que l'administrateur a les droits necessaires. Chaque appareil selectionne est traite individuellement en interne (et non en un seul lot SQL), precisement pour que la regle du groupe par defaut de la cle API (voir chapitre precedent) s'applique correctement a chacun d'entre eux.

Lors de l'approbation, plusieurs choses se produisent automatiquement :

- le statut d'approbation passe a **Approuve** ;
- le statut de connexion passe a **hors ligne** (et non "en ligne" immediatement : le serveur attend le premier envoi de metriques de l'agent pour le considerer comme actif) ;
- si l'appareil n'a pas deja de groupe, le groupe par defaut de la cle API d'enrolement lui est assigne (s'il en existe un) ;
- l'identite de l'administrateur et la date d'approbation sont enregistrees sur la fiche de l'appareil.

Il est possible, au moment de l'approbation, d'ajuster en meme temps d'autres parametres de l'appareil (nom, surveillance du heartbeat, groupe, seuils d'alerte), sans avoir a faire une action separee ensuite.

## Refuser un agent

Refuser un agent en attente fait passer son statut d'approbation a **Refuse** et son statut de connexion a **Suspendu** simultanement. L'agent reste visible dans la liste (filtre **Refuse** ou **Suspendu**) mais n'est plus actif.

## Reactiver un appareil suspendu

Un appareil deja passe par le cycle d'approbation puis suspendu peut etre reactive : dans ce cas, le serveur ne recree pas sa surveillance depuis zero, il se contente de repasser le statut d'approbation a **Approuve** et le statut de connexion a **hors ligne**, en attendant le prochain contact de l'agent. C'est different d'une toute premiere approbation (statut initial "En attente"), qui elle initialise la surveillance de l'appareil.

## Auto-approbation a l'enregistrement

Selon un parametre configure au niveau du tenant, un nouvel agent qui s'enregistre peut :

- soit passer directement au statut **Approuve** / hors ligne, sans attente (si l'auto-approbation est active pour ce tenant) ;
- soit rester en statut **En attente**, jusqu'a validation manuelle par un administrateur (comportement par defaut).

> Ce parametre se configure au niveau des reglages du tenant. Si vous devez l'activer ou le desactiver pour votre organisation, rapprochez-vous de votre administrateur Obliance ou de votre equipe support.

## A ne pas confondre : approbation en deux etapes ("two-step approval")

Obliance dispose egalement d'un mecanisme distinct, visible dans la barre laterale sous la section **Security** (avec un badge indiquant le nombre d'approbations en attente). Ce mecanisme concerne la validation d'actions sensibles (commandes en masse, desinstallation, changement de parametre critique) qui necessitent la confirmation d'un **second administrateur**, different de celui qui a initie l'action. Il n'a rien a voir avec l'approbation d'un nouvel agent decrite dans cette page : ne confondez pas les deux workflows lorsque vous formez d'autres administrateurs.