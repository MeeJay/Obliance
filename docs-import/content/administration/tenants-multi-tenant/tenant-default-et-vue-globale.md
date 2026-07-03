Dans Obliance, chaque tenant est en principe une bulle Ã©tanche, mais le tenant **Default** dispose d'un statut particulier qui lui donne une vue et un contrÃ´le sur l'ensemble de l'installation.

## Le principe d'isolation multi-tenant

Par dÃ©faut, un tenant ne voit et ne peut agir que sur ses propres donnÃ©es : appareils, groupes, scripts, scÃ©narios, automatisations planifiÃ©es, politiques de conformitÃ©, sections personnalisÃ©es, Ã©quipes, utilisateurs, journal d'audit, canaux de notification, clÃ©s API et tableaux de bord. Aucun tenant ne voit spontanÃ©ment les donnÃ©es d'un autre tenant, sauf dans deux cas prÃ©cis : vous Ãªtes connectÃ© sur le tenant Default, ou une entitÃ© vous a Ã©tÃ© explicitement partagÃ©e en lecture seule (voir la page dÃ©diÃ©e Ã  la diffusion entre tenants).

## Le tenant Default : la vue globale

Le tenant nommÃ© **Default** est toujours le tout premier tenant crÃ©Ã© lors de l'installation d'Obliance. Ce statut particulier lui reste attachÃ© de faÃ§on permanente, quel que soit ce que vous en faites ensuite :

- Un administrateur connectÃ© sur Default voit et peut gÃ©rer **l'ensemble des entitÃ©s de tous les tenants** de l'installation : appareils, groupes, scripts, scÃ©narios, automatisations, politiques de conformitÃ©, sections personnalisÃ©es, Ã©quipes, utilisateurs, journal d'audit, canaux de notification, clÃ©s API et tableaux de bord â€” les siens comme ceux de n'importe quel autre tenant.
- Ce statut de "vue globale" (god view) est rattachÃ© Ã  sa position de premier tenant crÃ©Ã©, pas Ã  son nom affichÃ©. Renommer ce tenant ou modifier son identifiant technique (slug) ne lui retire pas ce statut.
- Le tenant Default **ne peut pas Ãªtre supprimÃ©**. Dans la page de gestion des tenants, le bouton de suppression n'apparaÃ®t tout simplement pas Ã  cÃ´tÃ© de lui, et il porte un badge visuel dÃ©diÃ© Ã  cÃ´tÃ© de son nom pour le distinguer des autres tenants dans les listes.

En pratique, rÃ©servez le tenant Default Ã  votre Ã©quipe interne ou Ã  un rÃ´le de supervision globale : toute personne qui y a accÃ¨s en tant qu'administrateur voit tout le parc, tous clients/sites confondus.

## RÃ´le plateforme et rÃ´le tenant : deux notions distinctes

Obliance distingue deux niveaux de rÃ´le qu'il ne faut pas confondre :

| Niveau | PortÃ©e | Qui peut faire quoi |
|---|---|---|
| RÃ´le plateforme (administrateur global) | Toute l'installation | Seul un administrateur plateforme peut crÃ©er, modifier ou supprimer un tenant, et gÃ©rer la liste de ses membres |
| RÃ´le tenant ("admin" ou "membre") | Un seul tenant | Un utilisateur peut Ãªtre "admin" sur un tenant prÃ©cis sans pour autant Ãªtre administrateur plateforme |

Un utilisateur peut donc Ãªtre administrateur d'un tenant B sans avoir aucun droit sur le tenant A, mÃªme si les deux tenants existent sur la mÃªme installation. Seuls les administrateurs plateforme peuvent basculer librement vers n'importe quel tenant ; les autres utilisateurs ne peuvent basculer que vers un tenant dont ils sont membres.

## Basculer entre tenants

Lorsqu'un utilisateur a accÃ¨s Ã  plusieurs tenants, un sÃ©lecteur **Tenant** apparaÃ®t dans la barre du haut de l'interface. Ce sÃ©lecteur :

- reste masquÃ© si l'utilisateur n'a accÃ¨s qu'Ã  un seul tenant (rien Ã  choisir) ;
- n'apparaÃ®t pas dans l'application de bureau native, qui gÃ¨re le multi-tenant via des onglets dÃ©diÃ©s Ã  la place ;
- recharge automatiquement la liste des appareils et l'arborescence des groupes, et reconnecte le canal temps rÃ©el sur le tenant nouvellement sÃ©lectionnÃ© â€” pas besoin de rafraÃ®chir la page.

## Affichage groupÃ© par tenant dans le menu latÃ©ral

Quand vous Ãªtes connectÃ© sur Default et que la vue globale est active, l'arborescence des appareils et des groupes dans le menu latÃ©ral n'affiche plus une liste plate : elle est **regroupÃ©e par tenant**, chaque groupe de tenant Ã©tant prÃ©cÃ©dÃ© d'un en-tÃªte cliquable (icÃ´ne de bÃ¢timent, nom en majuscules).

- Le tenant Default apparaÃ®t toujours en premier, suivi des autres tenants classÃ©s par ordre alphabÃ©tique.
- Chaque bloc "tenant" est indÃ©pendamment repliable/dÃ©pliable, ce qui permet de masquer les tenants qui ne vous intÃ©ressent pas dans l'instant.
- Pendant une recherche dans le menu latÃ©ral, les blocs repliÃ©s se dÃ©plient automatiquement et temporairement pour ne pas masquer un rÃ©sultat correspondant Ã  votre recherche.