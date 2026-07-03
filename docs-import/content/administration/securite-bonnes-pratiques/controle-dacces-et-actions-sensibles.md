# ContrÃ´le d'accÃ¨s, permissions et actions sensibles

Au-delÃ  de l'authentification, Obliance encadre prÃ©cisÃ©ment ce que chaque utilisateur peut voir et faire, et ajoute des garde-fous supplÃ©mentaires sur les opÃ©rations les plus sensibles.

## RÃ´les et Ã©quipes

Obliance distingue deux rÃ´les : **admin** et **user**.

- Un compte **admin** contourne toutes les vÃ©rifications de pÃ©rimÃ¨tre par Ã©quipe : il voit et administre l'ensemble des appareils, groupes et paramÃ¨tres de son tenant.
- Un compte **user** n'obtient d'accÃ¨s qu'au travers des **Ã©quipes** (Teams) auxquelles il est rattachÃ©. Chaque Ã©quipe reÃ§oit un droit de lecture seule ou de lecture-Ã©criture sur des groupes d'appareils ou des appareils individuels prÃ©cis.
- Un utilisateur non-admin qui n'appartient Ã  aucune Ã©quipe ne voit et ne peut faire strictement rien dans l'application. Le rattachement Ã  au moins une Ã©quipe avec le bon pÃ©rimÃ¨tre est donc indispensable pour tout utilisateur standard.

Ces droits se configurent depuis **Admin > Utilisateurs**, onglets **Utilisateurs** et **Ã‰quipes**.

Un compte peut Ãªtre **dÃ©sactivÃ©** (plutÃ´t que supprimÃ©) sans perdre son historique dans le journal d'audit â€” pratique pour couper l'accÃ¨s d'un utilisateur qui quitte l'organisation tout en conservant la traÃ§abilitÃ© de ses actions passÃ©es.

## Matrice de restrictions par action

L'onglet **Restrictions** (dans **Admin > Utilisateurs**) ajoute un niveau de contrÃ´le supplÃ©mentaire sur des dizaines d'opÃ©rations sensibles, indÃ©pendamment des permissions d'Ã©quipe classiques. Sont notamment couvertes : redÃ©marrage/extinction d'un appareil, dÃ©sinstallation de l'agent, activation/dÃ©sactivation du mode airgap ou du mode confidentialitÃ©, suppression d'appareil, exÃ©cution manuelle de script, actions dans l'explorateur de fichiers distant, sessions de prise en main Ã  distance, contrÃ´le des services/processus, opÃ©rations Hyper-V et Veeam, ainsi que des changements de configuration du tenant (gestion des utilisateurs/Ã©quipes/permissions, purge du journal d'audit).

Chaque action peut recevoir indÃ©pendamment l'un des trois niveaux suivants :

| Niveau | Effet |
|---|---|
| **None** | Aucun contrÃ´le supplÃ©mentaire â€” l'action s'exÃ©cute normalement selon les permissions d'Ã©quipe. |
| **Sensitive** | L'administrateur qui dÃ©clenche l'action doit ressaisir un code TOTP valide au moment de l'exÃ©cution. Un utilisateur sans TOTP configurÃ© ne peut pas dÃ©clencher une action classÃ©e Sensitive. |
| **Restricted** | Le niveau le plus strict : l'action ne s'exÃ©cute pas immÃ©diatement, elle doit Ãªtre approuvÃ©e par un **second** administrateur, diffÃ©rent de celui qui l'a demandÃ©e. |

Une restriction peut s'appliquer Ã  l'ensemble du tenant, ou Ãªtre limitÃ©e Ã  des appareils/groupes prÃ©cis plutÃ´t que globalement.

## Demandes d'approbation

Les actions classÃ©es **Restricted** gÃ©nÃ¨rent une demande d'approbation, visible par les administrateurs sur la page **Security** (accessible aux administrateurs Ã  l'adresse `/admin/security`), onglet **Approvals**. Chaque demande affiche un compte Ã  rebours jusqu'Ã  son expiration et suit l'un des statuts suivants :

`pending` â†’ `approved` â†’ `executed`, ou bien `denied` / `expired` / `cancelled`.

Par principe de sÃ©paration des tÃ¢ches, l'administrateur qui a initiÃ© une demande ne peut ni l'approuver ni la refuser lui-mÃªme â€” il peut uniquement l'annuler. L'approbation doit venir d'un autre administrateur.