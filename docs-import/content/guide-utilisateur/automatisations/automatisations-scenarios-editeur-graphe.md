# Construire un scÃ©nario avec l'Ã©diteur de graphe

Chaque scÃ©nario est construit visuellement sous forme de graphe : une suite de blocs (nÅ“uds) reliÃ©s entre eux, qui dÃ©crivent le dÃ©roulement de l'automatisation.

## Ouvrir l'Ã©diteur de graphe

Sur chaque carte de scÃ©nario, cliquez sur l'icÃ´ne **Open graph editor** (ou **Edit graph** si le scÃ©nario a dÃ©jÃ  un graphe) pour ouvrir l'Ã©diteur visuel. C'est ici que se construit et se modifie toute la logique du scÃ©nario, nÅ“ud par nÅ“ud, en les reliant avec des flÃ¨ches (edges).

## Les familles de nÅ“uds

### DÃ©clencheurs

Ce sont les points de dÃ©part du graphe (voir le dÃ©tail des 11 types dans la page "Principes et dÃ©clencheurs") :

- **Manual** â€” dÃ©clenchÃ© par un administrateur
- **Session login**, **Machine boot**, **Agent approved**, **Group join** â€” Ã©vÃ©nements sur l'appareil
- **Schedule failure**, **Schedule (cron)** â€” liÃ©s Ã  la planification
- **Agent back online** â€” retour en ligne aprÃ¨s coupure
- **Metric â†’ warning**, **Metric â†’ critical**, **Metric â†’ custom** â€” seuils de mÃ©triques

### Actions

| NÅ“ud | RÃ´le |
|---|---|
| **Run script** | ExÃ©cute un script sur l'appareil. Champs : Script Ã  exÃ©cuter, Timeout (en secondes), et "Run on" qui dÃ©finit sur quel(s) appareil(s) le lancer â€” par dÃ©faut l'appareil qui a dÃ©clenchÃ© l'Ã©vÃ©nement, avec possibilitÃ© de cibler d'autres appareils du mÃªme environnement (dans ce cas, le code de sortie retenu est le pire rÃ©sultat parmi toutes les cibles) |
| **Run command** | Envoie une commande intÃ©grÃ©e Ã  l'appareil (par exemple redÃ©marrer, Ã©teindre, installer les mises Ã  jour) |
| **Send notification** | Envoie une notification via les canaux dÃ©jÃ  configurÃ©s dans Obliance, avec possibilitÃ© de personnaliser le sujet et le corps du message |
| **Wait** | Met le scÃ©nario en pause pendant un nombre de secondes dÃ©fini |
| **Tag device** | Ajoute ou retire un tag sur l'appareil |
| **Move device to group** | Change le groupe de rattachement de l'appareil |

### Logique

| NÅ“ud | RÃ´le |
|---|---|
| **Branch on exit code** | Oriente la suite du scÃ©nario selon le rÃ©sultat retournÃ© par le nÅ“ud prÃ©cÃ©dent (typiquement : script rÃ©ussi â†’ continuer, script en Ã©chec â†’ corriger) |
| **Branch on device** | Oriente la suite du scÃ©nario selon des critÃ¨res de l'appareil (type d'OS, groupe, tag, statut) |

### Gating

**Cooldown** : ce nÅ“ud ignore l'exÃ©cution si l'appareil est dÃ©jÃ  passÃ© par ce mÃªme nÅ“ud pendant une fenÃªtre de temps rÃ©cente. Cela Ã©vite qu'un mÃªme scÃ©nario se redÃ©clenche en boucle sur un appareil. La durÃ©e se configure librement (secondes, minutes, heures, jours ou mois). Si plusieurs dÃ©clencheurs amÃ¨nent au mÃªme nÅ“ud Cooldown, ils partagent la mÃªme fenÃªtre ; Ã  l'inverse, plusieurs nÅ“uds Cooldown diffÃ©rents dans un mÃªme scÃ©nario ont chacun leur propre minuterie, indÃ©pendante les unes des autres.

### Fin de scÃ©nario

| NÅ“ud | RÃ´le |
|---|---|
| **End â€” success** | Marque l'exÃ©cution comme rÃ©ussie ; un message de fin optionnel peut Ãªtre ajoutÃ© |
| **End â€” failure** | Marque l'exÃ©cution comme Ã©chouÃ©e ; un message est obligatoire pour expliquer la raison de l'Ã©chec |

## Construire un enchaÃ®nement vÃ©rifier/corriger

Pour recrÃ©er la logique "vÃ©rifier puis corriger" avec les nÅ“uds du graphe :

1. Posez un nÅ“ud **Run script** avec un script de vÃ©rification.
2. Reliez-le Ã  un nÅ“ud **Branch on exit code**.
3. Si le rÃ©sultat indique un succÃ¨s, orientez vers l'Ã©tape suivante ou un **End â€” success**.
4. Si le rÃ©sultat indique un Ã©chec, orientez vers un second **Run script** avec un script de correction, puis Ã©ventuellement revenez vÃ©rifier une nouvelle fois avant de conclure par **End â€” success** ou **End â€” failure**.

## Autres rÃ©glages du formulaire de scÃ©nario

En dehors de l'Ã©diteur de graphe, le formulaire du scÃ©nario permet aussi de rÃ©gler :

- Les informations gÃ©nÃ©rales : nom, description, statut, cible
- **Variables** â€” des paires clÃ©/valeur rÃ©utilisables dans les scripts et commandes du graphe
- **Retry Policy** â€” **Max Retries** (0 Ã  10 tentatives) et **Retry Delay (seconds)** (dÃ©lai entre deux tentatives)
- Un dÃ©lai global d'exÃ©cution (timeout du scÃ©nario entier), par dÃ©faut fixÃ© Ã  3600 secondes (1 heure)
- **Bypass privacy mode** â€” dÃ©sactivÃ© par dÃ©faut ; si activÃ©, le scÃ©nario s'exÃ©cute mÃªme sur les appareils passÃ©s en mode confidentialitÃ© (sinon ces appareils sont simplement ignorÃ©s, sans erreur). Selon les rÃ¨gles de sÃ©curitÃ© dÃ©finies pour votre organisation, l'activation de cette option peut nÃ©cessiter une validation par un administrateur avant de pouvoir Ãªtre utilisÃ©e