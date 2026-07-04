Obliance combine quatre mécanismes indépendants pour contrôler qui peut voir et faire quoi sur la plateforme.

## Où se trouve la gestion des utilisateurs

Le lien **Utilisateurs** n'apparaît dans le menu latéral que pour les administrateurs de la plateforme (rôle global admin). La page **Utilisateurs** (`/admin/users`) contient 4 onglets :

| Onglet | Contenu |
|---|---|
| **Utilisateurs** | Liste des comptes, accès aux tenants |
| **Équipes** | Création d'équipes, membres, arbre de permissions par groupe/appareil |
| **Permissions** | Jeux de permissions (matrice de capacités valables sur tout le tenant) |
| **Restrictions** | Actions sensibles nécessitant une revérification ou une double approbation |

Un compte avec un rôle « Admin » au niveau d'un tenant (voir plus bas) n'a **pas** automatiquement accès à cette page : seul le rôle administrateur global de la plateforme fait apparaître le lien dans le menu et autorise la gestion des équipes.

## Les 4 couches de contrôle d'accès

1. **Équipes → Portées → Niveaux** : pour les utilisateurs non-administrateurs, l'accès aux appareils et groupes se règle via des équipes (détails dans la page « Équipes, portées et arbre de permissions »).
2. **Rôle par tenant** : chaque utilisateur peut avoir un rôle *Member* ou *Admin* propre à chaque tenant auquel il a accès. Le rôle *Admin* sur un tenant fait passer outre les vérifications de capacités pour ce tenant, mais ne donne pas accès aux fonctions réservées à l'administrateur de la plateforme (comme la gestion des équipes).
3. **Jeux de permissions** (onglet Permissions) : une matrice de capacités valables sur l'ensemble d'un tenant, indépendante des équipes, avec trois jeux par défaut : Admin, User, Viewer.
4. **Restrictions** (onglet Restrictions) : une liste d'actions sensibles pouvant exiger une revérification (code à usage unique) ou une double approbation, indépendamment des équipes.

Ces couches ne se remplacent pas : elles s'additionnent. Un administrateur global passe outre tout. Un utilisateur normal doit satisfaire les Équipes pour accéder à un appareil précis, éventuellement le rôle tenant et les jeux de permissions pour certaines pages transverses, et peut se voir imposer une restriction sur une action ponctuelle même s'il a par ailleurs les droits.

## Gérer un compte utilisateur

### Accès multi-tenant

L'icône (bâtiment) sur chaque ligne utilisateur ouvre le panneau **Manage tenant access**, qui permet :

- d'ajouter ou retirer l'utilisateur d'un ou plusieurs tenants,
- de lui assigner un rôle par tenant : **Member** ou **Admin**.

Le rôle **Admin** assigné ici fait bypasser les vérifications de capacités tenant pour ce tenant spécifique, mais reste distinct du rôle administrateur global de la plateforme (qui seul donne accès à la gestion des équipes et au menu Utilisateurs).

### Cas particulier des comptes SSO

Les comptes provisionnés via **Obligate** (nom d'utilisateur préfixé `og_`) ne peuvent pas être modifiés depuis Obliance : pas de changement de mot de passe, pas de suppression, et pas de modification de leurs accès aux tenants. Les actions correspondantes sont masquées dans l'interface pour ces comptes, et toute tentative renvoie une erreur indiquant que la gestion doit se faire depuis Obligate.

## Bonnes pratiques

- Réserver le rôle administrateur global (celui qui donne accès à `/admin/users`) aux personnes qui doivent réellement gérer équipes et permissions.
- Pour un responsable qui ne doit administrer qu'un seul tenant sans toucher aux équipes ni à la configuration globale, utiliser le rôle **Admin** de tenant plutôt que le rôle administrateur global.
- Appliquer le principe de moindre privilège : n'accorder que les accès (équipes, rôle tenant, capacités) réellement nécessaires à chaque utilisateur, et encourager l'activation d'une authentification à deux facteurs pour tous les comptes.

> Build à lancer : aucun (page de documentation)