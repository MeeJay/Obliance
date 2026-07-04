# Construire un scénario avec l'éditeur de graphe

Chaque scénario est construit visuellement sous forme de graphe : une suite de blocs (nœuds) reliés entre eux, qui décrivent le déroulement de l'automatisation.

## Ouvrir l'éditeur de graphe

Sur chaque carte de scénario, cliquez sur l'icône **Open graph editor** (ou **Edit graph** si le scénario a déjà un graphe) pour ouvrir l'éditeur visuel. C'est ici que se construit et se modifie toute la logique du scénario, nœud par nœud, en les reliant avec des flèches (edges).

## Les familles de nœuds

### Déclencheurs

Ce sont les points de départ du graphe (voir le détail des 11 types dans la page "Principes et déclencheurs") :

- **Manual** — déclenché par un administrateur
- **Session login**, **Machine boot**, **Agent approved**, **Group join** — événements sur l'appareil
- **Schedule failure**, **Schedule (cron)** — liés à la planification
- **Agent back online** — retour en ligne après coupure
- **Metric → warning**, **Metric → critical**, **Metric → custom** — seuils de métriques

### Actions

| Nœud | Rôle |
|---|---|
| **Run script** | Exécute un script sur l'appareil. Champs : Script à exécuter, Timeout (en secondes), et "Run on" qui définit sur quel(s) appareil(s) le lancer — par défaut l'appareil qui a déclenché l'événement, avec possibilité de cibler d'autres appareils du même environnement (dans ce cas, le code de sortie retenu est le pire résultat parmi toutes les cibles) |
| **Run command** | Envoie une commande intégrée à l'appareil (par exemple redémarrer, éteindre, installer les mises à jour) |
| **Send notification** | Envoie une notification via les canaux déjà configurés dans Obliance, avec possibilité de personnaliser le sujet et le corps du message |
| **Wait** | Met le scénario en pause pendant un nombre de secondes défini |
| **Tag device** | Ajoute ou retire un tag sur l'appareil |
| **Move device to group** | Change le groupe de rattachement de l'appareil |

### Logique

| Nœud | Rôle |
|---|---|
| **Branch on exit code** | Oriente la suite du scénario selon le résultat retourné par le nœud précédent (typiquement : script réussi → continuer, script en échec → corriger) |
| **Branch on device** | Oriente la suite du scénario selon des critères de l'appareil (type d'OS, groupe, tag, statut) |

### Gating

**Cooldown** : ce nœud ignore l'exécution si l'appareil est déjà passé par ce même nœud pendant une fenêtre de temps récente. Cela évite qu'un même scénario se redéclenche en boucle sur un appareil. La durée se configure librement (secondes, minutes, heures, jours ou mois). Si plusieurs déclencheurs amènent au même nœud Cooldown, ils partagent la même fenêtre ; à l'inverse, plusieurs nœuds Cooldown différents dans un même scénario ont chacun leur propre minuterie, indépendante les unes des autres.

### Fin de scénario

| Nœud | Rôle |
|---|---|
| **End — success** | Marque l'exécution comme réussie ; un message de fin optionnel peut être ajouté |
| **End — failure** | Marque l'exécution comme échouée ; un message est obligatoire pour expliquer la raison de l'échec |

## Construire un enchaînement vérifier/corriger

Pour recréer la logique "vérifier puis corriger" avec les nœuds du graphe :

1. Posez un nœud **Run script** avec un script de vérification.
2. Reliez-le à un nœud **Branch on exit code**.
3. Si le résultat indique un succès, orientez vers l'étape suivante ou un **End — success**.
4. Si le résultat indique un échec, orientez vers un second **Run script** avec un script de correction, puis éventuellement revenez vérifier une nouvelle fois avant de conclure par **End — success** ou **End — failure**.

## Autres réglages du formulaire de scénario

En dehors de l'éditeur de graphe, le formulaire du scénario permet aussi de régler :

- Les informations générales : nom, description, statut, cible
- **Variables** — des paires clé/valeur réutilisables dans les scripts et commandes du graphe
- **Retry Policy** — **Max Retries** (0 à 10 tentatives) et **Retry Delay (seconds)** (délai entre deux tentatives)
- Un délai global d'exécution (timeout du scénario entier), par défaut fixé à 3600 secondes (1 heure)
- **Bypass privacy mode** — désactivé par défaut ; si activé, le scénario s'exécute même sur les appareils passés en mode confidentialité (sinon ces appareils sont simplement ignorés, sans erreur). Selon les règles de sécurité définies pour votre organisation, l'activation de cette option peut nécessiter une validation par un administrateur avant de pouvoir être utilisée