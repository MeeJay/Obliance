Au-delà des équipes, Obliance propose deux réglages transverses par tenant — les jeux de permissions et les restrictions — ainsi qu'un rôle simplifié par tenant.

## Rôle par tenant (Member / Admin)

Depuis le panneau **Manage tenant access** d'un utilisateur (voir page « Vue d'ensemble »), chaque accès à un tenant porte un rôle :

- **Member** : l'utilisateur est soumis aux vérifications normales de capacités et aux permissions de ses équipes.
- **Admin** : l'utilisateur passe outre les vérifications de capacités tenant-wide pour ce tenant précis.

Ce rôle **Admin de tenant** reste distinct du rôle administrateur global de la plateforme : il ne donne ni accès au menu Utilisateurs, ni possibilité de gérer les équipes (ces fonctions restent réservées au rôle administrateur global, vérifié indépendamment du tenant).

> Point de vigilance : dans le panneau d'accès au tenant, seul le choix Member/Admin est proposé — il n'y a pas de sélection d'un jeu de permissions personnalisé à cet endroit ; les jeux de permissions se gèrent séparément dans l'onglet dédié décrit ci-dessous.

## Onglet Permissions : les jeux de permissions

L'onglet **Permissions** de la page Utilisateurs (composant séparé de l'arbre des équipes) gère des **jeux de permissions** (Permission Sets) : une matrice qui croise des capacités avec des jeux nommés, valable pour l'ensemble d'un tenant.

Trois jeux existent par défaut et ne peuvent pas être supprimés :

| Jeu | Usage typique |
|---|---|
| **Admin** | Accès complet aux fonctions transverses du tenant |
| **User** | Accès standard |
| **Viewer** | Consultation seule |

Un administrateur peut créer des jeux personnalisés, les renommer, et cocher/décocher des capacités directement dans la matrice — chaque case bascule immédiatement, sans bouton « Enregistrer » global.

### Capacités réellement actives vs. capacités d'affichage

Toutes les cases de cette matrice ne pilotent pas un comportement réel côté serveur. Sont effectivement branchées et bloquantes :

- **users.manage** (gère l'accès à la gestion des utilisateurs du tenant),
- **supervision:read** (accès aux sessions distantes / historique / rapports),
- les capacités **agent_config:\*** (déblocage de pages entières : sections personnalisées, découverte réseau, clés API, approbation d'agents),
- **cve:read**.

Les autres entrées de la matrice (monitoring, devices.manage, etc.) sont pour l'instant purement indicatives dans l'interface et ne bloquent ni ne débloquent de fonctionnalité côté serveur. Il est donc recommandé de ne pas se fier à ces cases pour restreindre un accès sensible : utiliser plutôt les équipes (pour les appareils) ou les restrictions (pour les actions ponctuelles) décrites ci-dessous.

## Onglet Restrictions

L'onglet **Restrictions** liste des actions sensibles de la plateforme et permet de leur appliquer un niveau de contrôle supplémentaire, indépendamment des équipes et des jeux de permissions. Cet onglet est réservé strictement aux administrateurs globaux de la plateforme.

Pour chaque action, trois niveaux sont disponibles :

| Niveau | Effet |
|---|---|
| **None** | Aucun contrôle supplémentaire |
| **Sensitive** | L'utilisateur qui déclenche l'action doit fournir un code de revérification au moment de l'exécution |
| **Restricted** | L'action nécessite l'approbation d'un second administrateur, via Sécurité > Approvals |

Chaque action peut en outre recevoir une **portée** (bouton « Scope: All / Include / Exclude ») pour limiter le contrôle à certains appareils ou groupes seulement, plutôt qu'à l'ensemble du tenant.

La gestion des équipes elle-même (création, modification) peut être placée sous ce régime : si elle est configurée en Sensible ou Restreint, chaque création ou modification d'équipe déclenchera la revérification correspondante avant d'être appliquée.

### Installation fraîche

Sur une installation récente, il est possible que le premier chargement de l'onglet Restrictions échoue si la mise à jour de base de données correspondante n'a pas encore été appliquée. Un message d'erreur explicite s'affiche dans ce cas dans l'interface ; il suffit généralement d'attendre la fin de la mise à jour du serveur puis de recharger la page.

## Récapitulatif : quel outil pour quel besoin

| Besoin | Outil à utiliser |
|---|---|
| Donner accès à des appareils/groupes précis à un utilisateur | Équipes → arbre de permissions (RO/RW + capacités) |
| Donner un accès complet à un tenant sans passer par les équipes | Rôle **Admin** dans Manage tenant access |
| Débloquer une page transverse (sessions distantes, découverte réseau, clés API, approbation d'agents) | Jeu de permissions (capacités agent_config:*, supervision:read) |
| Imposer une revérification ou une double validation sur une action sensible | Restrictions (Sensitive / Restricted + portée) |
| Autoriser la création de nouveaux groupes d'appareils | Indicateur « Peut créer » de l'équipe |

> Build à lancer : aucun (page de documentation)