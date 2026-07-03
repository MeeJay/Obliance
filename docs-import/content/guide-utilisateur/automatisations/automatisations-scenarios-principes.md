# ScÃ©narios : principes et dÃ©clencheurs

Les scÃ©narios permettent d'automatiser des enchaÃ®nements d'actions sur vos appareils, dÃ©clenchÃ©s automatiquement par un Ã©vÃ©nement ou lancÃ©s manuellement.

## OÃ¹ trouver les scÃ©narios

Les scÃ©narios se trouvent dans le menu **Automations**, dans l'onglet **Scenarios** (les autres onglets de cette mÃªme page sont Schedules, Scripts, Run et History). C'est le point d'entrÃ©e Ã  utiliser au quotidien pour crÃ©er, modifier et suivre vos scÃ©narios.

## Le principe : vÃ©rifier puis corriger

Un scÃ©nario sert typiquement Ã  modÃ©liser une logique "vÃ©rifier, et si besoin corriger" sur un appareil :

1. Un premier script **vÃ©rifie** un Ã©tat (par exemple : un service est-il dÃ©marrÃ© ? une valeur de registre est-elle correcte ?).
2. Si la vÃ©rification Ã©choue, un second script **corrige** le problÃ¨me.
3. On peut ensuite rÃ©-enchaÃ®ner d'autres Ã©tapes, notifier une Ã©quipe, dÃ©placer l'appareil dans un autre groupe, etc.

Cette logique de vÃ©rification/correction est le modÃ¨le mental Ã  garder en tÃªte pour construire vos scÃ©narios avec les blocs de l'Ã©diteur de graphe : un script de vÃ©rification, suivi d'un branchement selon le rÃ©sultat, puis si besoin un script de correction.

## Statuts d'un scÃ©nario

Chaque scÃ©nario affiche un badge de statut sur sa carte :

| Statut | Signification |
|---|---|
| **Draft** | ScÃ©nario en cours de conception, non actif |
| **Active** | ScÃ©nario opÃ©rationnel, rÃ©agit Ã  ses dÃ©clencheurs |
| **Disabled** | ScÃ©nario dÃ©sactivÃ©, ne se dÃ©clenche plus |

Un bouton bascule directement le statut actif/inactif depuis la liste des scÃ©narios, sans avoir Ã  ouvrir le scÃ©nario.

## Les dÃ©clencheurs (triggers)

Un scÃ©nario dÃ©marre lorsqu'un dÃ©clencheur se produit. Onze types de dÃ©clencheurs sont disponibles :

| DÃ©clencheur | Se produit quand... |
|---|---|
| **Manual** | Un administrateur lance le scÃ©nario Ã  la main |
| **Session Login** | Une nouvelle session utilisateur s'ouvre sur l'appareil |
| **Machine Boot** | L'agent dÃ©marre aprÃ¨s un redÃ©marrage de la machine |
| **Agent Approved** | Un agent vient d'Ãªtre approuvÃ© pour la premiÃ¨re fois |
| **Group Join** | Un appareil est dÃ©placÃ© dans un groupe |
| **Schedule Failure** | Une tÃ¢che planifiÃ©e (schedule) avec vÃ©rification Ã©choue |
| **Cron Schedule** | Une expression cron programmÃ©e se dÃ©clenche |
| **Agent Back Online** | Un agent revient en ligne aprÃ¨s une coupure prolongÃ©e |
| **Metric Warning** | Une mÃ©trique (CPU/RAM/Disque) franchit le seuil d'alerte |
| **Metric Critical** | Une mÃ©trique franchit le seuil critique |
| **Metric Custom** | Une mÃ©trique dÃ©passe (ou passe sous) un seuil personnalisÃ©, Ã  chaque remontÃ©e de donnÃ©es |

Ces dÃ©clencheurs sont posÃ©s comme premiers blocs ("nÅ“uds") du graphe du scÃ©nario â€” voir la page consacrÃ©e Ã  l'Ã©diteur de graphe pour le dÃ©tail de leur configuration.

## Les cibles (appareils concernÃ©s)

Un scÃ©nario s'applique Ã  un ensemble d'appareils, choisi parmi :

| Cible | Description |
|---|---|
| **Originating device** | Uniquement l'appareil qui a dÃ©clenchÃ© l'Ã©vÃ©nement â€” disponible seulement pour les dÃ©clencheurs Ã©vÃ©nementiels (Session Login, Machine Boot, Agent Approved, Group Join) |
| **All devices** | Tous les appareils |
| **By group** | Un groupe prÃ©cis, sous-groupes inclus |
| **By device** | Une sÃ©lection d'appareils spÃ©cifiques |

## Notifications

Les notifications envoyÃ©es pendant un scÃ©nario (par exemple Ã  l'Ã©quipe support) ne se configurent pas dans le formulaire gÃ©nÃ©ral du scÃ©nario : elles se paramÃ¨trent directement dans l'Ã©diteur de graphe, via un nÅ“ud dÃ©diÃ© **Send notification**.