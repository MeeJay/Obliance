Les équipes définissent, appareil par appareil ou groupe par groupe, ce que peuvent voir et faire les utilisateurs non-administrateurs.

## Principe général

Une équipe est strictement rattachée à **un seul tenant**. Elle regroupe :

- une liste de **membres** (utilisateurs non-administrateurs uniquement — les administrateurs globaux n'apparaissent jamais dans la liste des membres possibles, puisqu'ils passent outre toutes les vérifications de permission de toute façon),
- une liste de **permissions** organisées en arbre (portée par portée),
- un indicateur **Peut créer** (badge « Create » / « Créer ») qui autorise les membres de l'équipe à créer de nouveaux groupes d'appareils.

Un utilisateur non-administrateur qui n'appartient à **aucune** équipe ne voit et ne peut agir sur **aucun** appareil.

## Créer et gérer une équipe

1. Dans l'onglet **Équipes**, cliquer sur **Nouvelle équipe**.
2. Renseigner nom et description.
3. Depuis le tenant maître (le tenant racine « Default »), le tenant cible de l'équipe est obligatoire à la création — une équipe créée depuis un tenant enfant est automatiquement rattachée à ce tenant.
4. Si aucune équipe n'existe encore, la liste affiche « Aucune équipe créée ».

La création ou la modification d'une équipe peut être soumise à la matrice de **Restrictions** (voir page dédiée) : si l'action « gestion des équipes » y est configurée en mode Sensible ou Restreint, une revérification ou une double approbation sera exigée avant que le changement soit enregistré.

> Point de vigilance : le formulaire de création/édition d'équipe actuel ne propose pas de case à cocher visible pour activer « Peut créer ». Si ce droit doit être accordé à une équipe, une intervention technique est nécessaire en attendant qu'un contrôle soit ajouté au formulaire.

### Onglet Membres

Dans le panneau d'une équipe, l'onglet **Membres** liste tous les utilisateurs non-administrateurs du tenant. Cocher ou décocher une case ajoute ou retire immédiatement l'utilisateur de l'équipe — il n'y a pas de bouton « Enregistrer » séparé pour cet onglet.

## Onglet Permissions : l'arbre de portées

L'onglet **Permissions** d'une équipe affiche un arbre reprenant la hiérarchie des groupes d'appareils du tenant, plus une ligne spéciale **Ungrouped (orphan devices)** tout en haut pour les appareils sans groupe.

Pour chaque nœud de l'arbre (groupe, sous-groupe, appareil individuel, ou la ligne « orphelins »), on peut poser un niveau de permission :

| Niveau | Libellé UI | Effet |
|---|---|---|
| Aucun | — | Le nœud n'est pas accessible à l'équipe |
| Lecture seule | **RO** (LEC) | Donne uniquement la capacité de consulter les métriques et l'inventaire |
| Lecture/écriture | **RW** (LEC/ÉCR) | Donne accès en plus aux capacités d'action détaillées ci-dessous |

Les capacités détaillées (cases à cocher supplémentaires) ne sont visibles et modifiables **que** lorsque le niveau RW est sélectionné :

| Catégorie | Capacités |
|---|---|
| **Execution** | Exécuter des scripts, scans, services, installations/désinstallations |
| **Access** | Prise en main à distance (Reach/RDP/SSH), parcours et transfert de fichiers |
| **Power** | Redémarrage, arrêt, mise en veille, redémarrage de l'agent |

### Héritage de groupe

Accorder une permission sur un groupe la propage automatiquement à **tous** les sous-groupes et appareils en dessous, sans limite de profondeur. Dans l'arbre, un nœud déjà couvert par un ancêtre affiche simplement la mention **« inherited » / « hérité »** (en italique, grisé), sans bouton RO/RW à cliquer : il n'est donc pas possible de poser une permission différente (plus restrictive ou plus large) sur ce nœud précis. Pour changer l'accès d'un sous-groupe ou d'un appareil isolé, il faut soit modifier la permission au niveau du groupe parent, soit réorganiser l'arbre de groupes.

### Cas d'un appareil couvert par plusieurs sources

Si une même équipe reçoit des permissions concurrentes sur un appareil par plusieurs chemins (permission directe sur l'appareil, permission héritée d'un groupe parent, ou héritage via la clé API par défaut utilisée pour l'enrôlement), c'est **le niveau le plus élevé** qui s'applique (RW l'emporte sur RO). Il n'y a pas de logique « la permission la plus spécifique gagne » : positionner un appareil précis en lecture seule ne suffit pas à le restreindre si son groupe parent est en lecture/écriture pour la même équipe.

### Ligne « Ungrouped (orphan devices) »

Cette ligne spéciale en haut de l'arbre couvre tous les appareils qui n'ont pas encore de groupe assigné (ni directement, ni via le groupe par défaut de leur clé API d'enrôlement). Elle se configure avec les mêmes contrôles RO/RW/capacités qu'un groupe normal.

## Résumé du parcours de résolution d'accès

Pour savoir si un membre d'une équipe peut voir ou agir sur un appareil donné, Obliance vérifie dans l'ordre :

1. une permission posée directement sur l'appareil,
2. une permission héritée d'un groupe parent (à n'importe quelle profondeur),
3. si l'appareil n'a pas encore de groupe, le groupe par défaut associé à la clé API utilisée lors de son enrôlement,
4. la portée « Ungrouped » de l'équipe.

Si plusieurs de ces sources correspondent, le niveau le plus élevé retenu s'applique.

> Build à lancer : aucun (page de documentation)