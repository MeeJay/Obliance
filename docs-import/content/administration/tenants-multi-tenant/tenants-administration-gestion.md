Cette page decrit comment creer, configurer et supprimer des tenants depuis l'interface d'administration.

## Acces a la gestion des tenants

La gestion des tenants se fait depuis le menu **Tenants** (`/admin/tenants`), reserve aux **administrateurs de la plateforme**. Un administrateur d'un tenant particulier (role tenant "admin", different du role plateforme) n'a pas acces a cette page : il ne peut administrer que le contenu de son propre tenant, pas la liste des tenants elle-meme ni leurs membres au niveau plateforme.

## Creer un tenant

1. Depuis la page Tenants, cliquer sur le bouton de creation.
2. Renseigner le nom du tenant. Un identifiant technique (slug) est genere automatiquement a partir du nom.
3. Valider la creation.

Le nom et le slug peuvent etre modifies ulterieurement depuis la meme page.

## Le tenant Default

Le premier tenant de l'installation, nomme **Default**, est le tenant master (voir la page "Comprendre le multi-tenant et le tenant master"). Il est repere par un badge special dans la liste et ne peut pas etre supprime : la tentative de suppression est bloquee cote serveur, et le bouton de suppression n'est meme pas affiche pour ce tenant dans l'interface.

## Modifier un tenant

Depuis la page Tenants, chaque tenant peut etre edite pour changer :

- son **nom**,
- son **slug** (identifiant technique),
- le parametre **"Require 2nd-admin approval for destructive actions"** (voir plus bas).

Toute modification de ces reglages est enregistree dans le journal d'audit de la plateforme, avec le detail des valeurs avant et apres changement.

## Validation a deux administrateurs ("Require 2nd-admin approval for destructive actions")

Chaque tenant dispose d'un reglage independant, activable depuis sa fiche : **"Require 2nd-admin approval for destructive actions"**. Lorsqu'il est active, les actions destructives realisees dans ce tenant necessitent l'approbation d'un second administrateur avant d'etre executees, plutot que d'etre appliquees immediatement par un seul administrateur. Ce reglage s'applique tenant par tenant : il peut etre active sur certains tenants et pas sur d'autres au sein de la meme installation.

## Gerer les membres d'un tenant

Depuis la fiche d'un tenant, un administrateur de la plateforme peut :

- **ajouter** un utilisateur existant comme membre du tenant,
- **retirer** un membre du tenant,
- **basculer le role tenant** d'un membre entre "admin" et "membre" via un bouton dedie dans la liste des membres.

Ce role tenant determine les droits de l'utilisateur a l'interieur de ce tenant precis (gestion des reglages du tenant, des equipes, etc.) mais ne donne aucun droit sur les autres tenants de l'installation, ni sur la liste des tenants elle-meme.

Pour donner acces a un meme utilisateur sur plusieurs tenants, il faut l'ajouter comme membre de chacun de ces tenants individuellement — il n'existe pas de role "multi-tenant" intermediaire entre membre d'un tenant et administrateur de la plateforme.

## Supprimer un tenant

La suppression d'un tenant (hors tenant Default, qui est protege) est disponible depuis la page Tenants. Cette operation est **irreversible**.

Points a connaitre avant de supprimer un tenant :

- Toutes les entites appartenant en propre a ce tenant (appareils, groupes, scripts, scenarios, plannings, etc.) sont supprimees avec lui.
- Si ce tenant avait ete choisi comme destinataire d'un partage en lecture seule (fan-out) depuis un autre tenant, l'installation nettoie automatiquement les references a ce tenant dans les listes de diffusion des entites concernees, pour eviter de laisser des references a un tenant qui n'existe plus.
- Il est recommande d'exporter au prealable les scenarios ou scripts critiques si l'on souhaite pouvoir les reimporter ailleurs (voir la documentation dediee a l'export/import de scenarios).