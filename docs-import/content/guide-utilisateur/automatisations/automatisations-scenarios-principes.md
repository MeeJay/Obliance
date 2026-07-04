# Scénarios : principes et déclencheurs

Les scénarios permettent d'automatiser des enchaînements d'actions sur vos appareils, déclenchés automatiquement par un événement ou lancés manuellement.

## Où trouver les scénarios

Les scénarios se trouvent dans le menu **Automations**, dans l'onglet **Scenarios** (les autres onglets de cette même page sont Schedules, Scripts, Run et History). C'est le point d'entrée à utiliser au quotidien pour créer, modifier et suivre vos scénarios.

## Le principe : vérifier puis corriger

Un scénario sert typiquement à modéliser une logique "vérifier, et si besoin corriger" sur un appareil :

1. Un premier script **vérifie** un état (par exemple : un service est-il démarré ? une valeur de registre est-elle correcte ?).
2. Si la vérification échoue, un second script **corrige** le problème.
3. On peut ensuite ré-enchaîner d'autres étapes, notifier une équipe, déplacer l'appareil dans un autre groupe, etc.

Cette logique de vérification/correction est le modèle mental à garder en tête pour construire vos scénarios avec les blocs de l'éditeur de graphe : un script de vérification, suivi d'un branchement selon le résultat, puis si besoin un script de correction.

## Statuts d'un scénario

Chaque scénario affiche un badge de statut sur sa carte :

| Statut | Signification |
|---|---|
| **Draft** | Scénario en cours de conception, non actif |
| **Active** | Scénario opérationnel, réagit à ses déclencheurs |
| **Disabled** | Scénario désactivé, ne se déclenche plus |

Un bouton bascule directement le statut actif/inactif depuis la liste des scénarios, sans avoir à ouvrir le scénario.

## Les déclencheurs (triggers)

Un scénario démarre lorsqu'un déclencheur se produit. Onze types de déclencheurs sont disponibles :

| Déclencheur | Se produit quand... |
|---|---|
| **Manual** | Un administrateur lance le scénario à la main |
| **Session Login** | Une nouvelle session utilisateur s'ouvre sur l'appareil |
| **Machine Boot** | L'agent démarre après un redémarrage de la machine |
| **Agent Approved** | Un agent vient d'être approuvé pour la première fois |
| **Group Join** | Un appareil est déplacé dans un groupe |
| **Schedule Failure** | Une tâche planifiée (schedule) avec vérification échoue |
| **Cron Schedule** | Une expression cron programmée se déclenche |
| **Agent Back Online** | Un agent revient en ligne après une coupure prolongée |
| **Metric Warning** | Une métrique (CPU/RAM/Disque) franchit le seuil d'alerte |
| **Metric Critical** | Une métrique franchit le seuil critique |
| **Metric Custom** | Une métrique dépasse (ou passe sous) un seuil personnalisé, à chaque remontée de données |

Ces déclencheurs sont posés comme premiers blocs ("nœuds") du graphe du scénario — voir la page consacrée à l'éditeur de graphe pour le détail de leur configuration.

## Les cibles (appareils concernés)

Un scénario s'applique à un ensemble d'appareils, choisi parmi :

| Cible | Description |
|---|---|
| **Originating device** | Uniquement l'appareil qui a déclenché l'événement — disponible seulement pour les déclencheurs événementiels (Session Login, Machine Boot, Agent Approved, Group Join) |
| **All devices** | Tous les appareils |
| **By group** | Un groupe précis, sous-groupes inclus |
| **By device** | Une sélection d'appareils spécifiques |

## Notifications

Les notifications envoyées pendant un scénario (par exemple à l'équipe support) ne se configurent pas dans le formulaire général du scénario : elles se paramètrent directement dans l'éditeur de graphe, via un nœud dédié **Send notification**.