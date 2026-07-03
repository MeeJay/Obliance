Les Ã©quipes dÃ©finissent, appareil par appareil ou groupe par groupe, ce que peuvent voir et faire les utilisateurs non-administrateurs.

## Principe gÃ©nÃ©ral

Une Ã©quipe est strictement rattachÃ©e Ã  **un seul tenant**. Elle regroupe :

- une liste de **membres** (utilisateurs non-administrateurs uniquement â€” les administrateurs globaux n'apparaissent jamais dans la liste des membres possibles, puisqu'ils passent outre toutes les vÃ©rifications de permission de toute faÃ§on),
- une liste de **permissions** organisÃ©es en arbre (portÃ©e par portÃ©e),
- un indicateur **Peut crÃ©er** (badge Â« Create Â» / Â« CrÃ©er Â») qui autorise les membres de l'Ã©quipe Ã  crÃ©er de nouveaux groupes d'appareils.

Un utilisateur non-administrateur qui n'appartient Ã  **aucune** Ã©quipe ne voit et ne peut agir sur **aucun** appareil.

## CrÃ©er et gÃ©rer une Ã©quipe

1. Dans l'onglet **Ã‰quipes**, cliquer sur **Nouvelle Ã©quipe**.
2. Renseigner nom et description.
3. Depuis le tenant maÃ®tre (le tenant racine Â« Default Â»), le tenant cible de l'Ã©quipe est obligatoire Ã  la crÃ©ation â€” une Ã©quipe crÃ©Ã©e depuis un tenant enfant est automatiquement rattachÃ©e Ã  ce tenant.
4. Si aucune Ã©quipe n'existe encore, la liste affiche Â« Aucune Ã©quipe crÃ©Ã©e Â».

La crÃ©ation ou la modification d'une Ã©quipe peut Ãªtre soumise Ã  la matrice de **Restrictions** (voir page dÃ©diÃ©e) : si l'action Â« gestion des Ã©quipes Â» y est configurÃ©e en mode Sensible ou Restreint, une revÃ©rification ou une double approbation sera exigÃ©e avant que le changement soit enregistrÃ©.

> Point de vigilance : le formulaire de crÃ©ation/Ã©dition d'Ã©quipe actuel ne propose pas de case Ã  cocher visible pour activer Â« Peut crÃ©er Â». Si ce droit doit Ãªtre accordÃ© Ã  une Ã©quipe, une intervention technique est nÃ©cessaire en attendant qu'un contrÃ´le soit ajoutÃ© au formulaire.

### Onglet Membres

Dans le panneau d'une Ã©quipe, l'onglet **Membres** liste tous les utilisateurs non-administrateurs du tenant. Cocher ou dÃ©cocher une case ajoute ou retire immÃ©diatement l'utilisateur de l'Ã©quipe â€” il n'y a pas de bouton Â« Enregistrer Â» sÃ©parÃ© pour cet onglet.

## Onglet Permissions : l'arbre de portÃ©es

L'onglet **Permissions** d'une Ã©quipe affiche un arbre reprenant la hiÃ©rarchie des groupes d'appareils du tenant, plus une ligne spÃ©ciale **Ungrouped (orphan devices)** tout en haut pour les appareils sans groupe.

Pour chaque nÅ“ud de l'arbre (groupe, sous-groupe, appareil individuel, ou la ligne Â« orphelins Â»), on peut poser un niveau de permission :

| Niveau | LibellÃ© UI | Effet |
|---|---|---|
| Aucun | â€” | Le nÅ“ud n'est pas accessible Ã  l'Ã©quipe |
| Lecture seule | **RO** (LEC) | Donne uniquement la capacitÃ© de consulter les mÃ©triques et l'inventaire |
| Lecture/Ã©criture | **RW** (LEC/Ã‰CR) | Donne accÃ¨s en plus aux capacitÃ©s d'action dÃ©taillÃ©es ci-dessous |

Les capacitÃ©s dÃ©taillÃ©es (cases Ã  cocher supplÃ©mentaires) ne sont visibles et modifiables **que** lorsque le niveau RW est sÃ©lectionnÃ© :

| CatÃ©gorie | CapacitÃ©s |
|---|---|
| **Execution** | ExÃ©cuter des scripts, scans, services, installations/dÃ©sinstallations |
| **Access** | Prise en main Ã  distance (Reach/RDP/SSH), parcours et transfert de fichiers |
| **Power** | RedÃ©marrage, arrÃªt, mise en veille, redÃ©marrage de l'agent |

### HÃ©ritage de groupe

Accorder une permission sur un groupe la propage automatiquement Ã  **tous** les sous-groupes et appareils en dessous, sans limite de profondeur. Dans l'arbre, un nÅ“ud dÃ©jÃ  couvert par un ancÃªtre affiche simplement la mention **Â« inherited Â» / Â« hÃ©ritÃ© Â»** (en italique, grisÃ©), sans bouton RO/RW Ã  cliquer : il n'est donc pas possible de poser une permission diffÃ©rente (plus restrictive ou plus large) sur ce nÅ“ud prÃ©cis. Pour changer l'accÃ¨s d'un sous-groupe ou d'un appareil isolÃ©, il faut soit modifier la permission au niveau du groupe parent, soit rÃ©organiser l'arbre de groupes.

### Cas d'un appareil couvert par plusieurs sources

Si une mÃªme Ã©quipe reÃ§oit des permissions concurrentes sur un appareil par plusieurs chemins (permission directe sur l'appareil, permission hÃ©ritÃ©e d'un groupe parent, ou hÃ©ritage via la clÃ© API par dÃ©faut utilisÃ©e pour l'enrÃ´lement), c'est **le niveau le plus Ã©levÃ©** qui s'applique (RW l'emporte sur RO). Il n'y a pas de logique Â« la permission la plus spÃ©cifique gagne Â» : positionner un appareil prÃ©cis en lecture seule ne suffit pas Ã  le restreindre si son groupe parent est en lecture/Ã©criture pour la mÃªme Ã©quipe.

### Ligne Â« Ungrouped (orphan devices) Â»

Cette ligne spÃ©ciale en haut de l'arbre couvre tous les appareils qui n'ont pas encore de groupe assignÃ© (ni directement, ni via le groupe par dÃ©faut de leur clÃ© API d'enrÃ´lement). Elle se configure avec les mÃªmes contrÃ´les RO/RW/capacitÃ©s qu'un groupe normal.

## RÃ©sumÃ© du parcours de rÃ©solution d'accÃ¨s

Pour savoir si un membre d'une Ã©quipe peut voir ou agir sur un appareil donnÃ©, Obliance vÃ©rifie dans l'ordre :

1. une permission posÃ©e directement sur l'appareil,
2. une permission hÃ©ritÃ©e d'un groupe parent (Ã  n'importe quelle profondeur),
3. si l'appareil n'a pas encore de groupe, le groupe par dÃ©faut associÃ© Ã  la clÃ© API utilisÃ©e lors de son enrÃ´lement,
4. la portÃ©e Â« Ungrouped Â» de l'Ã©quipe.

Si plusieurs de ces sources correspondent, le niveau le plus Ã©levÃ© retenu s'applique.

> Build Ã  lancer : aucun (page de documentation)