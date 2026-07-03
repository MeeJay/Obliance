La crÃ©ation, la modification et la suppression des tenants, ainsi que la gestion de leurs membres, se font depuis une page dÃ©diÃ©e rÃ©servÃ©e aux administrateurs plateforme.

## AccÃ©der Ã  la gestion des tenants

La page se trouve dans le menu Admin, sous **Tenants** (URL `/admin/tenants`). Elle n'est visible et accessible qu'aux comptes ayant le rÃ´le plateforme administrateur â€” un simple administrateur d'un tenant (rÃ´le tenant "admin") n'y a pas accÃ¨s, mÃªme sur son propre tenant.

## CrÃ©er un tenant

1. Ouvrez la page Tenants et cliquez sur le bouton de crÃ©ation d'un tenant.
2. Saisissez le nom du tenant (raison sociale, nom de site ou de client selon votre usage).
3. L'identifiant technique (slug) est gÃ©nÃ©rÃ© automatiquement Ã  partir du nom saisi.
4. Validez pour crÃ©er le tenant.

Le nouveau tenant dÃ©marre vide : aucun appareil, groupe, script, scÃ©nario, automatisation ou politique de conformitÃ© n'est prÃ©sent tant que vous ne les crÃ©ez pas ou ne les diffusez pas depuis Default (voir la page sur le partage entre tenants).

## Modifier un tenant

Le nom et le slug d'un tenant restent modifiables Ã  tout moment depuis la mÃªme page. Chaque changement de nom, de slug ou du paramÃ¨tre d'approbation Ã  deux administrateurs (voir plus bas) est journalisÃ© dans le journal d'audit avec le dÃ©tail de la valeur avant et aprÃ¨s modification â€” utile pour retracer qui a renommÃ© ou reconfigurÃ© un tenant et quand.

## Supprimer un tenant

Tout tenant peut Ãªtre supprimÃ©, **Ã  l'exception du tenant Default** dont le bouton de suppression n'est pas affichÃ©.

Points importants Ã  connaÃ®tre avant de supprimer un tenant :

- La suppression est dÃ©finitive et entraÃ®ne la suppression de toutes les entitÃ©s **possÃ©dÃ©es** par ce tenant (appareils, groupes, scripts, scÃ©narios, automatisations, politiques de conformitÃ©, etc.).
- Si des entitÃ©s appartenant Ã  ce tenant avaient Ã©tÃ© diffusÃ©es en lecture seule vers d'autres tenants, ou si ce tenant figurait comme destinataire d'une diffusion depuis Default, Obliance nettoie automatiquement toutes ces rÃ©fÃ©rences avant de supprimer le tenant â€” vous n'avez rien Ã  faire manuellement pour Ã©viter des rÃ©fÃ©rences fantÃ´mes dans les listes de partage des autres tenants.

## GÃ©rer les membres d'un tenant

Depuis la fiche d'un tenant, un panneau de gestion des membres permet de :

- ajouter un utilisateur existant au tenant ;
- retirer un utilisateur du tenant ;
- basculer le rÃ´le d'un membre entre **admin** et **membre** au sein de ce tenant prÃ©cis, via un bouton dÃ©diÃ©.

Ce rÃ´le tenant est indÃ©pendant du rÃ´le plateforme : retirer ou ajouter un utilisateur Ã  un tenant ne change rien Ã  son statut d'administrateur plateforme (ou Ã  son absence de statut plateforme), et inversement.

## Approbation Ã  deux administrateurs (actions destructives)

Chaque tenant dispose d'une case Ã  cocher **"Require 2nd-admin approval for destructive actions"** (exiger l'approbation d'un second administrateur pour les actions destructives). Lorsqu'elle est activÃ©e pour un tenant, certaines actions destructives rÃ©alisÃ©es sur ce tenant nÃ©cessitent la validation d'un second administrateur avant d'Ãªtre appliquÃ©es, plutÃ´t que de s'exÃ©cuter immÃ©diatement.

Cette option est utile pour les tenants sensibles (environnements de production critiques, clients Ã  fort enjeu) oÃ¹ vous voulez Ã©viter qu'une seule personne puisse, seule, effectuer une action irrÃ©versible. Comme pour le nom et le slug, l'activation ou la dÃ©sactivation de cette case est journalisÃ©e dans le journal d'audit.