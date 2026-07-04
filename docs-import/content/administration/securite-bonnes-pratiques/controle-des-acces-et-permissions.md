Ce guide decrit le modele de permissions d'Obliance : roles, equipes (Teams), isolation multi-tenant et cles API des agents.

## Roles

Chaque utilisateur possede un role global :

| Role | Portee |
|---|---|
| `admin` | Acces complet a toutes les fonctionnalites et toutes les ressources visibles depuis le tenant courant ; contourne toutes les verifications de permission par equipe. |
| `user` | Acces limite aux ressources autorisees via ses equipes (Teams). |

**Un utilisateur non-admin sans equipe assignee ne voit et ne peut agir sur aucune ressource.** Il est donc indispensable, apres creation d'un compte `user`, de l'associer a au moins une equipe pour qu'il puisse voir des appareils, groupes ou scripts.

## Equipes (Teams) et niveaux d'acces

Les permissions fines pour les utilisateurs non-admin passent par le systeme d'**equipes** :

1. Une equipe se voit attribuer un ou plusieurs **perimetres** (scope), qui peuvent etre un groupe d'appareils ou un appareil individuel.
2. Pour chaque perimetre, l'equipe recoit un **niveau d'acces** :
   - **ro** (lecture seule) : consultation uniquement.
   - **rw** (lecture-ecriture) : consultation et actions (execution de scripts, changements de configuration, etc.).
3. Un utilisateur herite des droits de toutes les equipes auxquelles il appartient.

Ce modele permet par exemple de donner a une equipe support un acces `ro` sur l'ensemble du parc, et a une equipe technique un acces `rw` limite a un sous-ensemble de groupes.

### Bonnes pratiques

- Privilegier la creation d'equipes dediees par perimetre plutot que d'accorder le role `admin` largement.
- Revoir periodiquement la composition des equipes, en particulier apres un depart ou un changement de poste.
- Pour un utilisateur ayant besoin d'acceder a plusieurs tenants (voir section multi-tenant ci-dessous), creer une equipe par tenant concerne : les equipes restent strictement mono-tenant.

## Isolation multi-tenant

Sur une installation multi-tenant, chaque tenant est **strictement isole** des autres : un administrateur ou utilisateur d'un tenant ne voit ni les appareils, ni les groupes, ni les scripts, ni les utilisateurs d'un autre tenant.

Le tenant "Default" constitue une exception volontaire : c'est le **tenant maitre**, en vue globale ("god view"). Un administrateur connecte sur ce tenant maitre voit et peut administrer l'ensemble des ressources de tous les tenants de l'installation. Ce statut particulier doit etre reserve a un nombre restreint d'administrateurs de confiance, dans la mesure ou il donne une visibilite totale sur toutes les organisations hebergees.

## Cles API des agents

Le deploiement des agents se fait via des **cles API** (gerees dans **Agents > Cles API**). Chaque cle API peut se voir associer un **groupe par defaut** : tout agent qui s'enregistre avec cette cle est automatiquement rattache a ce groupe, et donc aux permissions d'equipe qui s'y appliquent.

Cela permet de segmenter le deploiement d'agents par site, client ou equipe : par exemple, une cle API dediee a un site distant avec son propre groupe par defaut, visible uniquement par l'equipe qui gere ce site.

### Recommandations operationnelles

- Creer une cle API distincte par usage (par site, par client, par script de deploiement) plutot que de reutiliser une cle unique partout : cela facilite la revocation ciblee en cas de compromission.
- Verifier regulierement la liste des cles API actives et supprimer celles qui ne sont plus utilisees.
- Associer systematiquement un groupe par defaut aux cles API afin que les nouveaux agents n'atterrissent jamais dans un groupe non supervise.