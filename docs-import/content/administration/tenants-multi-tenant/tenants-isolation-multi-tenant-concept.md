Ce chapitre explique comment Obliance isole les tenants entre eux et pourquoi un tenant particulier, le tenant **Default**, dispose d'une vue globale sur toute l'installation.

## Qu'est-ce qu'un tenant

Un tenant represente un espace de travail cloisonne : ses propres appareils, groupes, scripts, scenarios, plannings (schedules), politiques de conformite, sections personnalisees, equipes, utilisateurs, journal d'audit, canaux de notification, cles API et tableaux de bord. Sauf partage explicite (voir la page consacree au partage cross-tenant), rien de ce qui appartient a un tenant n'est visible depuis un autre tenant.

## Le tenant Default : le tenant master

A chaque installation d'Obliance, un premier tenant nomme **Default** est cree automatiquement. Ce tenant joue un role special, appele **tenant master** :

- Un administrateur connecte sur le tenant Default voit et gere les entites de **tous les tenants** de l'installation (vue dite "god view").
- Tous les autres tenants restent strictement isoles entre eux : un tenant enfant ne voit jamais les donnees d'un autre tenant enfant.
- Le tenant Default ne peut pas etre supprime. Dans la page de gestion des tenants, le bouton de suppression n'apparait tout simplement pas pour ce tenant, qui porte a la place un badge distinctif a cote de son nom.

Cette vue globale n'est pas un parametre que l'on peut activer ou desactiver : elle est automatiquement liee au fait d'etre connecte sur le tenant Default. Il n'existe qu'un seul tenant master par installation, c'est toujours le premier tenant cree.

## Ce que la vue master change concretement dans l'interface

Quand un administrateur bascule sur le tenant Default, plusieurs elements de l'interface changent de comportement :

| Element | Comportement en vue master | Comportement sur un tenant enfant |
|---|---|---|
| Menu lateral (appareils / groupes) | Regroupe par tenant, sous des en-tetes repliables (icone batiment), tenant Default toujours en premier puis les autres par ordre alphabetique | Liste plate, pas de regroupement |
| Listes d'appareils | Un niveau "Tenant" apparait au-dessus des groupes, avec des filtres par tenant | Pas de niveau tenant, filtre non affiche |
| Scripts, scenarios, plannings, conformite | Toutes les entites de tous les tenants sont visibles ; celles qui appartiennent a un autre tenant que celui affiche sont en lecture seule | Seules les entites du tenant courant (+ celles partagees, voir page dediee) sont visibles |
| Tableaux de bord (statistiques de parc) | Les chiffres agregent l'ensemble des tenants | Les chiffres ne couvrent que le tenant courant |

Sur les entites appartenant a un autre tenant que celui actuellement affiche, un badge **"Master"** est appose a cote du nom, et les boutons de modification ou de suppression sont desactives avec l'info-bulle *"Gere par le tenant Default — lecture seule"*. Cela permet de consulter facilement ce qui existe ailleurs dans l'installation sans risquer de modifier une entite qui ne vous appartient pas.

## Basculer entre tenants

Le selecteur **Tenant**, disponible dans la barre superieure de l'application, permet de changer de tenant courant :

- Il n'apparait que si le compte connecte a acces a plus d'un tenant (un utilisateur limite a un seul tenant ne voit pas ce selecteur).
- Un administrateur de la plateforme peut basculer vers n'importe quel tenant de l'installation.
- Un utilisateur standard ne peut basculer que vers les tenants dont il est membre.
- Basculer de tenant recharge automatiquement la liste des appareils et l'arborescence des groupes, sans necessiter de rechargement de la page.

A noter : le role "administrateur" au sein d'un tenant (qui donne la main sur la gestion des membres et des reglages de ce tenant precis) est different du role "administrateur de la plateforme" (qui donne acces a tous les tenants, y compris la creation/suppression de tenants). Un utilisateur peut tres bien etre administrateur d'un tenant sans etre administrateur de la plateforme.

## Acces direct a un appareil d'un autre tenant

Si un lien direct vers un appareil est partage entre utilisateurs de tenants differents, Obliance detecte automatiquement a quel tenant appartient cet appareil et bascule l'utilisateur sur le bon tenant si necessaire (sous reserve que l'utilisateur ait les droits d'acces a ce tenant et a cet appareil). Un administrateur de la plateforme connecte sur le tenant Default n'est jamais redirige, puisque sa vue master inclut deja tous les appareils de l'installation.