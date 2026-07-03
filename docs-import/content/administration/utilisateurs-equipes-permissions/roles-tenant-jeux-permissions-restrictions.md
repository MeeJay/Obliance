Au-delÃ  des Ã©quipes, Obliance propose deux rÃ©glages transverses par tenant â€” les jeux de permissions et les restrictions â€” ainsi qu'un rÃ´le simplifiÃ© par tenant.

## RÃ´le par tenant (Member / Admin)

Depuis le panneau **Manage tenant access** d'un utilisateur (voir page Â« Vue d'ensemble Â»), chaque accÃ¨s Ã  un tenant porte un rÃ´le :

- **Member** : l'utilisateur est soumis aux vÃ©rifications normales de capacitÃ©s et aux permissions de ses Ã©quipes.
- **Admin** : l'utilisateur passe outre les vÃ©rifications de capacitÃ©s tenant-wide pour ce tenant prÃ©cis.

Ce rÃ´le **Admin de tenant** reste distinct du rÃ´le administrateur global de la plateforme : il ne donne ni accÃ¨s au menu Utilisateurs, ni possibilitÃ© de gÃ©rer les Ã©quipes (ces fonctions restent rÃ©servÃ©es au rÃ´le administrateur global, vÃ©rifiÃ© indÃ©pendamment du tenant).

> Point de vigilance : dans le panneau d'accÃ¨s au tenant, seul le choix Member/Admin est proposÃ© â€” il n'y a pas de sÃ©lection d'un jeu de permissions personnalisÃ© Ã  cet endroit ; les jeux de permissions se gÃ¨rent sÃ©parÃ©ment dans l'onglet dÃ©diÃ© dÃ©crit ci-dessous.

## Onglet Permissions : les jeux de permissions

L'onglet **Permissions** de la page Utilisateurs (composant sÃ©parÃ© de l'arbre des Ã©quipes) gÃ¨re des **jeux de permissions** (Permission Sets) : une matrice qui croise des capacitÃ©s avec des jeux nommÃ©s, valable pour l'ensemble d'un tenant.

Trois jeux existent par dÃ©faut et ne peuvent pas Ãªtre supprimÃ©s :

| Jeu | Usage typique |
|---|---|
| **Admin** | AccÃ¨s complet aux fonctions transverses du tenant |
| **User** | AccÃ¨s standard |
| **Viewer** | Consultation seule |

Un administrateur peut crÃ©er des jeux personnalisÃ©s, les renommer, et cocher/dÃ©cocher des capacitÃ©s directement dans la matrice â€” chaque case bascule immÃ©diatement, sans bouton Â« Enregistrer Â» global.

### CapacitÃ©s rÃ©ellement actives vs. capacitÃ©s d'affichage

Toutes les cases de cette matrice ne pilotent pas un comportement rÃ©el cÃ´tÃ© serveur. Sont effectivement branchÃ©es et bloquantes :

- **users.manage** (gÃ¨re l'accÃ¨s Ã  la gestion des utilisateurs du tenant),
- **supervision:read** (accÃ¨s aux sessions distantes / historique / rapports),
- les capacitÃ©s **agent_config:\*** (dÃ©blocage de pages entiÃ¨res : sections personnalisÃ©es, dÃ©couverte rÃ©seau, clÃ©s API, approbation d'agents),
- **cve:read**.

Les autres entrÃ©es de la matrice (monitoring, devices.manage, etc.) sont pour l'instant purement indicatives dans l'interface et ne bloquent ni ne dÃ©bloquent de fonctionnalitÃ© cÃ´tÃ© serveur. Il est donc recommandÃ© de ne pas se fier Ã  ces cases pour restreindre un accÃ¨s sensible : utiliser plutÃ´t les Ã©quipes (pour les appareils) ou les restrictions (pour les actions ponctuelles) dÃ©crites ci-dessous.

## Onglet Restrictions

L'onglet **Restrictions** liste des actions sensibles de la plateforme et permet de leur appliquer un niveau de contrÃ´le supplÃ©mentaire, indÃ©pendamment des Ã©quipes et des jeux de permissions. Cet onglet est rÃ©servÃ© strictement aux administrateurs globaux de la plateforme.

Pour chaque action, trois niveaux sont disponibles :

| Niveau | Effet |
|---|---|
| **None** | Aucun contrÃ´le supplÃ©mentaire |
| **Sensitive** | L'utilisateur qui dÃ©clenche l'action doit fournir un code de revÃ©rification au moment de l'exÃ©cution |
| **Restricted** | L'action nÃ©cessite l'approbation d'un second administrateur, via SÃ©curitÃ© > Approvals |

Chaque action peut en outre recevoir une **portÃ©e** (bouton Â« Scope: All / Include / Exclude Â») pour limiter le contrÃ´le Ã  certains appareils ou groupes seulement, plutÃ´t qu'Ã  l'ensemble du tenant.

La gestion des Ã©quipes elle-mÃªme (crÃ©ation, modification) peut Ãªtre placÃ©e sous ce rÃ©gime : si elle est configurÃ©e en Sensible ou Restreint, chaque crÃ©ation ou modification d'Ã©quipe dÃ©clenchera la revÃ©rification correspondante avant d'Ãªtre appliquÃ©e.

### Installation fraÃ®che

Sur une installation rÃ©cente, il est possible que le premier chargement de l'onglet Restrictions Ã©choue si la mise Ã  jour de base de donnÃ©es correspondante n'a pas encore Ã©tÃ© appliquÃ©e. Un message d'erreur explicite s'affiche dans ce cas dans l'interface ; il suffit gÃ©nÃ©ralement d'attendre la fin de la mise Ã  jour du serveur puis de recharger la page.

## RÃ©capitulatif : quel outil pour quel besoin

| Besoin | Outil Ã  utiliser |
|---|---|
| Donner accÃ¨s Ã  des appareils/groupes prÃ©cis Ã  un utilisateur | Ã‰quipes â†’ arbre de permissions (RO/RW + capacitÃ©s) |
| Donner un accÃ¨s complet Ã  un tenant sans passer par les Ã©quipes | RÃ´le **Admin** dans Manage tenant access |
| DÃ©bloquer une page transverse (sessions distantes, dÃ©couverte rÃ©seau, clÃ©s API, approbation d'agents) | Jeu de permissions (capacitÃ©s agent_config:*, supervision:read) |
| Imposer une revÃ©rification ou une double validation sur une action sensible | Restrictions (Sensitive / Restricted + portÃ©e) |
| Autoriser la crÃ©ation de nouveaux groupes d'appareils | Indicateur Â« Peut crÃ©er Â» de l'Ã©quipe |

> Build Ã  lancer : aucun (page de documentation)