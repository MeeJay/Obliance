# Découvrir l'interface Obliance

Une fois connecté, l'interface d'Obliance s'organise autour de deux zones fixes : une barre supérieure et une barre latérale de navigation, qui restent visibles quelle que soit la page consultée.

## La barre supérieure

En haut de chaque page, vous retrouvez de gauche à droite :

- le **logo Obliance**, qui ramène toujours au tableau de bord en un clic ;
- le sélecteur de **Tenant** (uniquement visible si vous avez accès à plusieurs tenants) ;
- le sélecteur d'applications ;
- le lien **Télécharger l'appli** ;
- un indicateur de connexion temps réel ;
- le centre de notifications ;
- votre badge utilisateur, avec le bouton **Se déconnecter**.

### Le sélecteur de Tenant

Un « tenant » correspond à un espace de travail isolé (par exemple, une société cliente distincte si vous gérez plusieurs organisations). Si vous n'avez accès qu'à un seul tenant, ce sélecteur ne s'affiche pas. Si vous avez accès à plusieurs tenants, un bouton **Tenant** affiche le nom du tenant actuellement sélectionné ; en cliquant dessus, une liste déroulante présente tous les tenants auxquels vous avez accès, avec un badge **Admin** sur ceux où vous avez ce rôle.

Changer de tenant recharge automatiquement la liste des appareils et des groupes, ainsi que la connexion temps réel, pour refléter le tenant nouvellement sélectionné.

### Le sélecteur d'applications

Une rangée de pastilles vous permet de basculer rapidement vers les autres applications de la suite auxquelles vous avez accès : Obliview, Obliguard, Oblimap, Obliance, Obliplan, Oblihub. Seules les applications auxquelles votre compte a effectivement accès (via l'authentification centralisée Obligate) sont affichées.

### Télécharger l'appli

Le lien **Télécharger l'appli** vous amène sur une page de téléchargement. Attention : il ne s'agit pas de l'agent de supervision installé sur vos appareils, mais du client de bureau **Oblireach Desktop** (fichier `.msi` pour Windows), qui permet de consulter vos sessions de prise en main à distance sans avoir besoin d'un onglet de navigateur ouvert. La page affiche la dernière version disponible ainsi que les notes de version.

## La barre latérale

### Section Navigation

Visible par tous les utilisateurs connectés, elle comporte quatre entrées :

- **Tableau de bord**
- **Appareils**
- **Automations**
- **Politiques**

### Section Administration

Cette section n'apparaît que si au moins une de ses entrées vous est accessible :

| Entrée | Qui la voit |
|---|---|
| Utilisateurs | Administrateurs uniquement |
| Sécurité | Administrateurs uniquement (avec un badge indiquant le nombre d'approbations d'appareils en attente) |
| Supervision | Administrateurs, ou utilisateurs disposant du droit d'accès à la supervision |
| Agent config | Administrateurs, ou utilisateurs disposant d'un droit de configuration des agents |
| Workspace | Administrateurs connectés sur le tenant principal uniquement |
| Paramètres | Administrateurs uniquement |

### Ajouter un agent

Le bouton **Ajouter un agent**, visible pour les administrateurs et pour les utilisateurs disposant du droit d'approbation des agents, ouvre une fenêtre de déploiement. Il faut d'abord y choisir une clé API parmi celles disponibles pour le tenant, puis un onglet correspondant au système d'exploitation de l'appareil à ajouter :

| Onglet | Modes de déploiement proposés |
|---|---|
| Windows | Windows 10+ (64 bits), Windows 7/10 (32 bits), Server 2012/2016, Server 2008 R2, ou un installeur autonome à télécharger (mode manuel / hors ligne, sans accès internet requis sur la machine) |
| Linux | Une commande à copier-coller, ou un binaire autonome à télécharger (mode manuel / hors ligne) |
| macOS | Une commande à copier-coller |
| FreeBSD | Une commande à copier-coller |

### L'arbre des groupes d'appareils

Sous la navigation, la barre latérale affiche l'arbre de vos groupes d'appareils, avec pour chacun un compteur du nombre d'appareils en ligne, en alerte, critiques et hors ligne. Une barre de recherche permet de filtrer les appareils affichés par nom. Vous pouvez faire glisser un appareil d'un groupe vers un autre directement depuis cette liste.

Deux modes d'affichage sont disponibles (empilé ou côte-à-côte, redimensionnable), et votre choix est mémorisé pour vos prochaines visites.

Si votre compte a accès au tenant principal (le tenant « maître »), les appareils et les groupes y sont en plus regroupés par tenant, avec un en-tête pliable pour chacun (le tenant par défaut apparaissant en premier, les autres par ordre alphabétique).

### Réduire ou détacher la barre latérale

La barre latérale peut être réduite en une simple colonne d'icônes, ou basculée en mode flottant (elle se masque automatiquement et réapparaît au survol, avec un bouton pour l'épingler). Ces préférences sont conservées d'une session à l'autre.

### Bas de la barre latérale

Tout en bas, un raccourci affiche votre profil (avatar, nom, identifiant, rôle) ainsi qu'un bouton pour vous déconnecter.
