# DÃ©couvrir l'interface Obliance

Une fois connectÃ©, l'interface d'Obliance s'organise autour de deux zones fixes : une barre supÃ©rieure et une barre latÃ©rale de navigation, qui restent visibles quelle que soit la page consultÃ©e.

## La barre supÃ©rieure

En haut de chaque page, vous retrouvez de gauche Ã  droite :

- le **logo Obliance**, qui ramÃ¨ne toujours au tableau de bord en un clic ;
- le sÃ©lecteur de **Tenant** (uniquement visible si vous avez accÃ¨s Ã  plusieurs tenants) ;
- le sÃ©lecteur d'applications ;
- le lien **TÃ©lÃ©charger l'appli** ;
- un indicateur de connexion temps rÃ©el ;
- le centre de notifications ;
- votre badge utilisateur, avec le bouton **Se dÃ©connecter**.

### Le sÃ©lecteur de Tenant

Un Â« tenant Â» correspond Ã  un espace de travail isolÃ© (par exemple, une sociÃ©tÃ© cliente distincte si vous gÃ©rez plusieurs organisations). Si vous n'avez accÃ¨s qu'Ã  un seul tenant, ce sÃ©lecteur ne s'affiche pas. Si vous avez accÃ¨s Ã  plusieurs tenants, un bouton **Tenant** affiche le nom du tenant actuellement sÃ©lectionnÃ© ; en cliquant dessus, une liste dÃ©roulante prÃ©sente tous les tenants auxquels vous avez accÃ¨s, avec un badge **Admin** sur ceux oÃ¹ vous avez ce rÃ´le.

Changer de tenant recharge automatiquement la liste des appareils et des groupes, ainsi que la connexion temps rÃ©el, pour reflÃ©ter le tenant nouvellement sÃ©lectionnÃ©.

### Le sÃ©lecteur d'applications

Une rangÃ©e de pastilles vous permet de basculer rapidement vers les autres applications de la suite auxquelles vous avez accÃ¨s : Obliview, Obliguard, Oblimap, Obliance, Obliplan, Oblihub. Seules les applications auxquelles votre compte a effectivement accÃ¨s (via l'authentification centralisÃ©e Obligate) sont affichÃ©es.

### TÃ©lÃ©charger l'appli

Le lien **TÃ©lÃ©charger l'appli** vous amÃ¨ne sur une page de tÃ©lÃ©chargement. Attention : il ne s'agit pas de l'agent de supervision installÃ© sur vos appareils, mais du client de bureau **Oblireach Desktop** (fichier `.msi` pour Windows), qui permet de consulter vos sessions de prise en main Ã  distance sans avoir besoin d'un onglet de navigateur ouvert. La page affiche la derniÃ¨re version disponible ainsi que les notes de version.

## La barre latÃ©rale

### Section Navigation

Visible par tous les utilisateurs connectÃ©s, elle comporte quatre entrÃ©es :

- **Tableau de bord**
- **Appareils**
- **Automations**
- **Politiques**

### Section Administration

Cette section n'apparaÃ®t que si au moins une de ses entrÃ©es vous est accessible :

| EntrÃ©e | Qui la voit |
|---|---|
| Utilisateurs | Administrateurs uniquement |
| SÃ©curitÃ© | Administrateurs uniquement (avec un badge indiquant le nombre d'approbations d'appareils en attente) |
| Supervision | Administrateurs, ou utilisateurs disposant du droit d'accÃ¨s Ã  la supervision |
| Agent config | Administrateurs, ou utilisateurs disposant d'un droit de configuration des agents |
| Workspace | Administrateurs connectÃ©s sur le tenant principal uniquement |
| ParamÃ¨tres | Administrateurs uniquement |

### Ajouter un agent

Le bouton **Ajouter un agent**, visible pour les administrateurs et pour les utilisateurs disposant du droit d'approbation des agents, ouvre une fenÃªtre de dÃ©ploiement. Il faut d'abord y choisir une clÃ© API parmi celles disponibles pour le tenant, puis un onglet correspondant au systÃ¨me d'exploitation de l'appareil Ã  ajouter :

| Onglet | Modes de dÃ©ploiement proposÃ©s |
|---|---|
| Windows | Windows 10+ (64 bits), Windows 7/10 (32 bits), Server 2012/2016, Server 2008 R2, ou un installeur autonome Ã  tÃ©lÃ©charger (mode manuel / hors ligne, sans accÃ¨s internet requis sur la machine) |
| Linux | Une commande Ã  copier-coller, ou un binaire autonome Ã  tÃ©lÃ©charger (mode manuel / hors ligne) |
| macOS | Une commande Ã  copier-coller |
| FreeBSD | Une commande Ã  copier-coller |

### L'arbre des groupes d'appareils

Sous la navigation, la barre latÃ©rale affiche l'arbre de vos groupes d'appareils, avec pour chacun un compteur du nombre d'appareils en ligne, en alerte, critiques et hors ligne. Une barre de recherche permet de filtrer les appareils affichÃ©s par nom. Vous pouvez faire glisser un appareil d'un groupe vers un autre directement depuis cette liste.

Deux modes d'affichage sont disponibles (empilÃ© ou cÃ´te-Ã -cÃ´te, redimensionnable), et votre choix est mÃ©morisÃ© pour vos prochaines visites.

Si votre compte a accÃ¨s au tenant principal (le tenant Â« maÃ®tre Â»), les appareils et les groupes y sont en plus regroupÃ©s par tenant, avec un en-tÃªte pliable pour chacun (le tenant par dÃ©faut apparaissant en premier, les autres par ordre alphabÃ©tique).

### RÃ©duire ou dÃ©tacher la barre latÃ©rale

La barre latÃ©rale peut Ãªtre rÃ©duite en une simple colonne d'icÃ´nes, ou basculÃ©e en mode flottant (elle se masque automatiquement et rÃ©apparaÃ®t au survol, avec un bouton pour l'Ã©pingler). Ces prÃ©fÃ©rences sont conservÃ©es d'une session Ã  l'autre.

### Bas de la barre latÃ©rale

Tout en bas, un raccourci affiche votre profil (avatar, nom, identifiant, rÃ´le) ainsi qu'un bouton pour vous dÃ©connecter.
